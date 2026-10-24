import { useNotificationNavigation } from './pwa/use-notification-navigation';
import { Drawer } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import type { McpSnapshot } from './api/client';
import { useChat } from './chat/use-chat';
import type { ChatController } from './chat/use-chat';
import { Conversation } from './chat/Conversation';
import { Composer } from './composer/Composer';
import { Desktop } from './desktop/Desktop';
import {
  PreferencesDialog,
  type PreferencesPreview,
} from './preferences/PreferencesDialog';
import { AppHeader } from './shell/AppHeader';
import { ThreadNavigation } from './tasks/ThreadNavigation';

export function PlaygroundShellView({
  chat,
  preview,
}: {
  chat: ChatController;
  preview?: {
    preferences: PreferencesPreview;
    services: McpSnapshot;
  };
}) {
  const [threadOpen, setThreadOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [fileDragging, setFileDragging] = useState(false);
  const [notificationPending, setNotificationPending] = useState(false);
  useNotificationNavigation(() => setNotificationPending(true));
  useEffect(() => {
    if (!notificationPending || chat.submitting) return;
    if (chat.openMainLatest()) {
      setThreadOpen(false);
      setDesktopOpen(false);
      setPreferencesOpen(false);
      setNotificationPending(false);
    }
  }, [chat, notificationPending]);
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shell.current) shell.current.inert = desktopOpen;
  }, [desktopOpen]);

  function closeDesktop() {
    setDesktopOpen(false);
  }

  return (
    <>
      <div ref={shell} className="shell">
        <AppHeader
          chat={chat}
          threadOpen={threadOpen}
          desktopOpen={desktopOpen}
          onOpenDesktop={() => setDesktopOpen(true)}
          onOpenThread={() => setThreadOpen(true)}
          onOpenPreferences={() => setPreferencesOpen(true)}
        />
        <div className="workspace">
          <div
            className={`chat-pane${fileDragging ? ' file-drag-over' : ''}`}
            onDragOver={(event) => {
              if (
                event.dataTransfer.types.includes('Files') &&
                !chat.submitting
              ) {
                event.preventDefault();
                setFileDragging(true);
              }
            }}
            onDragLeave={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              )
                setFileDragging(false);
            }}
            onDrop={(event) => {
              setFileDragging(false);
              if (event.dataTransfer.files.length) {
                event.preventDefault();
                chat.pendingFiles.add(Array.from(event.dataTransfer.files));
              }
            }}
          >
            <Conversation chat={chat} />
            <Composer chat={chat} />
          </div>
        </div>
      </div>
      <Drawer.Root
        opened={threadOpen}
        onClose={() => setThreadOpen(false)}
        position="left"
        size="min(360px, calc(100vw - 24px))"
        keepMounted
        transitionProps={{ duration: 0 }}
        classNames={{
          content: 'panel-surface pal-raised-glass thread-sidebar',
          header: 'thread-sidebar-heading',
          title: 'thread-sidebar-title',
          body: 'thread-sidebar-body',
        }}
      >
        <Drawer.Overlay className="pal-overlay-backdrop" />
        <Drawer.Content id="thread-sidebar">
          <Drawer.Header>
            <Drawer.Title>Conversations</Drawer.Title>
            <Drawer.CloseButton
              id="thread-close"
              className="pal-icon-action"
              aria-label="Close thread sidebar"
            />
          </Drawer.Header>
          <Drawer.Body>
            <div id="mobile-thread-nav">
              <ThreadNavigation
                chat={chat}
                onSelect={() => setThreadOpen(false)}
              />
            </div>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
      <PreferencesDialog
        open={preferencesOpen}
        preview={preview?.preferences}
        servicesPreview={preview?.services}
        onClose={() => setPreferencesOpen(false)}
        onNavigateMessage={(id, taskId) => void chat.ensureMessage(id, taskId)}
      />
      {(!preview || desktopOpen) && (
        <Desktop open={desktopOpen} onClose={closeDesktop} />
      )}
    </>
  );
}

export function PlaygroundShell() {
  const chat = useChat();
  return <PlaygroundShellView chat={chat} />;
}
