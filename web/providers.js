const HORDE_ROOT = 'https://aihorde.net/api/v2';
const HORDE_CLIENT_AGENT = 'IA-Perso:1.1:github.com/iaperso/ia-perso-ios';
const ANONYMOUS_API_KEY = '0000000000';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch indisponible.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Réponse invalide du fournisseur (HTTP ${response.status}).`);
  }
}

export async function pickHordeModel({ fetchImpl = globalThis.fetch } = {}) {
  try {
    const response = await fetchWithTimeout(
      `${HORDE_ROOT}/status/models?type=image`,
      { headers: { Accept: 'application/json', 'Client-Agent': HORDE_CLIENT_AGENT } },
      15000,
      fetchImpl,
    );
    if (!response.ok) return null;
    const models = await readJson(response);
    if (!Array.isArray(models)) return null;

    const active = models.filter((m) => m && typeof m.name === 'string' && Number(m.count || 0) > 0);
    if (!active.length) return null;

    const preferredNames = [
      'AlbedoBase XL (SDXL)',
      'Deliberate',
      'Dreamshaper',
      'stable_diffusion',
    ];
    for (const wanted of preferredNames) {
      const match = active.find((m) => m.name.toLowerCase() === wanted.toLowerCase());
      if (match) return match.name;
    }

    active.sort((a, b) => {
      const countDelta = Number(b.count || 0) - Number(a.count || 0);
      if (countDelta) return countDelta;
      return Number(a.eta || 0) - Number(b.eta || 0);
    });
    return active[0].name;
  } catch (error) {
    console.warn('AI Horde model discovery failed', error);
    return null;
  }
}

export async function generateHorde(
  promptText,
  {
    onStatus = () => {},
    timeoutMs = 480000,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const prompt = String(promptText || '').trim();
  if (!prompt) throw new Error('Décris d’abord une image.');

  onStatus('Recherche d’un GPU communautaire…');
  const model = await pickHordeModel({ fetchImpl });

  const payload = {
    prompt,
    params: {
      n: 1,
      width: 512,
      height: 512,
      steps: 8,
      cfg_scale: 5,
      sampler_name: 'k_euler_a',
      karras: true,
    },
    nsfw: false,
    censor_nsfw: true,
    shared: false,
    slow_workers: true,
    allow_downgrade: true,
    r2: true,
  };
  if (model) payload.models = [model];

  const queuedResponse = await fetchWithTimeout(
    `${HORDE_ROOT}/generate/async`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: ANONYMOUS_API_KEY,
        'Client-Agent': HORDE_CLIENT_AGENT,
      },
      body: JSON.stringify(payload),
    },
    30000,
    fetchImpl,
  );
  const queued = await readJson(queuedResponse);
  if (!queuedResponse.ok || !queued.id) {
    throw new Error(queued.message || `AI Horde HTTP ${queuedResponse.status}`);
  }

  const id = queued.id;
  const started = Date.now();
  let lastQueuePosition = null;

  while (Date.now() - started < timeoutMs) {
    await sleep(3000);
    const checkResponse = await fetchWithTimeout(
      `${HORDE_ROOT}/generate/check/${encodeURIComponent(id)}`,
      { headers: { Accept: 'application/json', 'Client-Agent': HORDE_CLIENT_AGENT } },
      15000,
      fetchImpl,
    );
    if (!checkResponse.ok) continue;
    const check = await readJson(checkResponse);
    if (check.faulted) throw new Error('Le GPU communautaire a interrompu la génération.');
    if (check.is_possible === false) throw new Error('Aucun GPU compatible n’est disponible pour cette demande.');

    if (Number.isFinite(Number(check.queue_position))) {
      const pos = Number(check.queue_position);
      if (pos !== lastQueuePosition) {
        lastQueuePosition = pos;
        const wait = Number(check.wait_time || 0);
        onStatus(pos > 0 ? `File d’attente : ${pos}${wait > 0 ? ` · ~${wait}s` : ''}` : 'Création de l’image…');
      }
    }

    if (!check.done) continue;

    const doneResponse = await fetchWithTimeout(
      `${HORDE_ROOT}/generate/status/${encodeURIComponent(id)}`,
      { headers: { Accept: 'application/json', 'Client-Agent': HORDE_CLIENT_AGENT } },
      20000,
      fetchImpl,
    );
    const done = await readJson(doneResponse);
    if (!doneResponse.ok) throw new Error(done.message || `AI Horde HTTP ${doneResponse.status}`);
    const generation = done.generations?.find((item) => item && item.state !== 'faulted' && item.img);
    if (!generation?.img) throw new Error('Le réseau communautaire n’a renvoyé aucune image.');
    if (generation.censored) throw new Error('L’image a été filtrée par le fournisseur.');

    const value = String(generation.img);
    if (/^https?:\/\//i.test(value) || value.startsWith('data:image/')) return value;
    return `data:image/webp;base64,${value}`;
  }

  throw new Error('La génération a dépassé 8 minutes. Réessaie : la file gratuite est probablement chargée.');
}
