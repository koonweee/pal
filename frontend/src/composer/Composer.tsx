import { FileButton, Textarea } from '@mantine/core';
import { ArrowUp, Paperclip, X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { PendingFiles } from '../attachments/PendingFiles';
import type { ChatController } from '../chat/use-chat';
import { useInstanceSettings } from '../instance-settings/InstanceSettingsProvider';
import { IconAction } from '../ui/IconAction';

export function Composer({ chat }: { chat: ChatController }) {
  const { settings } = useInstanceSettings();
  const draft = useRef<HTMLTextAreaElement>(null);
  const footer = useRef<HTMLElement>(null);
  const cancelReplyPointer = useRef('');

  useLayoutEffect(() => {
    const node = footer.current;
    const pane = node?.parentElement;
    if (!node || !pane) return;
    const updateHeight = () => {
      pane.style.setProperty(
        '--pal-composer-overlay-height',
        `${node.getBoundingClientRect().height}px`,
      );
    };
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node, { box: 'border-box' });
    updateHeight();
    return () => {
      observer.disconnect();
      pane.style.removeProperty('--pal-composer-overlay-height');
    };
  }, []);

  function focusDraft() {
    draft.current?.focus({ preventScroll: true });
  }

  return (
    <footer ref={footer} className="footer">
      {chat.selectedReply && (
        <div id="composer-reply" className="composer-reply">
          <div className="composer-reply-content">
            <strong id="composer-reply-role">
              {chat.selectedReply.role === 'user' ? 'You' : settings.agentName}
            </strong>
            <span id="composer-reply-text">
              {chat.selectedReply.text.slice(0, 160) || 'Message'}
            </span>
          </div>
          <IconAction
            id="cancel-reply"
            type="button"
            label="Cancel reply"
            onPointerDownCapture={(event) => {
              cancelReplyPointer.current = event.pointerType;
            }}
            onPointerCancel={() => {
              cancelReplyPointer.current = '';
            }}
            onClick={() => {
              const shouldFocusDraft = cancelReplyPointer.current !== 'touch';
              cancelReplyPointer.current = '';
              chat.selectReply();
              if (shouldFocusDraft) focusDraft();
            }}
          >
            <X aria-hidden="true" size={18} strokeWidth={1.75} />
          </IconAction>
        </div>
      )}
      <PendingFiles
        busy={chat.submitting}
        entries={chat.pendingFiles.entries}
        error={chat.pendingFiles.error}
        onRemove={chat.pendingFiles.remove}
        onRetry={chat.pendingFiles.retry}
      />
      <form
        id="composer"
        className="composer pal-raised-glass"
        onSubmit={(event) => {
          event.preventDefault();
          void chat.submit();
        }}
      >
        <FileButton
          multiple
          inputProps={{ id: 'file-input' }}
          disabled={chat.submitting}
          onChange={chat.pendingFiles.add}
        >
          {({ onClick }) => (
            <IconAction
              id="attach-files"
              className="attach-files"
              type="button"
              label="Attach files"
              disabled={chat.submitting}
              onClick={onClick}
            >
              <Paperclip aria-hidden="true" size={20} strokeWidth={1.75} />
            </IconAction>
          )}
        </FileButton>
        <label className="sr-only" htmlFor="draft">
          Message {settings.agentName}
        </label>
        <Textarea
          ref={draft}
          id="draft"
          className="composer-input"
          classNames={{ input: 'composer-textarea' }}
          autosize
          minRows={1}
          maxRows={6}
          maxLength={100000}
          placeholder={`message ${settings.agentName}`}
          value={chat.draft}
          // Focus before the native pointer action so iOS opens the keyboard without panning the page.
          onPointerDown={focusDraft}
          onChange={(event) => chat.setDraft(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length && !chat.submitting) {
              event.preventDefault();
              chat.pendingFiles.add(files);
            }
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void chat.submit();
            }
          }}
        />
        <IconAction
          id="send"
          className="send"
          type="submit"
          disabled={!chat.canSend}
          label="Send message"
          onMouseDownCapture={(event) => {
            if (
              event.button === 0 &&
              event.currentTarget.ownerDocument.activeElement === draft.current
            )
              event.preventDefault();
          }}
        >
          <ArrowUp aria-hidden="true" size={20} strokeWidth={1.75} />
        </IconAction>
      </form>
    </footer>
  );
}
