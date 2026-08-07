const prompt = encodeURIComponent('A simple blue circle centered on a clean white background, minimal icon');
const url = `https://image.pollinations.ai/prompt/${prompt}?width=512&height=512&model=flux&safe=true&seed=12345`;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 45000);
try {
  const started = Date.now();
  const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'image/*' } });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`Legacy fast provider HTTP ${response.status}: ${body}`);
  }
  const bytes = (await response.arrayBuffer()).byteLength;
  if (!contentType.startsWith('image/') || bytes < 1000) {
    throw new Error(`Legacy fast provider invalid response: ${contentType}, ${bytes} bytes`);
  }
  console.log(`SUCCESS: fast provider returned ${bytes} bytes (${contentType}) in ${Math.round((Date.now()-started)/1000)}s`);
} finally {
  clearTimeout(timer);
}
