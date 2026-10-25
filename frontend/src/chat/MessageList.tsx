import { SecureEntryCard } from '../login/SecureEntryCard';
import { UnstyledButton } from '@mantine/core';
import type { Virtualizer } from '@tanstack/react-virtual';
import { Reply, RotateCcw, X } from 'lucide-react';
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useState,
} from 'react';
import { IconAction } from '../ui/IconAction';
import { useInstanceSettings } from '../instance-settings/InstanceSettingsProvider';
import { SuggestedReplies } from './SuggestedReplies';
import { AssistantMarkdown } from './AssistantMarkdown';
import {
  conversationDateKey,
  conversationDateLabel,
} from './conversation-date';
import { MessageAttachments } from './MessageAttachments';
import type { MessageView } from './use-chat';
import { useSwipeReply } from './use-swipe-reply';

const MessageRow = memo(
  function MessageRow({
    view,
    onDismissFailed,
    onNavigate,
    onReply,
    onRetryFailed,
    onSelectSuggestedReply,
    suggestionsDisabled,
    highlighted,
  }: {
    view: MessageView;
    onDismissFailed(idempotencyKey: string): void;
    onNavigate(id: string): void;
    onReply(message: MessageView['message']): void;
    onRetryFailed(idempotencyKey: string): void;
    onSelectSuggestedReply(messageId: string, index: number): void;
    suggestionsDisabled: boolean;
    highlighted: boolean;
  }) {
    const { settings } = useInstanceSettings();
    const {
      failed,
      message,
      persisted,
      receiptSlot,
      retrying,
      showQuote,
      read,
    } = view;
    const [attachmentPreviewOpen, setAttachmentPreviewOpen] = useState(false);
    const reply = useCallback(() => onReply(message), [message, onReply]);
    const activateReply = useCallback(
      (event: ReactMouseEvent<HTMLButtonElement>) => {
        if (
          event.nativeEvent instanceof PointerEvent &&
          event.nativeEvent.pointerType === 'touch'
        )
          return;
        reply();
      },
      [reply],
    );
    const bindSwipeReply = useSwipeReply({
      enabled:
        persisted &&
        !failed &&
        !attachmentPreviewOpen &&
        !message.metadata.secureEntryRequestId,
      onReply: reply,
    });
    return (
      <div
        className="message-swipe-row"
        data-chat-layout-content
        {...bindSwipeReply()}
      >
        {persisted && !failed && (
          <span className="swipe-reply-indicator" aria-hidden="true">
            <Reply aria-hidden="true" size={18} strokeWidth={1.75} />
          </span>
        )}
        <article
          className={`message ${message.role}${persisted && message.metadata.secureEntryRequestId ? ' secure-entry-message' : ''}${receiptSlot ? ' message-receipt-slot' : ''}${failed ? ' message-failed' : ''}${highlighted ? ' quote-highlight' : ''}`}
          data-message-id={message.id}
          aria-label={message.role === 'user' ? 'You' : settings.agentName}
        >
          <div className="message-content">
            <div className="message-bubble">
              {message.reaction && (
                <span
                  key={message.reaction}
                  className="message-reaction"
                  role="img"
                  aria-label={`${settings.agentName} reacted ${message.reaction}`}
                >
                  {message.reaction}
                </span>
              )}
              {showQuote && message.replyTo && (
                <UnstyledButton
                  type="button"
                  className="message-quote"
                  aria-label="View quoted message"
                  disabled={!persisted}
                  onClick={() => onNavigate(message.replyTo!.id)}
                >
                  <strong>
                    {message.replyTo.role === 'user'
                      ? 'You'
                      : settings.agentName}
                  </strong>
                  <span>{message.replyTo.textPreview || 'Message'}</span>
                </UnstyledButton>
              )}
              {persisted &&
              message.role === 'assistant' &&
              message.metadata.secureEntryRequestId ? (
                <SecureEntryCard
                  key={message.metadata.secureEntryRequestId}
                  requestId={message.metadata.secureEntryRequestId}
                />
              ) : message.role === 'assistant' ? (
                <AssistantMarkdown text={message.text} />
              ) : (
                <div className="message-body plain-text">{message.text}</div>
              )}
              {!!message.attachments.length && (
                <MessageAttachments
                  files={message.attachments}
                  onPreviewChange={setAttachmentPreviewOpen}
                />
              )}
            </div>
            {persisted && message.role === 'assistant' && (
              <SuggestedReplies
                messageId={message.id}
                replies={view.suggestedReplies ?? []}
                disabled={suggestionsDisabled}
                onSelect={onSelectSuggestedReply}
              />
            )}
            {failed && message.idempotencyKey && (
              <div className="message-failure" role="status">
                <span>{retrying ? 'Sending…' : 'Couldn’t send'}</span>
                <IconAction
                  type="button"
                  className={`message-failure-action${retrying ? ' is-retrying' : ''}`}
                  label="Retry sending message"
                  disabled={retrying}
                  onClick={() => onRetryFailed(message.idempotencyKey!)}
                >
                  <RotateCcw aria-hidden="true" size={15} strokeWidth={1.75} />
                </IconAction>
                <IconAction
                  type="button"
                  className="message-failure-action"
                  label="Dismiss failed message"
                  disabled={retrying}
                  onClick={() => onDismissFailed(message.idempotencyKey!)}
                >
                  <X aria-hidden="true" size={16} strokeWidth={1.75} />
                </IconAction>
              </div>
            )}
          </div>
          {!failed && !message.metadata.secureEntryRequestId && (
            <IconAction
              type="button"
              className="reply-action"
              mih="var(--pal-icon-action-size)"
              label={`Reply to ${message.role === 'user' ? 'your' : `${settings.agentName}’s`} message`}
              disabled={!persisted}
              aria-hidden={persisted ? undefined : true}
              onClick={activateReply}
            >
              <Reply aria-hidden="true" size={18} strokeWidth={1.75} />
            </IconAction>
          )}
          {receiptSlot && persisted && !failed && (
            <div
              className="message-read"
              data-visible="true"
              data-status={read ? 'read' : 'delivered'}
              role="status"
              aria-label={
                read
                  ? `Read ${new Date(message.createdAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}`
                  : 'Delivered'
              }
            >
              <span
                className="message-receipt-label"
                data-visible={read ? 'false' : 'true'}
                aria-hidden="true"
              >
                Delivered
              </span>
              <span
                className="message-receipt-label"
                data-visible={read ? 'true' : 'false'}
                aria-hidden="true"
              >
                Read{' '}
                <time
                  dateTime={message.createdAt}
                  title={new Date(message.createdAt).toLocaleString()}
                >
                  {new Date(message.createdAt).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
              </span>
            </div>
          )}
        </article>
      </div>
    );
  },
  (previous, next) =>
    previous.view.message === next.view.message &&
    previous.view.failed === next.view.failed &&
    previous.view.persisted === next.view.persisted &&
    previous.view.receiptSlot === next.view.receiptSlot &&
    previous.view.retrying === next.view.retrying &&
    previous.view.showQuote === next.view.showQuote &&
    previous.view.read === next.view.read &&
    previous.view.suggestedReplies === next.view.suggestedReplies &&
    previous.suggestionsDisabled === next.suggestionsDisabled &&
    previous.onSelectSuggestedReply === next.onSelectSuggestedReply &&
    previous.onNavigate === next.onNavigate &&
    previous.onDismissFailed === next.onDismissFailed &&
    previous.onReply === next.onReply &&
    previous.onRetryFailed === next.onRetryFailed &&
    previous.highlighted === next.highlighted,
);

export function MessageList({
  messages,
  onDismissFailed,
  onNavigate,
  onReply,
  onRetryFailed,
  onSelectSuggestedReply,
  suggestionsDisabled,
  virtualizer,
  scrollMargin,
  highlightedMessage,
  showFirstDateSeparator,
}: {
  messages: MessageView[];
  onDismissFailed(idempotencyKey: string): void;
  onNavigate(id: string): void;
  onReply(message: MessageView['message']): void;
  onRetryFailed(idempotencyKey: string): void;
  onSelectSuggestedReply(messageId: string, index: number): void;
  suggestionsDisabled: boolean;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  scrollMargin: number;
  highlightedMessage?: string;
  showFirstDateSeparator: boolean;
}) {
  const now = new Date();
  return (
    <>
      {virtualizer.getVirtualItems().map((item) => {
        const view = messages[item.index]!;
        const dateKey = conversationDateKey(view.message.createdAt);
        const previousDateKey =
          item.index > 0
            ? conversationDateKey(messages[item.index - 1]!.message.createdAt)
            : undefined;
        const dateLabel =
          (item.index === 0 && !showFirstDateSeparator) ||
          dateKey === previousDateKey
            ? undefined
            : conversationDateLabel(view.message.createdAt, now);
        return (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            className="virtual-message"
            data-index={item.index}
            data-chat-layout-key={`message:${String(item.key)}`}
            style={{
              transform: `translateY(${item.start - scrollMargin}px)`,
            }}
          >
            {dateLabel && (
              <div
                className="conversation-date-separator"
                role="separator"
                aria-label={dateLabel}
              >
                <time dateTime={dateKey}>{dateLabel}</time>
              </div>
            )}
            <MessageRow
              view={view}
              onDismissFailed={onDismissFailed}
              onNavigate={onNavigate}
              onSelectSuggestedReply={onSelectSuggestedReply}
              suggestionsDisabled={suggestionsDisabled}
              onReply={onReply}
              onRetryFailed={onRetryFailed}
              highlighted={highlightedMessage === view.message.id}
            />
          </div>
        );
      })}
    </>
  );
}
