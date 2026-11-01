import { describe, expect, it } from 'vitest';
import { parseYouTubeVideoId } from '../../shared/youtube';

describe('YouTube background URL parsing', () => {
  it('accepts common YouTube URL formats', () => {
    const id = 'dQw4w9WgXcQ';
    expect(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${id}`)).toBe(id);
    expect(parseYouTubeVideoId(`https://youtu.be/${id}?t=12`)).toBe(id);
    expect(parseYouTubeVideoId(`https://www.youtube.com/shorts/${id}`)).toBe(id);
    expect(parseYouTubeVideoId(`https://www.youtube.com/embed/${id}`)).toBe(id);
    expect(parseYouTubeVideoId(`https://music.youtube.com/watch?v=${id}`)).toBe(id);
    expect(parseYouTubeVideoId(id)).toBe(id);
  });

  it('rejects non-YouTube and malformed URLs', () => {
    expect(parseYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBe('');
    expect(parseYouTubeVideoId('not a video')).toBe('');
    expect(parseYouTubeVideoId('')).toBe('');
  });
});
