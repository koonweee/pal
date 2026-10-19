import type { Readable } from 'node:stream';
import type { Attachment } from '../../files/files.types.js';
import type { UserVisibleMessage } from '../../chat/chat.types.js';

/** Provider-scoped reference. IDs are opaque outside the provider driver. */
export interface ExternalReference {
  externalMessageId: string;
  externalThreadId?: string;
  position: number;
}

export interface SecondaryAttachmentInput {
  stream: Readable;
  filename: string;
  contentType?: string;
}

/** Normalized owner input. Provider threads supply quote context only. */
export interface SecondaryInput {
  externalEventId: string;
  externalMessageId: string;
  externalThreadId?: string;
  text: string;
  attachments: SecondaryAttachmentInput[];
  replyToExternalMessageId?: string;
}

export interface SecondaryOutput {
  deliveryId: string;
  message: UserVisibleMessage;
  notify: boolean;
  /** A reaction targets message itself; replyTo is its mapped provider reference. */
  reaction?: string;
  replyTo?: ExternalReference;
  openAttachment(attachment: Attachment): Promise<{
    stream: Readable;
    contentType: string;
    sizeBytes: number;
  }>;
}

/**
 * A send result controls deterministic retry behavior. `retryable` means the
 * provider definitely did not accept the attempted part. `uncertain` means it
 * may have accepted it and is never retried automatically.
 */
export type DeliveryOutcome =
  | { kind: 'accepted'; references: ExternalReference[] }
  | { kind: 'retryable'; code: string; retryAfterMs?: number }
  | { kind: 'permanent'; code: string }
  | { kind: 'uncertain'; code: string; references?: ExternalReference[] };

/**
 * Provider implementation for one validated secondary destination.
 *
 * Register the instance with `SecondaryDriverHostService`. `start` begins intake;
 * `stop` must abort polling and settle it. The driver normalizes input through
 * the supplied ingress function and sends only to its configured binding.
 * Missing quote mappings arrive as `undefined` and must fall back to an
 * ordinary message.
 *
 * @example
 * class MailDriver implements SecondaryDriver {
 *   readonly adapterId = 'email';
 *   readonly destinationId = 'owner-email';
 *   // start, stop, and send bind only the configured owner mailbox.
 * }
 */
export interface SecondaryDriver {
  readonly adapterId: string;
  readonly destinationId: string;
  start(ingress: (input: SecondaryInput) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  send(output: SecondaryOutput): Promise<DeliveryOutcome>;
}
