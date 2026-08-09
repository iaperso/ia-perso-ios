const MAX_QUERY = 500;

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY);
}

function postUrl(post) {
  const handle = String(post?.author?.handle || '').trim();
  const rkey = String(post?.uri || '').split('/').pop() || '';
  return handle && rkey
    ? `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`
    : '';
}

function blocked(post) {
  const denied = new Set(['!hide', '!no-unauthenticated', '!takedown']);
  const labels = [
    ...(Array.isArray(post?.labels) ? post.labels : []),
    ...(Array.isArray(post?.author?.labels) ? post.author.labels : []),
  ];
  return labels.some((label) => denied.has(String(label?.val || '')));
}

function collectImages(post) {
  const direct = Array.isArray(post?.embed?.images) ? post.embed.images : [];
  const media = Array.isArray(post?.embed?.media?.images) ? post.embed.media.images : [];
  return [...direct, ...media]
    .map((image, index) => ({
      id: `${post?.cid || post?.uri || 'post'}-${index}`,
      thumb: String(image?.thumb || image?.fullsize || '').trim(),
      fullsize: String(image?.fullsize || image?.thumb || '').trim(),
      alt: clean(image?.alt),
    }))
    .filter((image) => /^https:\/\//i.test(image.fullsize));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  const q = clean(req.query?.q);
  const sort = req.query?.sort === 'latest' ? 'latest' : 'top';
  const cursor = clean(req.query?.cursor);
  if (!q) {
    res.status(200).json({ posts: [], cursor: null });
    return;
  }

  try {
    const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts');
    url.searchParams.set('q', q);
    url.searchParams.set('sort', sort);
    url.searchParams.set('limit', '50');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status).json({ error: payload?.message || 'Recherche Bluesky indisponible.' });
      return;
    }

    const posts = [];
    for (const post of payload?.posts || []) {
      if (blocked(post)) continue;
      const images = collectImages(post);
      const landingUrl = postUrl(post);
      if (!images.length || !landingUrl) continue;
      posts.push({
        uri: post.uri,
        cid: post.cid,
        text: clean(post?.record?.text),
        createdAt: post?.record?.createdAt || post?.indexedAt || null,
        author: {
          handle: String(post?.author?.handle || ''),
          displayName: String(post?.author?.displayName || ''),
          avatar: String(post?.author?.avatar || ''),
        },
        landingUrl,
        images,
      });
    }

    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
    res.status(200).json({ posts, cursor: payload?.cursor || null });
  } catch (error) {
    console.error('bluesky_search_failed', error);
    res.status(500).json({ error: 'Impossible de contacter Bluesky.' });
  }
}
