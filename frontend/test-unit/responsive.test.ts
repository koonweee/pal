import { describe, expect, test } from 'vitest';
import { classifyInputCapabilities } from '../src/layout/use-responsive';

describe('input capabilities', () => {
  test('keeps hybrid touch and fine-hover facts independent', () => {
    expect(
      classifyInputCapabilities({
        coarsePointer: true,
        fineHover: true,
        maxTouchPoints: 10,
      }),
    ).toEqual({ coarsePointer: true, fineHover: true, touch: true });
  });
});
