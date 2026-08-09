const MAX_QUERY = 500;
const EDGE_TTL_SECONDS = 86400;
const EDGE_STALE_SECONDS = 604800;
const FETCH_TIMEOUT_MS = 1800;
const RESULT_LIMIT = 3;

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

function words(value) {
  return clean(value)
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]{3,}/g) || [];
}

function score(text, promptWords) {
  const haystack = new Set(words(text));
  return promptWords.reduce((total, word) => total + (haystack.has(word) ? 2 : 0), 0);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } catch {
    return { response: null, payload: {} };
  } finally {
    clearTimeout(timer);
  }
}

async function googleReferences(q, promptWords) {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return { results: [], configured: false };

  const url = new URL('https://customsearch.googleapis.com/customsearch/v1');
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', q);
  url.searchParams.set('searchType', 'image');
  url.searchParams.set('num', '6');
  url.searchParams.set('safe', 'off');
  url.searchParams.set('filter', '0');
  url.searchParams.set('hl', 'fr');
  url.searchParams.set('gl', 'fr');
  url.searchParams.set('lr', 'lang_fr');
  url.searchParams.set('cr', 'countryFR');

  const { response, payload } = await fetchJson(url, { headers: { Accept: 'application/json' } });
  if (!response?.ok) {
    if (response) console.error('google_images_failed', { status: response.status, message: payload?.error?.message });
    return { results: [], configured: true };
  }

  return {
    configured: true,
    results: (payload?.items || []).map((item, index) => {
      const landingUrl = item.image?.contextLink || item.link || '';
      const thumbUrl = item.image?.thumbnailLink || item.link || '';
      const context = `${item.title || ''} ${item.snippet || ''} ${item.displayLink || ''}`;
      if (!/^https:\/\//i.test(landingUrl) || !/^https:\/\//i.test(thumbUrl)) return null;
      return {
        id: `google-${item.cacheId || item.link || index}`,
        title: item.title || 'Référence Google Images',
        creator: item.displayLink || 'Google Images France',
        source: 'Google Images France',
        license: '',
        landingUrl,
        thumbUrl,
        sensitive: false,
        sensitivity: [],
        _score: score(context, promptWords) + 1
      };
    }).filter(Boolean)
  };
}

function hasMandatoryBlueskyRestriction(post) {
  const blocked = new Set(['!hide', '!no-unauthenticated', '!takedown']);
  const labels = [
    ...(Array.isArray(post?.labels) ? post.labels : []),
    ...(Array.isArray(post?.author?.labels) ? post.author.labels : [])
  ];
  return labels.some((label) => blocked.has(String(label?.val || '')));
}

function blueskyLandingUrl(post) {
  const handle = String(post?.author?.handle || '').trim();
  const uri = String(post?.uri || '');
  const rkey = uri.split('/').pop() || '';
  return handle && rkey ? `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}` : '';
}

async function blueskyReferences(q, promptWords) {
  const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts');
  url.searchParams.set('q', q);
  url.searchParams.set('sort', 'top');
  url.searchParams.set('limit', '10');

  const { response, payload } = await fetchJson(url, { headers: { Accept: 'application/json' } });
  if (!response?.ok) return [];

  const results = [];
  for (const post of payload?.posts || []) {
    if (hasMandatoryBlueskyRestriction(post)) continue;
    const landingUrl = blueskyLandingUrl(post);
    if (!landingUrl) continue;
    const postText = clean(post?.record?.text);
    const direct = Array.isArray(post?.embed?.images) ? post.embed.images : [];
    const media = Array.isArray(post?.embed?.media?.images) ? post.embed.media.images : [];
    for (const image of [...direct, ...media]) {
      const thumbUrl = String(image?.thumb || image?.fullsize || '').trim();
      if (!/^https:\/\//i.test(thumbUrl)) continue;
      const alt = clean(image?.alt);
      results.push({
        id: `bsky-${post?.cid || thumbUrl}`,
        title: alt || postText || 'Référence Bluesky',
        creator: post?.author?.displayName || post?.author?.handle || 'Bluesky',
        source: 'Bluesky public',
        license: '',
        landingUrl,
        thumbUrl,
        sensitive: false,
        sensitivity: [],
        _score: score(`${postText} ${alt}`, promptWords) + (alt ? 2 : 0)
      });
    }
  }
  return results;
}

function mergeReferences(google, bluesky) {
  const candidates = [...google, ...bluesky].sort((a, b) => b._score - a._score);
  const chosen = [];
  const seen = new Set();
  const sources = new Set();

  for (const item of candidates) {
    const key = `${item.landingUrl}|${item.thumbUrl}`;
    if (seen.has(key)) continue;
    if (chosen.length < 2 && sources.has(item.source) && candidates.some((candidate) => !sources.has(candidate.source))) continue;
    seen.add(key);
    sources.add(item.source);
    const { _score, ...publicItem } = item;
    chosen.push(publicItem);
    if (chosen.length >= RESULT_LIMIT) break;
  }
  return chosen;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée.' });

  const q = clean(req.query?.q);
  if (!q) return json(res, 200, { results: [] });

  try {
    const promptWords = [...new Set(words(q))];
    const [google, bluesky] = await Promise.all([
      googleReferences(q, promptWords),
      blueskyReferences(q, promptWords)
    ]);
    const results = mergeReferences(google.results, bluesky);
    return json(res, 200, {
      results,
      providers: ['google-images-fr', 'bluesky-public'],
      googleConfigured: google.configured
    }, results.length > 0);
  } catch (error) {
    console.error('reference_search_failed', { message: error?.message });
    return json(res, 200, { results: [], providers: ['google-images-fr', 'bluesky-public'] });
  }
}
