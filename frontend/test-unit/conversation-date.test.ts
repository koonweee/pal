import { describe, expect, it } from 'vitest';
import {
  conversationDateKey,
  conversationDateLabel,
} from '../src/chat/conversation-date';

const localDate = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour);

describe('conversation date labels', () => {
  const now = localDate(2026, 10, 18);

  it('uses local calendar-day keys', () => {
    expect(conversationDateKey(localDate(2026, 1, 2))).toBe('2026-01-02');
    expect(conversationDateKey(localDate(2026, 1, 2, 23))).toBe('2026-01-02');
  });

  it('labels today and yesterday', () => {
    expect(conversationDateLabel(localDate(2026, 10, 18, 1), now)).toBe(
      'Today',
    );
    expect(conversationDateLabel(localDate(2026, 10, 17, 23), now)).toBe(
      'Yesterday',
    );
  });

  it('omits the current year and includes earlier years', () => {
    expect(conversationDateLabel(localDate(2026, 9, 3), now)).toBe('Sep 3');
    expect(conversationDateLabel(localDate(2025, 12, 31), now)).toBe(
      'Dec 31 2025',
    );
  });
});
