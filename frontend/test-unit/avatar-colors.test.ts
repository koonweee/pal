import { describe, expect, it } from 'vitest';
import { avatarColors } from '../src/instance-settings/avatar-colors';

const pixels = (...colors: number[][]) => new Uint8ClampedArray(colors.flat());

describe('profile image colors', () => {
  it('ignores transparency and merges nearby tones while ranking common colors', () => {
    expect(
      avatarColors(
        pixels(
          [255, 0, 0, 255],
          [255, 0, 0, 255],
          [250, 0, 0, 255],
          [0, 255, 0, 255],
          [0, 255, 0, 255],
          [0, 0, 255, 255],
          ...Array.from({ length: 10 }, () => [0, 0, 0, 0]),
          [255, 255, 255, 50],
        ),
      ),
    ).toEqual(['#fd0000', '#00ff00', '#0000ff']);
  });

  it('offers at most five distinct choices and allows fewer for simple images', () => {
    const palette = avatarColors(
      pixels(
        [255, 0, 0, 255],
        [225, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
        [0, 255, 255, 255],
        [255, 0, 255, 255],
      ),
    );
    expect(palette).toHaveLength(5);
    expect(new Set(palette).size).toBe(5);
    expect(
      palette.filter((color) => ['#ff0000', '#e10000'].includes(color)),
    ).toHaveLength(1);
    expect(avatarColors(pixels([255, 0, 0, 255]))).toEqual(['#ff0000']);
    expect(avatarColors(pixels([255, 0, 0, 0]))).toEqual([]);
  });
});
