import type { Attachment, Message, ReplySummary } from '../api/client';

export const mainHistoryCacheKey = 'pal-main-history-v1';
const maxMessages = 30;
const maxSerializedCharacters = 500_000;

interface MainHistoryCache {
  schema: 1;
  savedAt: string;
  messages: Message[];
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function validAttachment(value: unknown): value is Attachment {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.filename === 'string' &&
    typeof value.contentType === 'string' &&
    typeof value.sizeBytes === 'number' &&
    typeof value.createdAt === 'string'
  );
}

function validReply(value: unknown): value is ReplySummary {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.sequence === 'number' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.textPreview === 'string' &&
    nullableString(value.taskId) &&
    (value.phase === null ||
      value.phase === 'commentary' ||
      value.phase === 'final_answer') &&
    typeof value.mainVisible === 'boolean'
  );
}

function validMessage(value: unknown): value is Message {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.version === 'number' &&
    typeof value.sequence === 'number' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    nullableString(value.source) &&
    nullableString(value.originDestinationId) &&
    typeof value.mainVisible === 'boolean' &&
    nullableString(value.reaction) &&
    stringArray(value.deliveryDestinationIds) &&
    stringArray(value.notificationDestinationIds) &&
    typeof value.notify === 'boolean' &&
    nullableString(value.idempotencyKey) &&
    nullableString(value.replyToMessageId) &&
    (value.replyTo === null || validReply(value.replyTo)) &&
    nullableString(value.taskId) &&
    (value.phase === null ||
      value.phase === 'commentary' ||
      value.phase === 'final_answer') &&
    record(value.metadata) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(validAttachment) &&
    (value.actions === null || record(value.actions))
  );
}

function removeCache() {
  try {
    localStorage.removeItem(mainHistoryCacheKey);
  } catch {
    // Browser storage is optional presentation state.
  }
}

export function readMainHistoryCache(): Message[] {
  try {
    const stored = localStorage.getItem(mainHistoryCacheKey);
    if (!stored) return [];
    const value: unknown = JSON.parse(stored);
    if (
      record(value) &&
      value.schema === 1 &&
      typeof value.savedAt === 'string' &&
      Array.isArray(value.messages) &&
      value.messages.length <= maxMessages &&
      value.messages.every(validMessage)
    )
      return value.messages
        .filter((message) => message.taskId === null || message.mainVisible)
        .sort((left, right) => left.sequence - right.sequence);
  } catch {
    // Invalid cache data is discarded below.
  }
  removeCache();
  return [];
}

export function writeMainHistoryCache(messages: Iterable<Message>) {
  const latest = Array.from(messages)
    .filter((message) => message.taskId === null || message.mainVisible)
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-maxMessages);
  if (!latest.length) {
    removeCache();
    return;
  }

  const value: MainHistoryCache = {
    schema: 1,
    savedAt: new Date().toISOString(),
    messages: latest,
  };
  let serialized = JSON.stringify(value);
  while (
    serialized.length > maxSerializedCharacters &&
    value.messages.length > 1
  ) {
    value.messages.shift();
    serialized = JSON.stringify(value);
  }
  if (serialized.length > maxSerializedCharacters) {
    removeCache();
    return;
  }
  try {
    localStorage.setItem(mainHistoryCacheKey, serialized);
  } catch {
    removeCache();
  }
}
