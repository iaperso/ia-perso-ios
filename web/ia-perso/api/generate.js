import crypto from 'node:crypto';

const MAX_PROMPT = 1800;
const CACHE_TTL_SECONDS = 3600;
const MAX_IMAGE_BYTES = 3_500_000;
const MAX_IMAGE_SEED = 2147483647;
const DISCOVERY_TIMEOUT_MS = 450;
const VISION_TIMEOUT_MS = 700;
const PRESCREEN_TOTAL_TIMEOUT_MS = 1050;
const MAX_VISUAL_HINTS = 2;
const inFlight = new Map();
const completed = new Map();

function cleanPrompt(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, MAX_PROMPT);
}

function cleanHint(value, max = 360) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function enhancePrompt(prompt, visualHints = '') {
  const base = cleanPrompt(prompt);
  if (!base) return base;
  const hints = cleanHint(visualHints, 700);
  const inspiration = hints
    ? ` Inspiration visuelle temporaire : ${hints}. Ne jamais reproduire une image précise, ni contredire, remplacer ou affaiblir un élément explicitement demandé par l’utilisateur.`
    : '';
  const guidance = ' Composition impérative : représenter clairement tous les sujets, personnes, objets, attributs et relations explicitement demandés ; ne rien omettre. Les personnes mentionnées doivent être nettement visibles et reconnaissables dans la scène. Respecter fidèlement le nombre, la position relative et les détails décrits. Par défaut, lorsque le prompt ne précise pas une autre origine, région ou esthétique, privilégier un rendu européen contemporain, naturel et photoréaliste, avec des proportions réalistes et sans stylisation artificielle.';
  return `${base}.${inspiration}${guidance}`.slice(0, MAX_PROMPT);
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

function scoreText(text, promptWords) {
  const haystack = new Set(words(text));
  return promptWords.reduce((score, word) => score + (haystack.has(word) ? 2 : 0), 0;
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function fetchJson(url, options = {}, timeoutMs = DISCOVERY_TIMEOUT_MS) {
  const timeout = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: timeout.signal });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  } finally {
    timeout.done();
  }
}

function googleCandidate(item, promptWords) {
  const url = String(item?.link || '').trim();
  if (!/^https:\/\//i.test(url)) return null;
  const context = cleanHint(`${item?.title || ''} ${item?.snippet || ''}`, 500);
  return {
    source: 'google-images-fr',
    imageUrl: url,
    context,
    score: scoreText(context, promptWords) + 1,
  };
}

function mandatoryBlueskyRestriction(post) {
  const blocked = new Set(['!no-unauthenticated', '!takedown', '!hide']);
  const labels = [
    ...(Array.isArray(post?.labels) ? post.labels : []),
    ...(Array.isArray(post?.author?.labels) ? post.author.labels : []),
  ];
  return labels.some((label) => blocked.has(String(label?.val || '')));
}

function blueskyImages(post) {
  const embed = post?.embed;
  if (!embed || mandatoryBlueskyRestriction(post)) return [];
  const direct = Array.isArray(embed.images) ? embed.images : [];
  const media = Array.isArray(embed?.media?.images) ? embed.media.images : [];
  return [...direct, ...media];
}

function blueskyCandidates(post, promptWords) {
  const postText = cleanHint(post?.record?.text || '', 400);
  return blueskyImages(post).map((image) => {
    const imageUrl = String(image?.fullsize || image?.thumb || '').trim();
    if (!/^https:\/\//i.test(imageUrl)) return null;
    const alt = cleanHint(image?.alt || '', 300);
    const context = cleanHint(`${postText} ${alt}`, 500);
    return {
      source: 'bluesky-public',
      imageUrl,
      context,
      score: scoreText(context, promptWords) + (alt ? 2 : 0),
    };
  }).filter(Boolean);
}

function compactBlueskyQuery(prompt) {
  const base = cleanPrompt(prompt);
  const replacements = [
    [/\bchatons?\b/gi, 'kitten'],
    [/\bhommes?\b/gi, 'man'],
    [/\bfemmes?\b/gi, 'woman'],
    [/\btorse nu\b/gi, 'shirtless'],
    [/\bcinquantaine\b/gi, '50s'],
    [/\bsoixantaine\b/gi, '60s'],
    [/\bgrisonnant(e)?s?\b/gi, 'gray-haired'],
  ];
  let translated = base;
  for (const [pattern, value] of replacements) translated = translated.replace(pattern, value);
  return translated === base ? '' : translated;
}

async function discoverGoogle(prompt, promptWords) {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return [];
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  for (const [k, v] of Object.entries({
    key,
    cx,
    q: prompt,
    searchType: 'image',
    num: '5',
    safe: 'off',
    filter: '0',
    hl: 'fr',
    gl: 'fr',
    lr: 'lang_fr',
    cr: 'countryFR',
  })) url.searchParams.set(k, v);
  const payload = await fetchJson(url.toString());
  return (payload?.items || []).map((item) => googleCandidate(item, promptWords)).filter(Boolean);
}

async function discoverBlueskyQuery(query, promptWords) {
  if (!query) return [];
  const url = new URL('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts');
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'top');
  url.searchParams.set('limit', '8');
  const payload = await fetchJson(url.toString());
  return (payload?.posts || []).flatMap((post) => blueskyCandidates(post, promptWords));
}

async function discoverBluesky(prompt, promptWords) {
  const translated = compactBlueskyQuery(prompt);
  const batches = await Promise.all([
    discoverBlueskyQuery(prompt, promptWords),
    translated ? discoverBlueskyQuery(translated, promptWords) : Promise.resolve([]),
  ]);
  const seen = new Set();
  return batches.flat().filter((candidate) => {
    if (seen.has(candidate.imageUrl)) return false;
    seen.add(candidate.imageUrl);
    return true;
  });
}

async function inspectWithMoondream(candidate, prompt) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token || !candidate?.imageUrl) return null;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/moondream/moondream3.1-9B-A2B`;
  const question = `Compare cette image à la demande suivante : "${cleanPrompt(prompt).slice(0, 500)}". Réponds uniquement en français. Si l'image est visuellement pertinente, commence exactement par "PERTINENT:" puis donne en une phrase très courte uniquement des caractéristiques visuelles générales utiles (sujet, âge apparent, morphologie, posture, cadrage, décor, lumière). Si elle est hors sujet, commence exactement par "HORS SUJET:". N'identifie aucune personne et ne copie aucun texte de l'image.`;
  const payload = await fetchJson(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task: 'query',
      image: candidate.imageUrl,
      question,
      reasoning: false,
      stream: false,
      temperature: 0,
      max_tokens: 90,
    }),
  }, VISION_TIMEOUT_MS);
  const answer = cleanHint(payload?.result?.answer ?? payload?.answer ?? payload?.result?.response ?? '', 360);
  if (!/^PERTINENT\s*:/i.test(answer)) return null;
  const hint = cleanHint(answer.replace(/^PERTINENT\s*:\s*/i, ''), 300);
  return hint ? { hint, source: candidate.source } : null;
}

function chooseCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const chosen = [];
  const sources = new Set();
  for (const candidate of sorted) {
    if (sources.has(candidate.source)) continue;
    chosen.push(candidate);
    sources.add(candidate.source);
    if (chosen.length >= MAX_VISUAL_HINTS) break;
  }
  return chosen;
}

async function collectVisualHintsUnbounded(prompt) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) return { hints: '', accepted: 0, sources: [] };
  const promptWords = [...new Set(words(prompt))];
  const [google, bluesky] = await Promise.all([
    discoverGoogle(prompt, promptWords),
    discoverBluesky(prompt, promptWords),
  ]);
  const chosen = chooseCandidates([...google, ...bluesky]);
  if (!chosen.length) return { hints: '', accepted: 0, sources: [] };
  const inspected = await Promise.all(chosen.map((candidate) => inspectWithMoondream(candidate, prompt)));
  const accepted = inspected.filter(Boolean);
  if (!accepted.length) return { hints: '', accepted: 0, sources: [] };
  return {
    hints: accepted.map((entry) => entry.hint).join(' ; ').slice(0, 700),
    accepted: accepted.length,
    sources: [...new Set(accepted.map((entry) => entry.source))],
  };
}

export async function collectVisualHints(prompt) {
  const fallback = { hints: '', accepted: 0, sources: [] };
  let timer;
  try {
    return await Promise.race([
      collectVisualHintsUnbounded(prompt),
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), PRESCREEN_TOTAL_TIMEOUT_MS); }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  const image = extractBase64(payload);
  if (!image) {
    const err = new Error('Cloudflare n’a retourné aucune image exploitable.');
    err.status = 502;
    throw err;
  }
  return { dataUri: `data:image/jpeg;base64,${image}`, provider: 'cloudflare', model, size };
}

function pollinationsUrl(prompt, size, requestId) {
  const u = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`);
  u.searchParams.set('width', String(size));
  u.searchParams.set('height', String(size));
  u.searchParams.set('model', 'flux');
  u.searchParams.set('safe', 'false');
  u.searchParams.set('seed', String(seedFor(requestId)));
  return u.toString();
}

async function callPollinations({ prompt, size, requestId }) {
  const response = await fetch(pollinationsUrl(prompt, size, requestId), {
    headers: { Accept: 'image/*' },
    redirect: 'follow',
  });
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`Pollinations HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
    err.status = response.status;
    throw err;
  }
  if (!contentType.startsWith('image/')) {
    const text = await response.text().catch(() => '');
    const err = new Error(`Pollinations a renvoyé ${contentType || 'un contenu inconnu'} au lieu d’une image${text ? `: ${text.slice(0, 160)}` : ''}.`);
    err.status = 502;
    throw err;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) {
    const err = new Error('Pollinations a renvoyé une image vide.');
    err.status = 502;
    throw err;
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    const err = new Error('Image trop volumineuse pour le transfert mobile.');
    err.status = 502;
    throw err;
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
  try {
    const cloudflare = await callCloudflare({ prompt: effectivePrompt, size, requestId, fingerprint });
    if (cloudflare) return { ...cloudflare, visualPreScreening: visual.accepted > 0, visualSources: visual.sources };
  } catch (error) {
    if (!isRetryableProviderFailure(error)) throw error;
    console.warn('cloudflare_transient_fallback', { requestId, status: error?.status || 0, message: error?.message });
  }
  const fallback = await callPollinations({ prompt: effectivePrompt, size: Math.min(size, 768), requestId });
  return { ...fallback, visualPreScreening: visual.accepted > 0, visualSources: visual.sources };
}

function pruneCompleted(now = Date.now()) {
  for (const [key, entry] of completed) {
    if (now - entry.at >= CACHE_TTL_SECONDS * 1000) completed.delete(key);
  }
  if (completed.size > 100) {
    const oldest = [...completed.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, completed.size - 100);
    for (const [key] of oldest) completed.delete(key);
  }
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