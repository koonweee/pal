import type {
  Attachment,
  ReplySummary,
  SuggestedReplySelection,
} from '../api/client';

export const messageOutboxKey = 'pal-message-outbox-v1';
export const messageOutboxValidityMs = 24 * 60 * 60 * 1000;
export const maxMessageOutboxEntries = 20;
const maxSerializedCharacters = 2_500_000;

export type MessageOutboxStatus = 'queued' | 'retrying' | 'failed' | 'expired';

export interface MessageOutboxEntry {
  attachments: Attachment[];
  createdAt: string;
  expiresAt: string;
  idempotencyKey: string;
  replyTo: ReplySummary | null;
  replyToMessageId: string | null;
  status: MessageOutboxStatus;
  suggestedReply?: SuggestedReplySelection;
  taskId: string | null;
  text: string;
}

interface StoredMessageOutbox {
  schema: 1;
  entries: MessageOutboxEntry[];
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validAttachment(value: unknown): value is Attachment {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.filename === 'string' &&
    typeof value.contentType === 'string' &&
    typeof value.sizeBytes === 'number' &&
    validDate(value.createdAt)
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

function validSuggestedReply(value: unknown): value is SuggestedReplySelection {
  return (
    record(value) &&
    typeof value.messageId === 'string' &&
    Number.isInteger(value.index) &&
    (value.index as number) >= 0
  );
}

function validEntry(value: unknown): value is MessageOutboxEntry {
  return (
    record(value) &&
    typeof value.idempotencyKey === 'string' &&
    typeof value.text === 'string' &&
    nullableString(value.taskId) &&
    nullableString(value.replyToMessageId) &&
    (value.replyTo === null || validReply(value.replyTo)) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(validAttachment) &&
    validDate(value.createdAt) &&
    validDate(value.expiresAt) &&
    (value.status === 'queued' ||
      value.status === 'retrying' ||
      value.status === 'failed' ||
      value.status === 'expired') &&
    (value.suggestedReply === undefined ||
      validSuggestedReply(value.suggestedReply))
  );
}

function removeMessageOutbox() {
  try {
    localStorage.removeItem(messageOutboxKey);
  } catch {
    // Storage can be unavailable without preventing an in-memory send.
  }
}

export function messageOutboxExpiresAt(createdAt: string) {
  return new Date(
    Date.parse(createdAt) + messageOutboxValidityMs,
  ).toISOString();
}

export function readMessageOutbox(now = Date.now()): MessageOutboxEntry[] {
  try {
    const stored = localStorage.getItem(messageOutboxKey);
    if (!stored) return [];
    const value: unknown = JSON.parse(stored);
    if (
      record(value) &&
      value.schema === 1 &&
      Array.isArray(value.entries) &&
      value.entries.length <= maxMessageOutboxEntries &&
      value.entries.every(validEntry)
    )
      return value.entries
        .map((entry) =>
          (entry.status === 'queued' || entry.status === 'retrying') &&
          Date.parse(entry.expiresAt) <= now
            ? { ...entry, status: 'expired' as const }
            : entry,
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.idempotencyKey.localeCompare(right.idempotencyKey),
        );
  } catch {
    // Invalid outbox data is discarded below.
  }
  removeMessageOutbox();
  return [];
}

export function writeMessageOutbox(entries: Iterable<MessageOutboxEntry>) {
  const value: StoredMessageOutbox = {
    schema: 1,
    entries: Array.from(entries).sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.idempotencyKey.localeCompare(right.idempotencyKey),
    ),
  };
  if (!value.entries.length) {
    removeMessageOutbox();
    return true;
  }
  if (value.entries.length > maxMessageOutboxEntries) return false;
  const serialized = JSON.stringify(value);
  if (serialized.length > maxSerializedCharacters) return false;
  try {
    localStorage.setItem(messageOutboxKey, serialized);
    return true;
  } catch {
    return false;
  }
}
