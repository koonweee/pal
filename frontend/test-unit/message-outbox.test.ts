import { beforeEach, expect, test, vi } from 'vitest';
import type { MessageOutboxEntry } from '../src/chat/message-outbox.ts';
import {
  maxMessageOutboxEntries,
  messageOutboxExpiresAt,
  messageOutboxKey,
  messageOutboxValidityMs,
  readMessageOutbox,
  writeMessageOutbox,
} from '../src/chat/message-outbox.ts';

function entry(
  idempotencyKey: string,
  createdAt = '2026-10-31T12:00:00.000Z',
): MessageOutboxEntry {
  return {
    attachments: [],
    createdAt,
    expiresAt: messageOutboxExpiresAt(createdAt),
    idempotencyKey,
    replyTo: null,
    replyToMessageId: null,
    status: 'queued',
    taskId: null,
    text: `Message ${idempotencyKey}`,
  };
}

beforeEach(() => localStorage.clear());

test('persists queued messages in creation order and expires them after 24 hours', () => {
  const later = entry('later', '2026-10-31T13:00:00.000Z');
  const earlier = entry('earlier');
  expect(writeMessageOutbox([later, earlier])).toBe(true);
  expect(
    readMessageOutbox(
      Date.parse(earlier.createdAt) + messageOutboxValidityMs - 1,
    ),
  ).toEqual([earlier, later]);
  expect(
    readMessageOutbox(Date.parse(earlier.createdAt) + messageOutboxValidityMs),
  ).toEqual([{ ...earlier, status: 'expired' }, later]);
});

test('discards invalid data and refuses writes beyond its bounds', () => {
  localStorage.setItem(messageOutboxKey, '{"schema":1,"entries":[{}]}');
  expect(readMessageOutbox()).toEqual([]);
  expect(localStorage.getItem(messageOutboxKey)).toBeNull();

  expect(
    writeMessageOutbox(
      Array.from({ length: maxMessageOutboxEntries + 1 }, (_, index) =>
        entry(String(index)),
      ),
    ),
  ).toBe(false);
  expect(localStorage.getItem(messageOutboxKey)).toBeNull();
});

test('keeps in-memory sends usable when browser storage is unavailable', () => {
  const failure = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
  expect(writeMessageOutbox([entry('one')])).toBe(false);
  failure.mockRestore();
});
