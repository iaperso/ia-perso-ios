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
  if (!key || !cx) return null;

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
    return null;
  }

  return (payload?.items || []).slice(0, 3).map((item, index) => ({
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
}

async function commonsReferences(q) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', q);
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrlimit', '3');
  url.searchParams.set('prop', 'imageinfo|info');
  url.searchParams.set('iiprop', 'url|mime');
  url.searchParams.set('iiurlwidth', '640');
  url.searchParams.set('inprop', 'url');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'IA-Perso/1.0 visual-reference-search'
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Wikimedia Commons HTTP ${response.status}`);

  const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];
  return pages.map((page, index) => {
    const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
    const thumbUrl = info?.thumburl || info?.url || '';
    return {
      id: `commons-${page.pageid || index}`,
      title: String(page.title || '').replace(/^File:/, '') || 'Référence Wikimedia Commons',
      creator: '',
      source: 'Wikimedia Commons',
      license: '',
      landingUrl: page.fullurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title || '').replace(/ /g, '_'))}`,
      thumbUrl,
      sensitive: false,
      sensitivity: []
    };
  }).filter((item) => item.thumbUrl && item.landingUrl).slice(0, 3);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée.' });

  const q = clean(req.query?.q);
  if (!q) return json(res, 200, { results: [] });

  try {
    const google = await googleReferences(q);
    if (google?.length) {
      return json(res, 200, { results: google, provider: 'google-images', configured: true }, true);
    }

    const commons = await commonsReferences(q);
    return json(res, 200, { results: commons, provider: 'wikimedia-commons', configured: true }, true);
  } catch (error) {
    console.error('reference_search_failed', { message: error?.message });
    return json(res, 200, { results: [], provider: 'reference-fallback', configured: true });
  }
}
