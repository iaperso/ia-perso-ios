import crypto from 'node:crypto';

const MAX_PROMPT = 1800;
const MAX_IMAGE_BYTES = 3_500_000;
const MAX_SEED = 2147483647;
const CLOUDFLARE_TIMEOUT_MS = 32_000;
const POLLINATIONS_TIMEOUT_MS = 45_000;
const CACHE_TTL_MS = 3_600_000;
const inFlight = new Map();
const completed = new Map();

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, MAX_PROMPT);
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function seedFor(requestId) {
  return parseInt(hash(requestId).slice(0, 8), 16) % (MAX_SEED + 1);
}

function fingerprint(prompt, size) {
  return hash(`${size}\n${prompt}`);
}

export function enhancePrompt(prompt) {
  const base = clean(prompt);
  if (!base) return base;
  const guidance = ' Respecter exactement les sujets, attributs, relations et détails explicitement demandés, sans en ajouter ni en retirer. Si aucune autre origine, région ou esthétique n’est précisée, utiliser un rendu européen contemporain, naturel et photoréaliste, avec des proportions réalistes.';
  return `${base}.${guidance}`.slice(0, MAX_PROMPT);
}

function json(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
}

function retryable(error) {
  const status = Number(error?.status) || 0;
  return !status || status === 408 || status === 425 || status === 429 || status >= 500;
}

function modelFor(size) {
  return size >= 1024
    ? '@cf/black-forest-labs/flux-1-schnell'
    : '@cf/black-forest-labs/flux-2-klein-4b';
}

function extractImage(payload) {
  return payload?.result?.image || payload?.image || payload?.result?.result?.image || null;
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const timeout = timeoutSignal(timeoutMs);
  try {
    return await fetch(url, { ...options, signal: timeout.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Délai fournisseur dépassé après ${Math.round(timeoutMs / 1000)} s.`);
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    timeout.done();
  }
}

async function cloudflare({ prompt, size, requestId, fp }) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID || 'default';
  if (!accountId || !token) return null;

  const model = modelFor(size);
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'cf-aig-gateway-id': gatewayId,
    'cf-aig-cache-key': `ia-perso:${hash(`${requestId}:${fp}`)}`,
    'cf-aig-cache-ttl': '3600',
    'cf-aig-request-timeout': '30000',
    'cf-aig-max-attempts': '1',
    'cf-aig-collect-log': 'true',
    'cf-aig-collect-log-payload': 'false',
    'cf-aig-metadata': JSON.stringify({ app: 'ia-perso', requestId, size, model }),
  };

  let body;
  if (model.includes('flux-2-klein')) {
    body = new FormData();
    body.append('prompt', prompt);
    body.append('width', String(size));
    body.append('height', String(size));
    body.append('seed', String(seedFor(requestId)));
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ prompt, width: size, height: size, steps: 4, seed: seedFor(requestId) });
  }

  const response = await fetchWithTimeout(endpoint, { method: 'POST', headers, body }, CLOUDFLARE_TIMEOUT_MS);
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}

  if (!response.ok || payload?.success === false) {
    const error = new Error(payload?.errors?.[0]?.message || payload?.error || `Cloudflare HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const image = extractImage(payload);
  if (!image) {
    const error = new Error('Cloudflare n’a retourné aucune image exploitable.');
    error.status = 502;
    throw error;
  }
  return { dataUri: `data:image/jpeg;base64,${image}`, provider: 'cloudflare', model, size };
}

function pollinationsUrl(prompt, size, requestId) {
  const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`);
  url.searchParams.set('width', String(size));
  url.searchParams.set('height', String(size));
  url.searchParams.set('model', 'flux');
  url.searchParams.set('safe', 'false');
  url.searchParams.set('seed', String(seedFor(requestId)));
  return url;
}

async function pollinations({ prompt, size, requestId }) {
  const response = await fetchWithTimeout(
    pollinationsUrl(prompt, size, requestId),
    { headers: { Accept: 'image/*' }, redirect: 'follow' },
    POLLINATIONS_TIMEOUT_MS,
  );
  const type = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!response.ok) {
    const error = new Error(`Pollinations HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (!type.startsWith('image/')) {
    const error = new Error('Pollinations n’a pas renvoyé une image.');
    error.status = 502;
    throw error;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    const error = new Error(bytes.length ? 'Image trop volumineuse pour le transfert mobile.' : 'Pollinations a renvoyé une image vide.');
    error.status = 502;
    throw error;
  }
  return {
    dataUri: `data:${type};base64,${bytes.toString('base64')}`,
    provider: 'pollinations',
    model: 'flux',
    size,
    degraded: true,
  };
}

async function generate({ prompt, size, requestId, fp }) {
  const effectivePrompt = enhancePrompt(prompt);
  try {
    const output = await cloudflare({ prompt: effectivePrompt, size, requestId, fp });
    if (output) return output;
  } catch (error) {
    if (!retryable(error)) throw error;
    console.warn('cloudflare_transient_fallback', { requestId, status: error?.status || 0, message: error?.message });
  }
  return pollinations({ prompt: effectivePrompt, size: Math.min(size, 768), requestId });
}

function prune() {
  const now = Date.now();
  for (const [key, value] of completed) if (now - value.at > CACHE_TTL_MS) completed.delete(key);
  if (completed.size > 100) {
    const oldest = [...completed.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, completed.size - 100);
    for (const [key] of oldest) completed.delete(key);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' }, { Allow: 'POST' });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const prompt = clean(body?.prompt);
  const requestId = String(body?.requestId || '').trim();
  const size = Number(body?.size) >= 1024 ? 1024 : 512;
  if (!prompt) return json(res, 400, { error: 'Prompt vide.' });
  if (!/^[a-zA-Z0-9_-]{12,128}$/.test(requestId)) return json(res, 400, { error: 'requestId invalide.' });

  const fp = fingerprint(prompt, size);
  prune();
  const old = completed.get(requestId);
  if (old) {
    if (old.fp !== fp) return json(res, 409, { error: 'requestId déjà utilisé avec une autre demande.' });
    return json(res, 200, { ...old.value, cached: true });
  }

  const active = inFlight.get(requestId);
  if (active) {
    if (active.fp !== fp) return json(res, 409, { error: 'requestId déjà utilisé avec une autre demande.' });
    try { return json(res, 200, { ...(await active.task), shared: true }); }
    catch (error) { return json(res, Number(error?.status) || 502, { error: error?.message || 'Échec de génération.' }); }
  }

  const task = generate({ prompt, size, requestId, fp });
  inFlight.set(requestId, { fp, task });
  try {
    const value = await task;
    completed.set(requestId, { at: Date.now(), fp, value });
    prune();
    return json(res, 200, value);
  } catch (error) {
    console.error('generation_failed', { requestId, message: error?.message, status: error?.status });
    return json(res, Number(error?.status) || 502, { error: error?.message || 'Échec de génération.' });
  } finally {
    inFlight.delete(requestId);
  }
}
