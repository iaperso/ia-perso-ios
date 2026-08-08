import assert from 'node:assert/strict';
import test from 'node:test';
import { findReferences, newRequestId } from './providers.js';

test('newRequestId produces a server-valid identifier', () => {
  const id = newRequestId();
  assert.match(id, /^[a-zA-Z0-9_-]{12,128}$/);
});

test('Google Images references are fetched only through the local API', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({
      results: [
        { id: 'a', title: 'A', landingUrl: 'https://a.invalid', thumbUrl: 'https://a.invalid/a.jpg', source: 'Google Images' },
        { id: 'b', title: 'B', landingUrl: 'https://b.invalid', thumbUrl: 'https://b.invalid/b.jpg', source: 'Google Images' },
        { id: 'c', title: 'C', landingUrl: 'https://c.invalid', thumbUrl: 'https://c.invalid/c.jpg', source: 'Google Images' }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const refs = await findReferences('chat dans un jardin');
    assert.equal(refs.length, 3);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /^\/api\/references\?q=/);
    assert.equal(refs.every((ref) => ref.source === 'Google Images'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Google Images failure does not block the generated image flow', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('indisponible', { status: 503 });
  try {
    assert.deepEqual(await findReferences('test'), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
