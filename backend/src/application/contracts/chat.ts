import type {
  MessageMetadata,
  UserVisibleMessage,
} from '../../chat/chat.types.js';

/** Input accepted from a trusted adapter after that adapter has validated its client. */
export interface SubmitMessageInput {
  originDestinationId?: string;
  source?: string;
  metadata?: MessageMetadata;
  idempotencyKey: string;
  text: string;
  taskId?: string;
  replyToMessageId?: string;
  attachmentIds: string[];
}

/** Stable, cursor-based history request shared by first-party client adapters. */
export interface HistoryInput {
  taskId?: string;
  before?: number;
  limit?: number;
}

/** Idempotent action selection; actions do not implicitly continue an agent. */
export interface SelectActionInput {
  metadata?: MessageMetadata;
  idempotencyKey: string;
  messageId: string;
  actionId: string;
}

/**
 * Transport-neutral chat operations exposed to first-party and secondary adapters.
 * Adapters own protocol validation; implementations own persistence, visibility,
 * explicit delivery, and agent handoff.
 */
/** Agent-handoff boundary used by every trusted ingress adapter. */
export interface MessageSubmissionPort {
  send(input: SubmitMessageInput): Promise<{ messageId: string }>;
}

/** Canonical message query/mutation boundary used by first-party adapters. */
export interface ChatViewPort {
  history(input: HistoryInput): Promise<{
    messages: UserVisibleMessage[];
    before: number | null;
  }>;
  selectAction(input: SelectActionInput): Promise<{ messageId: string }>;
}
