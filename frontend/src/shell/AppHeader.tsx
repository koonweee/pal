import { Monitor, Settings } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { ActivityBubble } from '../activity/ActivityBubble';
import { AgentAvatar } from '../instance-settings/AgentAvatar';
import { useInstanceSettings } from '../instance-settings/InstanceSettingsProvider';
import type { ChatController } from '../chat/use-chat';
import { IconAction } from '../ui/IconAction';

export function AppHeader({
  chat,
  threadOpen,
  desktopOpen,
  onOpenDesktop,
  onOpenThread,
  onOpenPreferences,
}: {
  chat: ChatController;
  threadOpen: boolean;
  desktopOpen: boolean;
  onOpenDesktop(): void;
  onOpenThread(): void;
  onOpenPreferences(): void;
}) {
  const { settings } = useInstanceSettings();
  const header = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const node = header.current;
    const shell = node?.parentElement;
    if (!node || !shell) return;
    const updateHeight = () => {
      shell.style.setProperty(
        '--pal-header-overlay-height',
        `${node.getBoundingClientRect().height}px`,
      );
    };
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node, { box: 'border-box' });
    updateHeight();
    return () => {
      observer.disconnect();
      shell.style.removeProperty('--pal-header-overlay-height');
    };
  }, []);

  const connection = !chat.online
    ? 'Offline'
    : chat.connected
      ? chat.syncing
        ? 'Syncing history…'
        : 'Connected'
      : chat.opened
        ? 'Reconnecting…'
        : 'Connecting…';
  const title =
    chat.selectedTask?.title ?? (chat.selectedTaskId ? 'Task' : 'Main');
  return (
    <header ref={header} className="header">
      <div className="agent-info" aria-label={settings.agentName}>
        <IconAction
          id="thread-open"
          className="thread-open"
          type="button"
          label={`Open conversations. Current: ${title}`}
          aria-haspopup="dialog"
          aria-controls="thread-sidebar"
          aria-expanded={threadOpen}
          onClick={onOpenThread}
        >
          <AgentAvatar
            key={chat.connected ? 'connected' : 'disconnected'}
            attachmentId={settings.agentAvatarAttachmentId}
          />
        </IconAction>
        <ActivityBubble
          activity={chat.activity}
          connection={chat}
          disabled={chat.submitting}
          fallback={<span className="agent-label">{settings.agentName}</span>}
          onNavigate={(taskId, messageId) => {
            if (messageId) void chat.ensureMessage(messageId, taskId);
            else chat.selectChat(taskId);
          }}
        />
        <span
          id="connection"
          className="sr-only"
          role="status"
          data-connected={chat.connected}
          data-offline={!chat.online}
          data-syncing={chat.connected && chat.syncing}
        >
          {connection}
        </span>
      </div>
      <div className="header-actions">
        <IconAction
          id="desktop-open"
          type="button"
          label="Open desktop"
          aria-haspopup="dialog"
          aria-controls="desktop-sheet"
          aria-expanded={desktopOpen}
          onClick={onOpenDesktop}
        >
          <Monitor aria-hidden="true" size={20} strokeWidth={1.75} />
        </IconAction>
        <IconAction
          id="preferences-open"
          type="button"
          label="Preferences"
          onClick={onOpenPreferences}
        >
          <Settings aria-hidden="true" size={20} strokeWidth={1.75} />
        </IconAction>
      </div>
    </header>
  );
}
