import assert from 'node:assert/strict';
import test from 'node:test';
import handler from './generate.js';

function invoke(body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = String(value); },
      end(payload = '') {
        try {
          resolve({
            status: this.statusCode,
            headers,
            body: payload ? JSON.parse(payload) : null,
          });
        } catch (error) {
          reject(error);
        }
      },
    };
    Promise.resolve(handler({ method, body }, res)).catch(reject);
  });
}

function withoutCloudflare() {
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_AI_GATEWAY_ID;
}

test('rejects methods other than POST', async () => {
  const response = await invoke(null, 'GET');
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'POST');
});

test('fallback returns one deterministic Pollinations URL and reuses completed request', async () => {
  withoutCloudflare();
  const body = { prompt: 'un cercle bleu minimal', size: 512, requestId: 'test-request-0001' };
  const first = await invoke(body);
  const second = await invoke(body);

  assert.equal(first.status, 200);
  assert.equal(first.body.provider, 'pollinations');
  assert.equal(first.body.degraded, true);
  assert.match(first.body.imageUrl, /^https:\/\/image\.pollinations\.ai\/prompt\//);
  assert.match(first.body.imageUrl, /safe=true/);
  assert.equal(second.status, 200);
  assert.equal(second.body.cached, true);
  assert.equal(second.body.imageUrl, first.body.imageUrl);
});

test('same requestId cannot be reused with another prompt', async () => {
  withoutCloudflare();
  const requestId = 'test-request-0002';
  assert.equal((await invoke({ prompt: 'image A', size: 512, requestId })).status, 200);
  const conflict = await invoke({ prompt: 'image B', size: 512, requestId });
  assert.equal(conflict.status, 409);
});

test('fallback caps HD output to 768 without starting another provider', async () => {
  withoutCloudflare();
  const response = await invoke({ prompt: 'paysage', size: 1024, requestId: 'test-request-0003' });
  assert.equal(response.status, 200);
  assert.equal(response.body.provider, 'pollinations');
  assert.equal(response.body.size, 768);
  assert.match(response.body.imageUrl, /width=768&height=768/);
});

test('Cloudflare Klein request keeps payload private, disables retries and uses deterministic seed', async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  process.env.CLOUDFLARE_AI_GATEWAY_ID = 'default';
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ success: true, result: { image: 'YWJj' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const body = { prompt: 'robot dans une forêt', size: 512, requestId: 'test-request-0004' };
    const first = await invoke(body);
    assert.equal(first.status, 200);
    assert.equal(first.body.provider, 'cloudflare');
    assert.match(captured.url, /flux-2-klein-4b$/);
    assert.equal(captured.options.headers['cf-aig-max-attempts'], '1');
    assert.equal(captured.options.headers['cf-aig-collect-log-payload'], 'false');
    assert.ok(captured.options.body instanceof FormData);
    const seed = captured.options.body.get('seed');
    assert.match(String(seed), /^\d+$/);

    const second = await invoke(body);
    assert.equal(second.body.cached, true);
    assert.equal(second.body.dataUri, first.body.dataUri);
  } finally {
    globalThis.fetch = originalFetch;
    withoutCloudflare();
  }
});

test('Cloudflare HD route selects Schnell with four steps', async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ success: true, result: { image: 'YWJj' } }), { status: 200 });
  };

  try {
    const response = await invoke({ prompt: 'montagne', size: 1024, requestId: 'test-request-0005' });
    assert.equal(response.status, 200);
    assert.match(captured.url, /flux-1-schnell$/);
    const body = JSON.parse(captured.options.body);
    assert.equal(body.width, 1024);
    assert.equal(body.height, 1024);
    assert.equal(body.steps, 4);
    assert.equal(Number.isInteger(body.seed), true);
  } finally {
    globalThis.fetch = originalFetch;
    withoutCloudflare();
  }
});
