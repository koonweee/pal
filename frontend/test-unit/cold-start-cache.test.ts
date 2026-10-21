import { beforeEach, expect, test, vi } from 'vitest';
import type { InstanceSettings, Message } from '../src/api/client.ts';
import {
  appearanceCacheKey,
  readAppearanceCache,
  writeAppearanceCache,
} from '../src/instance-settings/appearance-cache.ts';
import {
  mainHistoryCacheKey,
  readMainHistoryCache,
  writeMainHistoryCache,
} from '../src/chat/history-cache.ts';

function message(sequence: number, text = `Message ${sequence}`): Message {
  return {
    id: `message-${sequence}`,
    source: sequence % 2 ? 'web' : null,
    originDestinationId: sequence % 2 ? 'web' : null,
    mainVisible: false,
    reaction: null,
    deliveryDestinationIds: [],
    notificationDestinationIds: [],
    notify: false,
    version: 1,
    idempotencyKey: null,
    replyToMessageId: null,
    replyTo: null,
    sequence,
    createdAt: '2026-10-21T12:00:00.000Z',
    updatedAt: '2026-10-21T12:00:00.000Z',
    role: sequence % 2 ? 'user' : 'assistant',
    text,
    metadata: {},
    taskId: null,
    phase: sequence % 2 ? null : 'final_answer',
    attachments: [],
    actions: null,
  };
}

beforeEach(() => localStorage.clear());

test('persists only validated appearance fields', () => {
  const settings: InstanceSettings = {
    agentName: 'Juniper',
    agentAvatarAttachmentId: '123e4567-e89b-42d3-a456-426614174000',
    accentColor: '#7a5cff',
    version: 9,
  };
  writeAppearanceCache(settings);
  expect(readAppearanceCache()).toEqual({
    agentName: 'Juniper',
    agentAvatarAttachmentId: settings.agentAvatarAttachmentId,
    accentColor: '#7a5cff',
  });

  localStorage.setItem(appearanceCacheKey, '{"schema":1,"agentName":4}');
  expect(readAppearanceCache()).toBeUndefined();
  expect(localStorage.getItem(appearanceCacheKey)).toBeNull();
});

test('bounds the Main snapshot by count and serialized size', () => {
  writeMainHistoryCache(
    Array.from({ length: 35 }, (_, index) => message(index + 1)),
  );
  expect(readMainHistoryCache().map(({ sequence }) => sequence)).toEqual(
    Array.from({ length: 30 }, (_, index) => index + 6),
  );

  writeMainHistoryCache([
    message(1, 'x'.repeat(300_000)),
    message(2, 'y'.repeat(300_000)),
  ]);
  expect(readMainHistoryCache().map(({ sequence }) => sequence)).toEqual([2]);

  writeMainHistoryCache([message(3, 'z'.repeat(500_000))]);
  expect(localStorage.getItem(mainHistoryCacheKey)).toBeNull();
});

test('discards corrupt history and tolerates unavailable storage', () => {
  localStorage.setItem(mainHistoryCacheKey, '{"schema":1,"messages":[{}]}');
  expect(readMainHistoryCache()).toEqual([]);
  expect(localStorage.getItem(mainHistoryCacheKey)).toBeNull();

  const failure = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
  expect(() => writeMainHistoryCache([message(1)])).not.toThrow();
  failure.mockRestore();
});
