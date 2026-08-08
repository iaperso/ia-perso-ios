const GENERATION_TIMEOUT_MS = 90000;
const REFERENCES_TIMEOUT_MS = 8000;

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

export async function findReferences(prompt) {
  try {
    const response = await fetchWithTimeout(`/api/references?q=${encodeURIComponent(prompt)}`, {
      headers: { Accept: 'application/json' },
      referrerPolicy: 'no-referrer'
    }, REFERENCES_TIMEOUT_MS);
    if (!response.ok) return [];
    const payload = await response.json().catch(() => ({}));
    return Array.isArray(payload?.results) ? payload.results.slice(0, 3) : [];
  } catch (error) {
    console.warn('Google Images indisponible ou trop lent', error);
    return [];
  }
}
