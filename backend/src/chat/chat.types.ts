import type { MutableEntity } from '../common/entity.types.js';
import type { Attachment } from '../files/files.types.js';
export type MessagePhase = 'commentary' | 'final_answer';
export interface MessageAction {
  id: string;
  label: string;
}
export interface MessageActions {
  actions: MessageAction[];
  state: 'available' | 'selected' | 'disabled';
  selectedActionId: string | null;
}
export interface MessageMetadata {
  timezone?: string;
}
export interface MessageReplySummary {
  id: string;
  sequence: number;
  role: 'user' | 'assistant';
  textPreview: string;
  taskId: string | null;
  phase: MessagePhase | null;
  mainVisible: boolean;
}
export function messageVisibleInChat(
  message: Pick<MessageReplySummary, 'taskId' | 'mainVisible'>,
  taskId: string | null,
) {
  return taskId
    ? message.taskId === taskId
    : message.taskId === null || message.mainVisible;
}
export interface UserVisibleMessage extends MutableEntity {
  source: string | null;
  originDestinationId: string | null;
  deliveryDestinationIds: string[];
  notificationDestinationIds: string[];
  notify: boolean;
  reaction: string | null;
  mainVisible: boolean;
  sequence: number;
  idempotencyKey: string | null;
  replyToMessageId: string | null;
  replyTo: MessageReplySummary | null;
  role: 'user' | 'assistant';
  text: string;
  metadata: MessageMetadata;
  attachments: Attachment[];
  actions: MessageActions | null;
  taskId: string | null;
  phase: MessagePhase | null;
}
export interface PublishMessage {
  source?: string;
  originDestinationId?: string;
  destinationIds?: string[];
  notify?: boolean;
  role: 'user' | 'assistant';
  text: string;
  replyToMessageId?: string | null;
  replyToSequence?: number | null;
  metadata?: MessageMetadata;
  taskId?: string;
  phase?: MessagePhase | null;
  attachmentIds?: string[];
  actions?: MessageActions | null;
}
