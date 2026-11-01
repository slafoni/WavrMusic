export function parseYouTubeVideoId(value: string): string {
  const raw = String(value || '').trim();
  const idPattern = /^[a-zA-Z0-9_-]{11}$/;
  if (idPattern.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return '';
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  let candidate = '';
  if (hostname === 'youtu.be') {
    candidate = url.pathname.split('/').filter(Boolean)[0] || '';
  } else if (
    hostname === 'youtube.com' ||
    hostname.endsWith('.youtube.com') ||
    hostname === 'youtube-nocookie.com'
  ) {
    if (url.pathname === '/watch') {
      candidate = url.searchParams.get('v') || '';
    } else {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) {
        candidate = parts[1];
      }
    }
  }
  return idPattern.test(candidate) ? candidate : '';
}
