const MAX_QUERY = 500;
const EDGE_TTL_SECONDS = 86400;
const EDGE_STALE_SECONDS = 604800;

function json(res, status, body, cache = false) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cache && status === 200) {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${EDGE_TTL_SECONDS}, stale-while-revalidate=${EDGE_STALE_SECONDS}, stale-if-error=${EDGE_STALE_SECONDS}`);
  } else {
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  }
  res.end(JSON.stringify(body));
}

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY);
}

async function googleReferences(q) {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return { results: [], configured: false };

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', q);
  url.searchParams.set('searchType', 'image');
  url.searchParams.set('num', '10');
  url.searchParams.set('safe', 'off');
  url.searchParams.set('filter', '0');
  url.searchParams.set('hl', 'fr');
  url.searchParams.set('gl', 'fr');
  url.searchParams.set('lr', 'lang_fr');
  url.searchParams.set('cr', 'countryFR');

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('google_images_failed', { status: response.status, message: payload?.error?.message });
    return { results: [], configured: true };
  }

  const seen = new Set();
  const results = [];
  for (const [index, item] of (payload?.items || []).entries()) {
    const landingUrl = item.image?.contextLink || item.link || '#';
    const thumbUrl = item.image?.thumbnailLink || item.link || '';
    const key = `${landingUrl}|${thumbUrl}`;
    if (!thumbUrl || landingUrl === '#' || seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: item.cacheId || item.link || String(index),
      title: item.title || 'Référence Google Images',
      creator: item.displayLink || '',
      source: 'Google Images France',
      license: '',
      landingUrl,
      thumbUrl,
      sensitive: false,
      sensitivity: []
    });
    if (results.length >= 3) break;
  }
  return { results, configured: true };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée.' });

  const q = clean(req.query?.q);
  if (!q) return json(res, 200, { results: [] });

  try {
    const google = await googleReferences(q);
    return json(res, 200, {
      results: google.results,
      provider: 'google-images-fr',
      configured: google.configured
    }, google.results.length > 0);
  } catch (error) {
    console.error('reference_search_failed', { message: error?.message });
    return json(res, 200, { results: [], provider: 'google-images-fr', configured: true });
  }
}
