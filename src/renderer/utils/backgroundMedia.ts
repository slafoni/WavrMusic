const VIDEO_BACKGROUND_EXTENSION = /\.(mp4)(?:[?#]|$)/i;

export function isVideoPageBackground(url?: string | null): boolean {
  return VIDEO_BACKGROUND_EXTENSION.test(String(url || '').trim());
}

export function synchronizedBackgroundTime(
  duration: number,
  introEnd: number,
  songTime: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const loopStart = Math.max(0, Math.min(introEnd, duration - 0.25));
  const span = duration - loopStart;
  if (span <= 0) return loopStart;
  return loopStart + (Math.max(0, songTime) % span);
}

