import { generateHorde } from './providers.js';

const preflight = await fetch('https://aihorde.net/api/v2/generate/async', {
  method: 'OPTIONS',
  headers: {
    Origin: 'https://example.com',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'apikey,content-type,client-agent',
  },
});
const allowOrigin = preflight.headers.get('access-control-allow-origin') || '';
if (!preflight.ok || !(allowOrigin === '*' || allowOrigin.includes('example.com'))) {
  throw new Error(`AI Horde CORS preflight failed: HTTP ${preflight.status}, ACAO=${allowOrigin || 'missing'}`);
}
console.log(`CORS OK: ${allowOrigin}`);

const started = Date.now();
const url = await generateHorde('A simple blue circle centered on a clean white background, minimal icon', {
  timeoutMs: 480000,
  onStatus: (message) => console.log(`[provider] ${message}`),
});

let bytes = 0;
if (url.startsWith('data:image/')) {
  const comma = url.indexOf(',');
  bytes = Buffer.from(url.slice(comma + 1), 'base64').length;
} else {
  const response = await fetch(url, { headers: { Accept: 'image/*' } });
  if (!response.ok) throw new Error(`Generated image download failed: HTTP ${response.status}`);
  bytes = (await response.arrayBuffer()).byteLength;
}

if (bytes < 1000) throw new Error(`Generated image is unexpectedly small (${bytes} bytes)`);
console.log(`SUCCESS: generated and downloaded ${bytes} bytes in ${Math.round((Date.now() - started) / 1000)}s`);
