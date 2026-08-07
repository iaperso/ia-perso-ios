import crypto from 'node:crypto';

const MAX_PROMPT = 1800;
const CACHE_TTL_SECONDS = 3600;
const inFlight = new Map();
const completed = new Map();

function cleanPrompt(value) {
  return String(value || '').trim().slice(0, MAX_PROMPT);
}

function json(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function modelFor(size) {
  return size >= 1024
    ? '@cf/black-forest-labs/flux-1-schnell'
    : '@cf/black-forest-labs/flux-2-klein-4b';
}

function cacheKey(requestId) {
  return `ia-perso:${crypto.createHash('sha256').update(requestId).digest('hex')}`;
}

function extractBase64(payload) {
  return payload?.result?.image || payload?.image || payload?.result?.result?.image || null;
}

async function callCloudflare({ prompt, size, requestId }) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID || 'default';
  if (!accountId || !token) return null;

  const model = modelFor(size);
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'cf-aig-gateway-id': gatewayId,
    'cf-aig-cache-key': cacheKey(requestId),
    'cf-aig-cache-ttl': String(CACHE_TTL_SECONDS),
    'cf-aig-max-attempts': '1',
    'cf-aig-collect-log': 'true',
    'cf-aig-metadata': JSON.stringify({ app: 'ia-perso', requestId, size, model })
  };

  let body;
  if (model.includes('flux-2-klein')) {
    body = new FormData();
    body.append('prompt', prompt);
    body.append('width', String(size));
    body.append('height', String(size));
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ prompt, width: size, height: size, steps: 4, seed: Math.floor(Math.random() * 2147483647) });
  }

  const response = await fetch(endpoint, { method: 'POST', headers, body });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok || payload?.success === false) {
    const message = payload?.errors?.[0]?.message || payload?.error || `Cloudflare HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  const image = extractBase64(payload);
  if (!image) throw new Error('Cloudflare n’a retourné aucune image exploitable.');
  return { dataUri: `data:image/jpeg;base64,${image}`, provider: 'cloudflare', model, size };
}

function pollinationsUrl(prompt, size, requestId) {
  const seed = parseInt(crypto.createHash('sha256').update(requestId).digest('hex').slice(0, 8), 16) >>> 0;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${size}&height=${size}&model=flux&safe=true&seed=${seed}`;
}

async function generateOnce({ prompt, size, requestId }) {
  const cloudflare = await callCloudflare({ prompt, size, requestId });
  if (cloudflare) return cloudflare;
  return { imageUrl: pollinationsUrl(prompt, Math.min(size, 768), requestId), provider: 'pollinations', model: 'flux', size: Math.min(size, 768), degraded: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' }, { Allow: 'POST' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const prompt = cleanPrompt(body?.prompt);
  const requestId = String(body?.requestId || '').trim();
  const requestedSize = Number(body?.size) >= 1024 ? 1024 : 512;
  if (!prompt) return json(res, 400, { error: 'Prompt vide.' });
  if (!/^[a-zA-Z0-9_-]{12,128}$/.test(requestId)) return json(res, 400, { error: 'requestId invalide.' });

  const old = completed.get(requestId);
  if (old && Date.now() - old.at < CACHE_TTL_SECONDS * 1000) return json(res, 200, { ...old.value, cached: true });
  if (inFlight.has(requestId)) {
    try { return json(res, 200, { ...(await inFlight.get(requestId)), shared: true }); }
    catch (error) { return json(res, Number(error?.status) || 502, { error: error?.message || 'Échec de génération.' }); }
  }

  const task = generateOnce({ prompt, size: requestedSize, requestId });
  inFlight.set(requestId, task);
  try {
    const value = await task;
    completed.set(requestId, { at: Date.now(), value });
    if (completed.size > 100) {
      const oldest = [...completed.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 20);
      for (const [key] of oldest) completed.delete(key);
    }
    return json(res, 200, value);
  } catch (error) {
    console.error('generation_failed', { requestId, message: error?.message, status: error?.status });
    const status = Number(error?.status) || 502;
    return json(res, status, { error: error?.message || 'Échec de génération.', provider: 'cloudflare' });
  } finally {
    inFlight.delete(requestId);
  }
}
