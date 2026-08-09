const MAX_QUERY = 500;
const EDGE_TTL_SECONDS = 86400;
const EDGE_STALE_SECONDS = 604800;
const FETCH_TIMEOUT_MS = 1800;
const WEB_RESULT_LIMIT = 3;
const BLUESKY_RESULT_LIMIT = 5;

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

function uniqueScored(items, limit) {
  const seen = new Set();
  const results = [];
  for (const item of [...items].sort((a, b) => b._score - a._score)) {
    const key = `${item.landingUrl}|${item.thumbUrl}`;
    if (!item.landingUrl || !item.thumbUrl || seen.has(key)) continue;
    seen.add(key);
    results.push(item);
    if (results.length >= limit) break;
  }
  return results;
}

function publicItems(items) {
  return items.map(({ _score, ...item }) => item);
}

function compactEnglishQuery(q) {
  const replacements = [
    [/\bchatons?\b/gi, 'kitten'],
    [/\bchats?\b/gi, 'cat'],
    [/\bchiens?\b/gi, 'dog'],
    [/\bhommes?\b/gi, 'man'],
    [/\bfemmes?\b/gi, 'woman'],
    [/\bpersonnes?\b/gi, 'person'],
    [/\btorse nu\b/gi, 'shirtless'],
    [/\bcinquantaine\b/gi, '50s'],
    [/\bsoixantaine\b/gi, '60s'],
    [/\bgrisonnant(e)?s?\b/gi, 'gray-haired'],
    [/\bcheveux\b/gi, 'hair'],
    [/\bbarbe\b/gi, 'beard'],
    [/\bdebout\b/gi, 'standing'],
    [/\bassis(e)?\b/gi, 'sitting'],
    [/\bcuisine\b/gi, 'kitchen'],
    [/\bplage\b/gi, 'beach'],
    [/\bmontagne\b/gi, 'mountain'],
    [/\bcoucher du soleil\b/gi, 'sunset'],
    [/\bphotographie\b/gi, 'photograph'],
    [/\bphoto\b/gi, 'photo'],
    [/\bréaliste\b/gi, 'realistic']
  ];
  const original = clean(q);
  let translated = original;
  for (const [pattern, value] of replacements) translated = translated.replace(pattern, value);
  return translated === original ? '' : translated;
}

async function googleReferences(q, promptWords) {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return { results: [], configured: false };

  const url = new URL('https://customsearch.googleapis.com/customsearch/v1');
  for (const [k, v] of Object.entries({
    key,
    cx,
    q,
    searchType: 'image',
    num: '8',
    safe: 'off',
    filter: '0',
    hl: 'fr',
    gl: 'fr',
    lr: 'lang_fr',
    cr: 'countryFR'
  })) url.searchParams.set(k, v);

  const { response, payload } = await fetchJson(url, { headers: { Accept: 'application/json' } });
  if (!response?.ok) return { results: [], configured: true };

  const candidates = (payload?.items || []).map((item, index) => {
    const landingUrl = item.image?.contextLink || item.link || '';
    const thumbUrl = item.image?.thumbnailLink || item.link || '';
    const context = `${item.title || ''} ${item.snippet || ''} ${item.displayLink || ''}`;
    if (!/^https:\/\//i.test(landingUrl) || !/^https:\/\//i.test(thumbUrl)) return null;
    return {
      id: `google-${item.cacheId || item.link || index}`,
      title: item.title || 'Référence Google Images',
      creator: item.displayLink || 'Google Images France',
      source: 'Google Images',
      sourceType: 'google',
      license: '',
      landingUrl,
      thumbUrl,
      sensitive: false,
      sensitivity: [],
      _score: score(context, promptWords) + 1
    };
  }).filter(Boolean);

  return { configured: true, results: uniqueScored(candidates, WEB_RESULT_LIMIT) };
}

function openverseTags(item) {
  return (Array.isArray(item?.tags) ? item.tags : [])
    .slice(0, 12)
    .map((tag) => clean(tag?.name || tag))
    .filter(Boolean)
    .join(' ');
}

async function openverseQuery(query, scoreWords) {
  if (!query) return [];
  const url = new URL('https://api.openverse.org/v1/images/');
  url.searchParams.set('q', query);
  url.searchParams.set('page_size', '20');
  url.searchParams.set('filter_dead', 'true');
  url.searchParams.set('mature', 'true');

  const { response, payload } = await fetchJson(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'IA-Perso/1.0 (visual reference search)'
    }
  });
  if (!response?.ok) return [];

  return (payload?.results || []).map((item) => {
    const landingUrl = String(item?.foreign_landing_url || item?.detail_url || '').trim();
    const thumbUrl = String(item?.thumbnail || '').trim();
    if (!/^https:\/\//i.test(landingUrl) || !/^https:\/\//i.test(thumbUrl)) return null;

    const title = clean(item?.title) || 'Référence Openverse';
    const context = `${title} ${openverseTags(item)} ${item?.creator || ''} ${item?.source || ''}`;
    const relevance = score(context, scoreWords);
    if (relevance < 2) return null;

    return {
      id: `openverse-${item?.id || thumbUrl}`,
      title,
      creator: clean(item?.creator) || clean(item?.source) || 'Openverse',
      source: 'Openverse',
      sourceType: 'openverse',
      license: clean(item?.license) || 'Licence ouverte — voir la fiche source',
      landingUrl,
      thumbUrl,
      sensitive: Boolean(item?.mature),
      sensitivity: Array.isArray(item?.unstable__sensitivity) ? item.unstable__sensitivity : [],
      _score: relevance + 2
    };
  }).filter(Boolean);
}

async function openverseReferences(q, promptWords) {
  const english = compactEnglishQuery(q);
  const scoreWords = [...new Set([...promptWords, ...words(english)])];
  const batches = await Promise.all([
    openverseQuery(q, scoreWords),
    english ? openverseQuery(english, scoreWords) : Promise.resolve([])
  ]);
  return uniqueScored(batches.flat(), WEB_RESULT_LIMIT);
}

async function commonsQuery(query, scoreWords) {
  if (!query) return [];
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [k, v] of Object.entries({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '20',
    prop: 'imageinfo',
    iiprop: 'url|user|mime',
    iiurlwidth: '480',
    origin: '*'
  })) url.searchParams.set(k, v);

  const { response, payload } = await fetchJson(url, {
    headers: { Accept: 'application/json', 'Api-User-Agent': 'IA-Perso/1.0 (visual reference search)' }
  });
  if (!response?.ok) return [];

  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  return (payload?.query?.pages || []).map((page) => {
    const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
    if (!allowed.has(String(info?.mime || '').toLowerCase())) return null;
    const landingUrl = String(info?.descriptionurl || '').trim();
    const thumbUrl = String(info?.thumburl || info?.url || '').trim();
    const title = clean(String(page?.title || '').replace(/^File:/i, ''));
    if (!/^https:\/\//i.test(landingUrl) || !/^https:\/\//i.test(thumbUrl)) return null;
    const relevance = score(title, scoreWords);
    if (relevance < 2) return null;
    return {
      id: `commons-${page?.pageid || thumbUrl}`,
      title: title || 'Référence Wikimedia Commons',
      creator: info?.user || 'Wikimedia Commons',
      source: 'Wikimedia Commons',
      sourceType: 'commons',
      license: 'Média libre — voir la fiche source',
      landingUrl,
      thumbUrl,
      sensitive: false,
      sensitivity: [],
      _score: relevance + 1
    };
  }).filter(Boolean);
}

async function commonsReferences(q, promptWords) {
  const english = compactEnglishQuery(q);
  const scoreWords = [...new Set([...promptWords, ...words(english)])];
  const batches = await Promise.all([
    commonsQuery(q, scoreWords),
    english ? commonsQuery(english, scoreWords) : Promise.resolve([])
  ]);
  return uniqueScored(batches.flat(), WEB_RESULT_LIMIT);
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
  return handle && rkey
    ? `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`
    : '';
}

async function blueskyQuery(query, promptWords) {
  if (!query) return [];
  const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts');
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'top');
  url.searchParams.set('limit', '20');
  const { response, payload } = await fetchJson(url, { headers: { Accept: 'application/json' } });
  if (!response?.ok) return [];

  const candidates = [];
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
      candidates.push({
        id: `bsky-${post?.cid || thumbUrl}`,
        title: alt || postText || 'Référence Bluesky',
        creator: post?.author?.displayName || post?.author?.handle || 'Bluesky',
        source: 'Bluesky',
        sourceType: 'bluesky',
        license: '',
        landingUrl,
        thumbUrl,
        sensitive: false,
        sensitivity: [],
        _score: score(`${postText} ${alt}`, promptWords) + (alt ? 2 : 0)
      });
    }
  }
  return candidates;
}

async function blueskyReferences(q, promptWords) {
  const english = compactEnglishQuery(q);
  const scoreWords = [...new Set([...promptWords, ...words(english)])];
  const batches = await Promise.all([
    blueskyQuery(q, scoreWords),
    english ? blueskyQuery(english, scoreWords) : Promise.resolve([])
  ]);
  return uniqueScored(batches.flat(), BLUESKY_RESULT_LIMIT);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée.' });
  const q = clean(req.query?.q);
  if (!q) return json(res, 200, { results: [], web: [], google: [], openverse: [], commons: [], bluesky: [] });

  try {
    const promptWords = [...new Set(words(q))];
    const [google, openverse, commons, bluesky] = await Promise.all([
      googleReferences(q, promptWords),
      openverseReferences(q, promptWords),
      commonsReferences(q, promptWords),
      blueskyReferences(q, promptWords)
    ]);

    const webScored = uniqueScored([
      ...google.results,
      ...openverse,
      ...commons
    ], WEB_RESULT_LIMIT);
    const web = publicItems(webScored);
    const blueskyPublic = publicItems(bluesky);
    const results = [...web, ...blueskyPublic];

    return json(res, 200, {
      results,
      web,
      google: publicItems(google.results),
      openverse: publicItems(openverse),
      commons: publicItems(commons),
      bluesky: blueskyPublic,
      providers: ['google-images-fr', 'openverse', 'wikimedia-commons', 'bluesky-public'],
      googleConfigured: google.configured,
      limits: { web: WEB_RESULT_LIMIT, bluesky: BLUESKY_RESULT_LIMIT }
    }, results.length > 0);
  } catch (error) {
    console.error('reference_search_failed', { message: error?.message });
    return json(res, 200, {
      results: [],
      web: [],
      google: [],
      openverse: [],
      commons: [],
      bluesky: [],
      providers: ['google-images-fr', 'openverse', 'wikimedia-commons', 'bluesky-public']
    });
  }
}
