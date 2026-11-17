'use strict';
// Usage: node scripts/check-seeking.js 'https://your-jellyfin/Videos/ID/stream.mkv?Static=true&ApiKey=...'
// Only run locally: the URL contains a private Jellyfin API key. It is never printed.
async function main() {
  const raw = process.argv[2];
  let url;
  try { url = new URL(raw); } catch { /* handled below */ }
  if (!url || !['http:', 'https:'].includes(url.protocol)) {
    console.error('Usage: node scripts/check-seeking.js "<private stream URL>"');
    process.exitCode = 2;
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    // Only download 2 bytes to verify byte-range support. Avoid buffering whole video.
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-1', 'Accept-Encoding': 'identity' },
      signal: controller.signal,
    });
    console.log(`HTTP status: ${res.status}`);
    console.log(`Accept-Ranges: ${res.headers.get('accept-ranges') || '(missing)'}`);
    console.log(`Content-Range: ${res.headers.get('content-range') || '(missing)'}`);
    console.log(`Content-Type: ${res.headers.get('content-type') || '(missing)'}`);
    console.log(`Content-Length: ${res.headers.get('content-length') || '(missing)'}`);
    await res.body?.cancel();
    if (res.status === 206 && /^bytes 0-1\/\d+$/i.test(res.headers.get('content-range') || '')) {
      console.log('PASS: the video endpoint supports byte-range seeking.');
    } else {
      console.log('FAIL: the endpoint did not return a valid 206 + Content-Range response.');
      console.log('Check Jellyfin server, reverse proxy, and that this is the Static=true source.');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Stream check failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}
main();
