interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseColor(value: string): Rgb | null {
  const color = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color);
  if (hex) {
    const raw = hex[1];
    if (![3, 4, 6, 8].includes(raw.length)) return null;
    const expand = raw.length === 3 || raw.length === 4;
    const channels = expand
      ? raw.slice(0, 3).split('').map((channel) => channel + channel)
      : [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)];
    if (channels.length !== 3) return null;
    return {
      r: Number.parseInt(channels[0], 16),
      g: Number.parseInt(channels[1], 16),
      b: Number.parseInt(channels[2], 16),
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(color);
  if (!rgb) return null;
  return {
    r: Number(rgb[1]),
    g: Number(rgb[2]),
    b: Number(rgb[3]),
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const normalized = Math.max(0, Math.min(255, value)) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function isBrightLogoBackground(...colors: string[]): boolean {
  const parsed = colors.map(parseColor).filter((color): color is Rgb => !!color);
  if (!parsed.length) return false;
  const average = parsed.reduce((sum, color) => sum + relativeLuminance(color), 0) / parsed.length;
  return average > 0.35;
}
