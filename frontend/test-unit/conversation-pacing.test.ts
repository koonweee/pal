import { describe, expect, it } from 'vitest';
import { conversationPacingTiming } from '../src/chat/use-conversation-pacing';

function samples(...values: number[]) {
  return () => values.shift() ?? 0;
}

describe('conversation pacing timing', () => {
  it('sometimes omits the typing indicator', () => {
    expect(conversationPacingTiming(samples(0, 0.8))).toEqual({
      readDelayMs: 1_000,
    });
  });

  it('keeps Read and typing within their independent bounds', () => {
    expect(conversationPacingTiming(samples(0, 0, 0, 0))).toEqual({
      readDelayMs: 1_000,
      typingDelayMs: 2_000,
      typingDurationMs: 2_200,
    });
    expect(
      conversationPacingTiming(samples(0.999_999, 0.79, 0.999_999, 0.999_999)),
    ).toEqual({
      readDelayMs: 5_000,
      typingDelayMs: 8_000,
      typingDurationMs: 8_000,
    });
  });
});
