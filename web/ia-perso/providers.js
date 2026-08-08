const OPENVERSE = 'https://api.openverse.org/v1/images/';
const GENERATION_TIMEOUT_MS = 90000;
const OPENVERSE_TIMEOUT_MS = 8000;

export function newRequestId() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '');
}

async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function generateRemote(prompt, { size = 512, requestId } = {}) {
  let response;
  try {
    response = await fetchWithTimeout('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, size, requestId })
    }, GENERATION_TIMEOUT_MS);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La génération distante a dépassé 90 secondes.');
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Génération HTTP ${response.status}`);
  return payload;
}

function buildOpenverseUrl(prompt) {
  const u = new URL(OPENVERSE);
  u.searchParams.set('q', prompt);
  u.searchParams.set('page_size', '3');
  u.searchParams.set('page', '1');
  u.searchParams.set('filter_dead', 'true');
  u.searchParams.set('unstable__include_sensitive_results', 'true');
  return u.toString();
}

function normalizeSensitivity(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === 'string' ? entry : (entry?.name || entry?.label || '')).filter(Boolean);
}

function normalizeReference(item) {
  if (!item?.id) return null;
  const sensitivity = normalizeSensitivity(item.unstable__sensitivity);
  return {
    id: item.id,
    title: item.title || 'Référence visuelle',
    creator: item.creator || '',
    source: item.source || item.provider || 'Openverse',
    license: item.license || '',
    landingUrl: item.foreign_landing_url || item.url || '#',
    thumbUrl: `https://api.openverse.org/v1/images/${encodeURIComponent(item.id)}/thumb/?compressed=true`,
    sensitive: sensitivity.length > 0 || item.mature === true,
    sensitivity
  };
}

export async function findReferences(prompt) {
  try {
    const response = await fetchWithTimeout(buildOpenverseUrl(prompt), {
      headers: { Accept: 'application/json' },
      referrerPolicy: 'no-referrer'
    }, OPENVERSE_TIMEOUT_MS);
    if (!response.ok) throw new Error(`Openverse HTTP ${response.status}`);
    const payload = await response.json();
    return (payload?.results || []).map(normalizeReference).filter(Boolean).slice(0, 3);
  } catch (error) {
    console.warn('Openverse indisponible ou trop lent', error);
    return [];
  }
}
