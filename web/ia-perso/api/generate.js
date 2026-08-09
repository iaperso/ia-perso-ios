import crypto from 'node:crypto';

const MAX_PROMPT = 1800;
const CACHE_TTL_SECONDS = 3600;
const MAX_IMAGE_BYTES = 3_500_000;
const MAX_IMAGE_SEED = 2147483647;
const GOOGLE_CANDIDATES = 8;
const BLUESKY_CANDIDATES = 8;
const VISUAL_REFERENCE_LIMIT = 3;
const REFERENCE_TIMEOUT_MS = 1800;
const VISION_TIMEOUT_MS = 3200;
const inFlight = new Map();
const completed = new Map();

function cleanPrompt(value) {
  return String(value || '').trim().slice(0, MAX_PROMPT);
}

export function enhancePrompt(prompt, visualHints = '') {
  const base = cleanPrompt(prompt);
  if (!base) return base;
  const refs = cleanPrompt(visualHints);
  const inspiration = refs
    ? ` Indices visuels temporaires issus de références publiques, à utiliser uniquement comme inspiration générale et seulement s'ils sont compatibles avec la demande : ${refs}. Ne jamais reproduire une image précise ni contredire, remplacer ou affaiblir un élément explicitement demandé.`
    : '';
  const guidance = ' Composition impérative : représenter clairement tous les sujets, personnes, objets, attributs et relations explicitement demandés ; ne rien omettre. Les personnes mentionnées doivent être nettement visibles et reconnaissables dans la scène. Respecter fidèlement le nombre, la position relative et les détails décrits. Par défaut, lorsque le prompt ne précise pas une autre origine, région ou esthétique, privilégier un rendu européen contemporain, naturel et photoréaliste, avec des proportions réalistes et sans stylisation artificielle.';
  return `${base}.${inspiration}${guidance}`.slice(0, MAX_PROMPT);
}

function json(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
}

function modelFor(size) {
  return size >= 1024
    ? '@cf/black-forest-labs/flux-1-schnell'
    : '@cf/black-forest-labs/flux-2-klein-4b';
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requestFingerprint(prompt, size) {
  return hash(`${size}\n${prompt}`);
}

function cacheKey(requestId, fingerprint) {
  return `ia-perso:${hash(`${requestId}:${fingerprint}`)}`;
}

export function seedFor(requestId) {
  return parseInt(hash(requestId).slice(0, 8), 16) % (MAX_IMAGE_SEED + 1);
}

function extractBase64(payload) {
  return payload?.result?.image || payload?.image || payload?.result?.result?.image || null;
}

function isRetryableProviderFailure(error) {
  const status = Number(error?.status) || 0;
  return !status || status === 408 || status === 425 || status === 429 || status >= 500;
}

function words(value) {
  return String(value || '')
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]{3,}/g) || [];
}

function lexicalScore(text, promptWords) {
  const set = new Set(words(text));
  return promptWords.reduce((score, word) => score + (set.has(word) ? 1 : 0), 0);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = REFERENCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function googleReferenceCandidates(prompt) {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return [];

  try {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    const params = {
      key,
      cx,
      q: prompt,
      searchType: 'image',
      num: String(GOOGLE_CANDIDATES),
      safe: 'off',
      filter: '0',
      hl: 'fr',
      gl: 'fr',
      lr: 'lang_fr',
      cr: 'countryFR',
    };
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

    const { response, payload } = await fetchJsonWithTimeout(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];

    const promptWords = [...new Set(words(prompt))];
    return (payload?.items || [])
      .map((item) => ({
        source: 'google-images-fr',
        imageUrl: item.link || item.image?.thumbnailLink || '',
        thumbUrl: item.image?.thumbnailLink || item.link || '',
        title: item.title || '',
        context: item.snippet || item.displayLink || '',
        score: lexicalScore(`${item.title || ''} ${item.snippet || ''} ${item.displayLink || ''}`, promptWords),
      }))
      .filter((item) => /^https:\/\//i.test(item.imageUrl))
      .sort((a, b) => b.score - a.score)
      .slice(0, VISUAL_REFERENCE_LIMIT);
  } catch {
    return [];
  }
}

function blueskyImagesFromEmbed(embed) {
  if (!embed || typeof embed !== 'object') return [];
  if (Array.isArray(embed.images)) {
    return embed.images
      .map((image) => ({
        imageUrl: image.fullsize || image.thumb || '',
        thumbUrl: image.thumb || image.fullsize || '',
        alt: image.alt || '',
      }))
      .filter((image) => /^https:\/\//i.test(image.imageUrl));
  }
  if (embed.media) return blueskyImagesFromEmbed(embed.media);
  return [];
}

function blueskyPostIsPubliclyUsable(post) {
  const labels = Array.isArray(post?.labels) ? post.labels.map((label) => label?.val).filter(Boolean) : [];
  return !labels.some((value) => ['!hide', '!no-unauthenticated', 'porn', 'sexual', 'graphic-media'].includes(value));
}

async function blueskyReferenceCandidates(prompt) {
  try {
    const url = new URL('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts');
    url.searchParams.set('q', prompt);
    url.searchParams.set('sort', 'top');
    url.searchParams.set('limit', String(BLUESKY_CANDIDATES));
    url.searchParams.set('lang', 'fr');

    const { response, payload } = await fetchJsonWithTimeout(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];

    const promptWords = [...new Set(words(prompt))];
    const results = [];
    for (const post of payload?.posts || []) {
      if (!blueskyPostIsPubliclyUsable(post)) continue;
      const text = post?.record?.text || '';
      for (const image of blueskyImagesFromEmbed(post?.embed)) {
        results.push({
          source: 'bluesky-public',
          imageUrl: image.imageUrl,
          thumbUrl: image.thumbUrl,
          title: image.alt || text.slice(0, 160),
          context: text.slice(0, 240),
          score: lexicalScore(`${text} ${image.alt || ''}`, promptWords),
        });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, VISUAL_REFERENCE_LIMIT);
  } catch {
    return [];
  }
}

function pickReferenceMix(google, bluesky) {
  const selected = [];
  const seen = new Set();
  const add = (item) => {
    if (!item?.imageUrl || seen.has(item.imageUrl) || selected.length >= VISUAL_REFERENCE_LIMIT) return;
    seen.add(item.imageUrl);
    selected.push(item);
  };

  add(google[0]);
  add(bluesky[0]);
  for (const item of [...google.slice(1), ...bluesky.slice(1)].sort((a, b) => b.score - a.score)) add(item);
  return selected;
}

function parseVisionAnswer(payload) {
  return String(payload?.result?.answer || payload?.answer || '').trim();
}

async function analyzeReferenceWithMoondream(reference, prompt) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token || !reference?.imageUrl) return '';

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/moondream/moondream3.1-9B-A2B`;
  const question = `Demande cible : ${prompt}\nDécide si cette image est visuellement pertinente pour cette demande. Si oui, réponds en français sur UNE ligne commençant exactement par "PERTINENT:" puis donne uniquement 3 à 7 attributs visuels observables utiles (sujet, forme, posture, texture, lumière, cadrage, environnement), sans nom propre et sans inventer. Si elle ne correspond pas, réponds exactement "IGNORER".`;

  try {
    const { response, payload } = await fetchJsonWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'cf-aig-collect-log-payload': 'false',
      },
      body: JSON.stringify({
        task: 'query',
        image: reference.imageUrl,
        question,
        reasoning: false,
        temperature: 0.1,
        max_tokens: 120,
        stream: false,
      }),
    }, VISION_TIMEOUT_MS);
    if (!response.ok) return '';
    const answer = parseVisionAnswer(payload);
    const match = answer.match(/^PERTINENT:\s*(.+)$/i);
    return match ? match[1].trim().slice(0, 260) : '';
  } catch {
    return '';
  }
}

export async function collectVisualHints(prompt) {
  const [google, bluesky] = await Promise.all([
    googleReferenceCandidates(prompt),
    blueskyReferenceCandidates(prompt),
  ]);
  const selected = pickReferenceMix(google, bluesky);
  if (!selected.length) return { hints: '', sources: [], analyzed: 0, accepted: 0 };

  const analyses = await Promise.all(selected.map((reference) => analyzeReferenceWithMoondream(reference, prompt)));
  const useful = analyses.filter(Boolean);
  return {
    hints: useful.join(' ; ').slice(0, 760),
    sources: [...new Set(selected.map((reference) => reference.source))],
    analyzed: selected.length,
    accepted: useful.length,
  };
}

async function callCloudflare({ prompt, size, requestId, fingerprint }) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID || 'default';
  if (!accountId || !token) return null;

  const model = modelFor(size);
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'cf-aig-gateway-id': gatewayId,
    'cf-aig-cache-key': cacheKey(requestId, fingerprint),
    'cf-aig-cache-ttl': String(CACHE_TTL_SECONDS),
    'cf-aig-request-timeout': '30000',
    'cf-aig-max-attempts': '1',
    'cf-aig-retry-delay': '250',
    'cf-aig-backoff': 'exponential',
    'cf-aig-collect-log': 'true',
    'cf-aig-collect-log-payload': 'false',
    'cf-aig-metadata': JSON.stringify({ app: 'ia-perso', requestId, size, model }),
  };

  const seed = seedFor(requestId);
  let body;
  if (model.includes('flux-2-klein')) {
    body = new FormData();
    body.append('prompt', prompt);
    body.append('width', String(size));
    body.append('height', String(size));
    body.append('seed', String(seed));
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ prompt, width: size, height: size, steps: 4, seed });
  }

  const response = await fetch(endpoint, { method: 'POST', headers, body });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok || payload?.success === false) {
    const message = payload?.errors?.[0]?.message || payload?.error || `Cloudflare HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const image = extractBase64(payload);
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
  return url.toString();
}

async function callPollinations({ prompt, size, requestId }) {
  const response = await fetch(pollinationsUrl(prompt, size, requestId), {
    headers: { Accept: 'image/*' },
    redirect: 'follow',
  });
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!response.ok) {
    const error = new Error(`Pollinations HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (!contentType.startsWith('image/')) {
    const error = new Error('Pollinations n’a pas renvoyé une image.');
    error.status = 502;
    throw error;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    const error = new Error('Image Pollinations inexploitable.');
    error.status = 502;
    throw error;
  }
  return {
    dataUri: `data:${contentType};base64,${bytes.toString('base64')}`,
    provider: 'pollinations',
    model: 'flux',
    size,
    degraded: true,
  };
}

async function generateOnce({ prompt, size, requestId, fingerprint }) {
  const visual = await collectVisualHints(prompt);
  const effectivePrompt = enhancePrompt(prompt, visual.hints);
  const visualMeta = {
    visualPreScreening: Boolean(visual.hints),
    visualReferenceSources: visual.sources,
    visualReferencesAnalyzed: visual.analyzed || 0,
    visualReferencesAccepted: visual.accepted || 0,
  };

  try {
    const cloudflare = await callCloudflare({ prompt: effectivePrompt, size, requestId, fingerprint });
    if (cloudflare) return { ...cloudflare, ...visualMeta };
  } catch (error) {
    if (!isRetryableProviderFailure(error)) throw error;
    console.warn('cloudflare_transient_fallback', { requestId, status: error?.status || 0, message: error?.message });
  }

  const fallback = await callPollinations({ prompt: effectivePrompt, size: Math.min(size, 768), requestId });
  return { ...fallback, ...visualMeta };
}

function pruneCompleted(now = Date.now()) {
  for (const [key, entry] of completed) {
    if (now - entry.at >= CACHE_TTL_SECONDS * 1000) completed.delete(key);
  }
  if (completed.size > 100) {
    const oldest = [...completed.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, completed.size - 100);
    for (const [key] of oldest) completed.delete(key);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' }, { Allow: 'POST' });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const prompt = cleanPrompt(body?.prompt);
  const requestId = String(body?.requestId || '').trim();
  const requestedSize = Number(body?.size) >= 1024 ? 1024 : 512;
  if (!prompt) return json(res, 400, { error: 'Prompt vide.' });
  if (!/^[a-zA-Z0-9_-]{12,128}$/.test(requestId)) return json(res, 400, { error: 'requestId invalide.' });

  const fingerprint = requestFingerprint(prompt, requestedSize);
  pruneCompleted();

  const old = completed.get(requestId);
  if (old) {
    if (old.fingerprint !== fingerprint) return json(res, 409, { error: 'requestId déjà utilisé avec une autre demande.' });
    return json(res, 200, { ...old.value, cached: true });
  }

  const current = inFlight.get(requestId);
  if (current) {
    if (current.fingerprint !== fingerprint) return json(res, 409, { error: 'requestId déjà utilisé avec une autre demande.' });
    try { return json(res, 200, { ...(await current.task), shared: true }); }
    catch (error) { return json(res, Number(error?.status) || 502, { error: error?.message || 'Échec de génération.' }); }
  }

  const task = generateOnce({ prompt, size: requestedSize, requestId, fingerprint });
  inFlight.set(requestId, { fingerprint, task });
  try {
    const value = await task;
    completed.set(requestId, { at: Date.now(), fingerprint, value });
    pruneCompleted();
    return json(res, 200, value);
  } catch (error) {
    console.error('generation_failed', { requestId, message: error?.message, status: error?.status });
    return json(res, Number(error?.status) || 502, { error: error?.message || 'Échec de génération.' });
  } finally {
    inFlight.delete(requestId);
  }
}
