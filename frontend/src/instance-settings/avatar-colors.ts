interface ColorBucket {
  key: number;
  red: number;
  green: number;
  blue: number;
  count: number;
}

/** Select distinct, common colors from a small RGBA image sample. */
export function avatarColors(pixels: Uint8ClampedArray): string[] {
  const buckets = new Map<number, ColorBucket>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    const red = pixels[i]!,
      green = pixels[i + 1]!,
      blue = pixels[i + 2]!;
    const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
    const bucket = buckets.get(key) ?? {
      key,
      red: 0,
      green: 0,
      blue: 0,
      count: 0,
    };
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    bucket.count++;
    buckets.set(key, bucket);
  }
  const chosen: number[][] = [];
  for (const bucket of [...buckets.values()].sort(
    (a, b) => b.count - a.count || a.key - b.key,
  )) {
    const color = [bucket.red, bucket.green, bucket.blue].map((channel) =>
      Math.round(channel / bucket.count),
    );
    // Keep near-duplicate shades from filling the available choices.
    if (
      chosen.some(
        (previous) =>
          color.reduce(
            (sum, channel, i) => sum + (channel - previous[i]!) ** 2,
            0,
          ) <
          60 ** 2,
      )
    )
      continue;
    chosen.push(color);
    if (chosen.length === 5) break;
  }
  return chosen.map(
    (color) =>
      '#' +
      color.map((channel) => channel.toString(16).padStart(2, '0')).join(''),
  );
}
