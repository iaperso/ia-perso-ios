import assert from 'node:assert/strict';
import test from 'node:test';
import { findReferences, newRequestId } from './providers.js';

function response(results) {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function item(id, extra = {}) {
  return {
    id,
    title: `Image ${id}`,
    creator: 'Auteur',
    source: 'wikimedia',
    license: 'cc0',
    foreign_landing_url: `https://example.invalid/${id}`,
    ...extra,
  };
}

test('newRequestId produces a server-valid identifier', () => {
  const id = newRequestId();
  assert.match(id, /^[a-zA-Z0-9_-]{12,128}$/);
});

test('Openverse stops after three standard references without requesting sensitive results', async () => {
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
    assert.doesNotMatch(urls[0], /unstable__include_sensitive_results=true/);
    for (const ref of refs) {
      assert.equal(ref.sensitive, false);
      assert.match(ref.thumbUrl, /thumb\/\?compressed=true$/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Openverse includes flagged sensitive results only to fill missing references and keeps the flag', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    urls.push(value);
    return value.includes('unstable__include_sensitive_results=true')
      ? response([item('a'), item('b', { unstable__sensitivity: ['sensitive_text'] }), item('c')])
      : response([item('a')]);
  };

  try {
    const refs = await findReferences('référence artistique');
    assert.deepEqual(refs.map((ref) => ref.id), ['a', 'b', 'c']);
    assert.equal(urls.length, 2);
    assert.doesNotMatch(urls[0], /unstable__include_sensitive_results=true/);
    assert.match(urls[1], /unstable__include_sensitive_results=true/);
    assert.equal(refs[1].sensitive, true);
    assert.deepEqual(refs[1].sensitivity, ['sensitive_text']);
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
