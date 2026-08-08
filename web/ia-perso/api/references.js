const MAX_QUERY = 500;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  res.end(JSON.stringify(body));
}

function clean(value) {
  return String(value || '').trim().slice(0, MAX_QUERY);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée.' });

  const q = clean(req.query?.q);
  if (!q) return json(res, 200, { results: [] });

  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return json(res, 200, { results: [], provider: 'google-images', configured: false });

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', q);
  url.searchParams.set('searchType', 'image');
  url.searchParams.set('num', '3');
  url.searchParams.set('safe', 'off');
  url.searchParams.set('filter', '0');

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('google_images_failed', { status: response.status, message: payload?.error?.message });
    return json(res, 200, { results: [], provider: 'google-images', configured: true });
  }

  const results = (payload?.items || []).slice(0, 3).map((item, index) => ({
    id: item.cacheId || item.link || String(index),
    title: item.title || 'Référence Google Images',
    creator: item.displayLink || '',
    source: 'Google Images',
    license: '',
    landingUrl: item.image?.contextLink || item.link || '#',
    thumbUrl: item.image?.thumbnailLink || item.link || '',
    sensitive: false,
    sensitivity: []
  })).filter((item) => item.thumbUrl && item.landingUrl !== '#');

  return json(res, 200, { results, provider: 'google-images', configured: true });
}
