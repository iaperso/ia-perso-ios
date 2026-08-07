import assert from 'node:assert/strict';
import test from 'node:test';
import { findReferences, newRequestId } from './providers.js';

function response(results) {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function item(id) {
  return {
    id,
    title: `Image ${id}`,
    creator: 'Auteur',
    source: 'wikimedia',
    license: 'cc0',
    foreign_landing_url: `https://example.invalid/${id}`,
  };
}

test('newRequestId produces a server-valid identifier', () => {
  const id = newRequestId();
  assert.match(id, /^[a-zA-Z0-9_-]{12,128}$/);
});

test('Openverse stops after three standard references', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return response([item('a'), item('b'), item('c')]);
  };

  try {
    const refs = await findReferences('chat dans un jardin');
    assert.equal(refs.length, 3);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /mature=false/);
    for (const ref of refs) assert.match(ref.thumbUrl, /thumb\/\?compressed=true$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Openverse uses mature=true only to fill missing references and deduplicates', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    urls.push(value);
    return value.includes('mature=true')
      ? response([item('a'), item('b'), item('c')])
      : response([item('a')]);
  };

  try {
    const refs = await findReferences('référence artistique');
    assert.deepEqual(refs.map((ref) => ref.id), ['a', 'b', 'c']);
    assert.equal(urls.length, 2);
    assert.match(urls[0], /mature=false/);
    assert.match(urls[1], /mature=true/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Openverse failure does not block the generated image flow', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('indisponible', { status: 503 });
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    assert.deepEqual(await findReferences('test'), []);
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});
