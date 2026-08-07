import { pickHordeModel } from './providers.js';

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

const model = await pickHordeModel();
if (!model) throw new Error('AI Horde is reachable but no active image model was discovered.');
console.log(`SUCCESS: fallback CORS=${allowOrigin}, active model=${model}`);
