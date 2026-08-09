import assert from 'node:assert/strict';
import test from 'node:test';
import handler, { enhancePrompt, seedFor } from './generate.js';

function invoke(body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = String(value); },
      end(payload = '') {
        try {
          resolve({ status: this.statusCode, headers, body: payload ? JSON.parse(payload) : null });
        } catch (error) { reject(error); }
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

function imageResponse(bytes = 'abc') {
  return new Response(Buffer.from(bytes), { status: 200, headers: { 'content-type': 'image/jpeg' } });
}

test('enhancePrompt preserves the explicit request and adds only the default visual guidance', () => {
  const prompt = 'Un homme torse nu de cinquante ans dans une cuisine';
  const enhanced = enhancePrompt(prompt);
  assert.match(enhanced, /^Un homme torse nu de cinquante ans dans une cuisine\./);
  assert.match(enhanced, /sans en ajouter ni en retirer/);
  assert.match(enhanced, /européen contemporain, naturel et photoréaliste/);
  assert.doesNotMatch(enhanced, /vêtement/i);
  assert.ok(enhanced.length <= 1800);
});

test('seedFor is stable for one request id', () => {
  const a = seedFor('stable-request-1001');
  const b = seedFor('stable-request-1001');
  assert.equal(a, b);
  assert.equal(Number.isInteger(a), true);
  assert.ok(a >= 0 && a <= 2147483647);
});

test('rejects methods other than POST', async () => {
  const response = await invoke(null, 'GET');
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'POST');
});

test('Pollinations fallback is server-side, bounded, uses safe=false and is cached', async () => {
  withoutCloudflare();
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let capturedSignal;
  globalThis.fetch = async (url, options = {}) => {
    requestedUrl = String(url);
    capturedSignal = options.signal;
    return imageResponse('image-bytes');
  };
  try {
    const body = { prompt: 'un cercle bleu minimal', size: 512, requestId: 'fallback-request-1001' };
    const first = await invoke(body);
    const second = await invoke(body);
    assert.equal(first.status, 200);
    assert.equal(first.body.provider, 'pollinations');
    assert.equal(first.body.degraded, true);
    assert.match(first.body.dataUri, /^data:image\/jpeg;base64,/);
    assert.match(requestedUrl, /^https:\/\/image\.pollinations\.ai\/prompt\//);
    assert.match(requestedUrl, /safe=false/);
    assert.match(decodeURIComponent(requestedUrl), /européen contemporain/);
    assert.ok(capturedSignal instanceof AbortSignal);
    assert.equal(second.status, 200);
    assert.equal(second.body.cached, true);
    assert.equal(second.body.dataUri, first.body.dataUri);
  } finally { globalThis.fetch = originalFetch; }
});

test('same requestId cannot be reused with another prompt', async () => {
  withoutCloudflare();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => imageResponse();
  try {
    const requestId = 'conflict-request-1001';
    assert.equal((await invoke({ prompt: 'image A', size: 512, requestId })).status, 200);
    const conflict = await invoke({ prompt: 'image B', size: 512, requestId });
    assert.equal(conflict.status, 409);
  } finally { globalThis.fetch = originalFetch; }
});

test('fallback caps HD output to 768', async () => {
  withoutCloudflare();
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => { requestedUrl = String(url); return imageResponse(); };
  try {
    const response = await invoke({ prompt: 'paysage', size: 1024, requestId: 'fallback-hd-1001' });
    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'pollinations');
    assert.equal(response.body.size, 768);
    assert.match(requestedUrl, /width=768/);
    assert.match(requestedUrl, /height=768/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Cloudflare Klein keeps prompt payload private, disables provider retries and uses an AbortSignal', async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  process.env.CLOUDFLARE_AI_GATEWAY_ID = 'default';
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options = {}) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ success: true, result: { image: 'YWJj' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const response = await invoke({ prompt: 'robot dans une forêt', size: 512, requestId: 'cloudflare-klein-1001' });
    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'cloudflare');
    assert.match(captured.url, /flux-2-klein-4b$/);
    assert.equal(captured.options.headers['cf-aig-max-attempts'], '1');
    assert.equal(captured.options.headers['cf-aig-collect-log-payload'], 'false');
    assert.ok(captured.options.signal instanceof AbortSignal);
    assert.ok(captured.options.body instanceof FormData);
    assert.match(String(captured.options.body.get('prompt')), /européen contemporain/);
    assert.match(String(captured.options.body.get('seed')), /^\d+$/);
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
  globalThis.fetch = async (url, options = {}) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ success: true, result: { image: 'YWJj' } }), { status: 200 });
  };
  try {
    const response = await invoke({ prompt: 'montagne', size: 1024, requestId: 'cloudflare-hd-1001' });
    assert.equal(response.status, 200);
    assert.match(captured.url, /flux-1-schnell$/);
    const body = JSON.parse(captured.options.body);
    assert.equal(body.width, 1024);
    assert.equal(body.height, 1024);
    assert.equal(body.steps, 4);
    assert.match(body.prompt, /européen contemporain/);
    assert.equal(Number.isInteger(body.seed), true);
  } finally {
    globalThis.fetch = originalFetch;
    withoutCloudflare();
  }
});

test('retryable Cloudflare failure falls back once to Pollinations', async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test';
  process.env.CLOUDFLARE_API_TOKEN = 'token-test';
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('api.cloudflare.com')) {
      return new Response(JSON.stringify({ success: false, errors: [{ message: 'quota temporaire' }] }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
    return imageResponse('fallback-image');
  };
  try {
    const response = await invoke({ prompt: 'portrait naturel', size: 512, requestId: 'retry-fallback-1001' });
    assert.equal(response.status, 200);
    assert.equal(response.body.provider, 'pollinations');
    assert.equal(calls.filter((url) => url.includes('api.cloudflare.com')).length, 1);
    assert.equal(calls.filter((url) => url.includes('pollinations.ai')).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    withoutCloudflare();
  }
});
