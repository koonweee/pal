import { SecureEntryUpdates } from '../login/SecureEntryCard';
import { Alert, Button } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
} from 'react';
import { IconAction } from '../ui/IconAction';
import { useInstanceSettings } from '../instance-settings/InstanceSettingsProvider';
import { MessageList } from './MessageList';
import type { ChatController } from './use-chat';

interface ReadingAnchor {
  id: string;
  offset: number;
}

interface ReadingAnchors {
  bottom?: ReadingAnchor;
  top?: ReadingAnchor;
}

interface LayoutRow {
  content: HTMLElement;
  top: number;
}

const layoutShiftMotion = {
  duration: 960,
  easing: 'cubic-bezier(0.22, 0.78, 0.24, 1)',
} satisfies KeyframeAnimationOptions;

const messageEntranceMotion = {
  delay: 105,
  duration: 840,
  easing: 'cubic-bezier(0.2, 0.78, 0.25, 1)',
  fill: 'both',
} satisfies KeyframeAnimationOptions;

const typingEntranceMotion = {
  duration: 180,
  easing: 'cubic-bezier(0.22, 0.8, 0.28, 1)',
} satisfies KeyframeAnimationOptions;

function animateEntrance(key: string, content: HTMLElement) {
  if (key === 'typing') {
    content.animate([{ opacity: 0.35 }, { opacity: 1 }], typingEntranceMotion);
    return;
  }
  content.animate(
    [
      { opacity: 0, transform: 'translateY(18px) scale(0.965)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ],
    messageEntranceMotion,
  );
}

function readLayoutRows(node: HTMLElement): Map<string, LayoutRow> {
  const rows = new Map<string, LayoutRow>();
  for (const wrapper of node.querySelectorAll<HTMLElement>(
    '[data-chat-layout-key]',
  )) {
    const key = wrapper.dataset.chatLayoutKey;
    const content = wrapper.querySelector<HTMLElement>(
      ':scope > [data-chat-layout-content]',
    );
    if (key && content)
      rows.set(key, { content, top: wrapper.getBoundingClientRect().top });
  }
  return rows;
}

function sameKeys(previous: string[], current: string[]): boolean {
  return (
    previous.length === current.length &&
    previous.every((key, index) => key === current[index])
  );
}

function findComposer(node: HTMLElement): HTMLElement | undefined {
  return (
    node
      .closest<HTMLElement>('.chat-pane')
      ?.querySelector<HTMLElement>(':scope > .footer') ?? undefined
  );
}

function TypingIndicator() {
  const { settings } = useInstanceSettings();
  return (
    <div className="typing-layout-row" data-chat-layout-key="typing">
      <div className="message assistant" data-chat-layout-content role="status">
        <div className="message-bubble">
          <span className="sr-only">{settings.agentName} is typing</span>
          <div className="message-body typing-indicator" aria-hidden="true">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Conversation({ chat }: { chat: ChatController }) {
  const secureEntryUpdates = useMemo(
    () => ({ revision: chat.loginRevision ?? 0, connected: chat.connected }),
    [chat.loginRevision, chat.connected],
  );
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  const history = useRef<HTMLDivElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const [showLatest, setShowLatest] = useState(false);
  const [historyPositioned, setHistoryPositioned] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [highlightedMessage, setHighlightedMessage] = useState<string>();
  const previousLoaded = useRef(false);
  const handledLocalSendKey = useRef(chat.localSendKey);
  const layoutKeys = useRef<string[]>([]);
  const layoutSignature = useRef<string[]>([]);
  const layoutPositions = useRef<Map<string, number>>(new Map());
  const pendingEntrances = useRef<Set<string>>(new Set());
  const messageCount = useRef(chat.messages.length);
  const pinnedToEnd = useRef(true);
  const reconciling = useRef(false);
  const reconciliationFrame = useRef(0);
  const sendScrollActive = useRef(false);
  const sendScrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const readingAnchors = useRef<ReadingAnchors | undefined>(undefined);
  const pendingReconciliation = useRef<
    | {
        anchors?: ReadingAnchors;
        edge: 'bottom' | 'top';
        preserveEnd: boolean;
      }
    | undefined
  >(undefined);
  messageCount.current = chat.messages.length;
  reducedMotionRef.current = reducedMotion;
  const localSendPending =
    !!chat.localSendKey && chat.localSendKey !== handledLocalSendKey.current;
  const currentLayoutKeys = [
    ...chat.messages.map(
      ({ message }) =>
        `message:${String(message.idempotencyKey ?? message.id)}`,
    ),
    ...(chat.typing ? ['typing'] : []),
  ];
  const currentLayoutSignature = [
    ...chat.messages.map(({ message, receiptSlot }) => {
      const key = `message:${String(message.idempotencyKey ?? message.id)}`;
      return receiptSlot ? `${key}:receipt` : key;
    }),
    ...(chat.typing ? ['typing'] : []),
  ];

  const virtualizer = useVirtualizer({
    count: chat.messages.length,
    getScrollElement: () => history.current,
    getItemKey: (index) => {
      const message = chat.messages[index]!.message;
      return message.idempotencyKey ?? message.id;
    },
    estimateSize: () => 96,
    gap: 8,
    paddingStart: 4,
    paddingEnd: 4,
    anchorTo: localSendPending ? 'start' : 'end',
    followOnAppend: true,
    scrollEndThreshold: 100,
    overscan: 6,
    scrollMargin,
    useAnimationFrameWithResizeObserver: true,
  });
  const handledLatestNavigation = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      chat.latestNavigationKey === undefined ||
      handledLatestNavigation.current === chat.latestNavigationKey ||
      !chat.loaded ||
      chat.syncing
    )
      return;
    handledLatestNavigation.current = chat.latestNavigationKey;
    pinnedToEnd.current = true;
    virtualizer.scrollToEnd();
    setShowLatest(false);
  }, [chat.latestNavigationKey, chat.loaded, chat.syncing, virtualizer]);
  const lastVirtualKey = virtualizer.getVirtualItems().at(-1)?.key;

  const captureReadingAnchors = useCallback(() => {
    const node = history.current;
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    const footer = findComposer(node);
    const composerTop = footer?.getBoundingClientRect().top ?? bounds.bottom;
    const visible = Array.from(
      node.querySelectorAll<HTMLElement>('article.message[data-message-id]'),
    ).filter((message) => {
      const rect = message.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < composerTop;
    });
    const top = visible[0];
    const bottom = visible.at(-1);
    readingAnchors.current = {
      ...(top?.dataset.messageId
        ? {
            top: {
              id: top.dataset.messageId,
              offset: top.getBoundingClientRect().top - bounds.top,
            },
          }
        : {}),
      ...(bottom?.dataset.messageId
        ? {
            bottom: {
              id: bottom.dataset.messageId,
              offset: composerTop - bottom.getBoundingClientRect().bottom,
            },
          }
        : {}),
    };
  }, []);

  const captureLayoutPositions = useCallback(() => {
    const node = history.current;
    if (!node) return;
    layoutPositions.current = new Map(
      Array.from(readLayoutRows(node), ([key, row]) => [key, row.top]),
    );
  }, []);

  const updateJump = useCallback(() => {
    if (reconciling.current || sendScrollActive.current) return;
    const node = history.current;
    if (!node) return;
    const remaining = node.scrollHeight - node.clientHeight - node.scrollTop;
    const nearBottom = remaining < 100;
    pinnedToEnd.current = nearBottom;
    setShowLatest(!nearBottom && messageCount.current > 0);
    if (nearBottom) {
      readingAnchors.current = undefined;
      captureLayoutPositions();
      return;
    }
    captureReadingAnchors();
    captureLayoutPositions();
  }, [captureLayoutPositions, captureReadingAnchors]);

  useLayoutEffect(() => {
    const node = history.current;
    if (!node) return;
    const previousKeys = layoutKeys.current;
    const layoutChanged = !sameKeys(
      layoutSignature.current,
      currentLayoutSignature,
    );
    const previousKeySet = new Set(previousKeys);
    const wasPinned = pinnedToEnd.current;
    layoutKeys.current = currentLayoutKeys;
    layoutSignature.current = currentLayoutSignature;
    if (historyPositioned)
      for (const key of currentLayoutKeys)
        if (!previousKeySet.has(key)) pendingEntrances.current.add(key);
    for (const key of pendingEntrances.current)
      if (!currentLayoutKeys.includes(key))
        pendingEntrances.current.delete(key);

    if (localSendPending) handledLocalSendKey.current = chat.localSendKey;
    if (!chat.loaded || !historyPositioned) {
      clearTimeout(sendScrollTimer.current);
      sendScrollActive.current = false;
    }
    if (!chat.loaded || !historyPositioned || !layoutChanged) {
      if (chat.loaded && historyPositioned) {
        for (const [key, row] of readLayoutRows(node)) {
          if (!pendingEntrances.current.delete(key)) continue;
          if (!reducedMotionRef.current) animateEntrance(key, row.content);
        }
      }
      captureLayoutPositions();
      return;
    }

    if (localSendPending && !wasPinned) {
      clearTimeout(sendScrollTimer.current);
      sendScrollActive.current = true;
      pinnedToEnd.current = true;
      setShowLatest(false);
      node.scrollTo({
        top: node.scrollHeight - node.clientHeight,
        behavior: reducedMotionRef.current ? 'auto' : 'smooth',
      });
      sendScrollTimer.current = setTimeout(
        () => {
          node.scrollTop = node.scrollHeight - node.clientHeight;
          captureLayoutPositions();
          sendScrollActive.current = false;
          updateJump();
        },
        reducedMotionRef.current ? 0 : 500,
      );
      return;
    }

    if (!wasPinned) {
      captureLayoutPositions();
      updateJump();
      return;
    }

    const before = readLayoutRows(node);
    const visualOffsets = new Map(
      Array.from(before, ([key, row]) => [
        key,
        row.content.getBoundingClientRect().top - row.top,
      ]),
    );
    pinnedToEnd.current = true;
    setShowLatest(false);
    node.scrollTop = node.scrollHeight - node.clientHeight;

    const after = readLayoutRows(node);
    if (reducedMotionRef.current) {
      for (const key of after.keys()) pendingEntrances.current.delete(key);
    } else {
      for (const [key, row] of after) {
        const previousTop = layoutPositions.current.get(key);
        if (previousTop === undefined || !previousKeySet.has(key)) {
          if (pendingEntrances.current.delete(key))
            animateEntrance(key, row.content);
          continue;
        }
        const delta = previousTop + (visualOffsets.get(key) ?? 0) - row.top;
        if (Math.abs(delta) < 0.5) continue;
        row.content.animate(
          [
            { transform: `translateY(${delta}px)` },
            { transform: 'translateY(0)' },
          ],
          layoutShiftMotion,
        );
      }
    }
    captureLayoutPositions();
    requestAnimationFrame(() => {
      if (pinnedToEnd.current)
        node.scrollTop = node.scrollHeight - node.clientHeight;
      captureLayoutPositions();
      updateJump();
    });
  }, [
    captureLayoutPositions,
    chat.loaded,
    chat.localSendKey,
    chat.messages,
    chat.typing,
    historyPositioned,
    lastVirtualKey,
    updateJump,
  ]);

  useEffect(
    () => () => {
      clearTimeout(sendScrollTimer.current);
      sendScrollActive.current = false;
    },
    [],
  );

  useLayoutEffect(() => {
    const node = history.current;
    if (!node) return;
    if (!chat.loaded) setHistoryPositioned(false);
    if (!previousLoaded.current && chat.loaded) {
      pinnedToEnd.current = true;
      setShowLatest(false);
      virtualizer.scrollToEnd();
      requestAnimationFrame(() => {
        setHistoryPositioned(true);
        captureLayoutPositions();
        updateJump();
      });
      previousLoaded.current = chat.loaded;
      return;
    }
    previousLoaded.current = chat.loaded;
    if (!pinnedToEnd.current) updateJump();
  }, [
    captureLayoutPositions,
    chat.loaded,
    chat.messages,
    updateJump,
    virtualizer,
  ]);

  useLayoutEffect(() => {
    const scroller = history.current;
    const list = messages.current;
    if (!scroller || !list) return;
    const update = () => {
      const next =
        list.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      setScrollMargin((current) =>
        Math.abs(current - next) < 0.5 ? current : next,
      );
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    observer.observe(list.parentElement ?? list);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [chat.loaded]);

  const reconcileResize = useCallback(
    (edge: 'bottom' | 'top') => {
      const node = history.current;
      if (!node) return;
      reconciling.current = true;
      const pending = pendingReconciliation.current;
      if (pending) {
        if (edge === 'bottom') pending.edge = edge;
      } else {
        pendingReconciliation.current = {
          anchors: readingAnchors.current,
          edge,
          preserveEnd: pinnedToEnd.current,
        };
      }
      cancelAnimationFrame(reconciliationFrame.current);
      reconciliationFrame.current = requestAnimationFrame(() => {
        const next = pendingReconciliation.current;
        pendingReconciliation.current = undefined;
        if (!next) return;
        const restore = (restoreEdge: 'bottom' | 'top') => {
          const anchor = next.anchors?.[restoreEdge];
          if (!anchor) return false;
          const target = Array.from(
            node.querySelectorAll<HTMLElement>(
              'article.message[data-message-id]',
            ),
          ).find((message) => message.dataset.messageId === anchor.id);
          if (!target) return false;
          const bounds = node.getBoundingClientRect();
          const footer = findComposer(node);
          const delta =
            restoreEdge === 'bottom'
              ? target.getBoundingClientRect().bottom -
                ((footer?.getBoundingClientRect().top ?? bounds.bottom) -
                  anchor.offset)
              : target.getBoundingClientRect().top - bounds.top - anchor.offset;
          if (Math.abs(delta) >= 0.5) node.scrollTop += delta;
          return true;
        };
        const apply = () => {
          if (next.preserveEnd) {
            node.scrollTop = node.scrollHeight - node.clientHeight;
            return;
          }
          if (!restore(next.edge) && next.edge === 'bottom') restore('top');
        };
        apply();
        reconciliationFrame.current = requestAnimationFrame(() => {
          apply();
          reconciling.current = false;
          updateJump();
        });
      });
    },
    [updateJump],
  );

  useLayoutEffect(() => {
    const node = history.current;
    if (!node) return;
    const footer = findComposer(node);
    let historyHeight = node.getBoundingClientRect().height;
    let footerHeight = footer?.getBoundingClientRect().height;
    let keyboardWasOpen =
      document.documentElement.hasAttribute('data-keyboard-open');
    const sizeObserver = new ResizeObserver(() => {
      const nextHistoryHeight = node.getBoundingClientRect().height;
      const nextFooterHeight = footer?.getBoundingClientRect().height;
      const historyChanged = Math.abs(nextHistoryHeight - historyHeight) >= 0.5;
      const footerChanged =
        footerHeight !== undefined &&
        nextFooterHeight !== undefined &&
        Math.abs(nextFooterHeight - footerHeight) >= 0.5;
      const keyboardOpen =
        document.documentElement.hasAttribute('data-keyboard-open');
      const composerFocused = footer?.contains(document.activeElement) ?? false;
      historyHeight = nextHistoryHeight;
      footerHeight = nextFooterHeight;
      if (historyChanged || footerChanged)
        reconcileResize(
          footerChanged || keyboardOpen || keyboardWasOpen || composerFocused
            ? 'bottom'
            : 'top',
        );
      keyboardWasOpen = keyboardOpen;
    });
    sizeObserver.observe(node);
    if (footer) sizeObserver.observe(footer, { box: 'border-box' });
    const viewport = window.visualViewport;
    const reconcileViewport = () => {
      const keyboardOpen =
        document.documentElement.hasAttribute('data-keyboard-open');
      const composerFocused = footer?.contains(document.activeElement) ?? false;
      reconcileResize(
        keyboardOpen || keyboardWasOpen || composerFocused ? 'bottom' : 'top',
      );
      keyboardWasOpen = keyboardOpen;
    };
    const reconcileWindow = () => reconcileResize('top');
    viewport?.addEventListener('resize', reconcileViewport);
    window.addEventListener('resize', reconcileWindow);
    return () => {
      cancelAnimationFrame(reconciliationFrame.current);
      reconciling.current = false;
      pendingReconciliation.current = undefined;
      sizeObserver.disconnect();
      viewport?.removeEventListener('resize', reconcileViewport);
      window.removeEventListener('resize', reconcileWindow);
    };
  }, [reconcileResize]);

  const firstVirtualIndex = virtualizer.getVirtualItems()[0]?.index;

  useEffect(() => {
    if (
      firstVirtualIndex === undefined ||
      firstVirtualIndex > 5 ||
      !chat.loaded ||
      !historyPositioned ||
      chat.before === null ||
      chat.loadingOlder ||
      chat.syncing ||
      !chat.connected ||
      chat.historyError
    )
      return;
    void chat.loadOlder();
  }, [
    chat.before,
    chat.connected,
    chat.historyError,
    chat.loadOlder,
    chat.loaded,
    chat.loadingOlder,
    chat.syncing,
    firstVirtualIndex,
    historyPositioned,
  ]);

  useEffect(() => {
    const id = chat.navigationTarget?.id;
    if (!id) return;
    const index = chat.messages.findIndex((view) => view.message.id === id);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: 'center' });
    setHighlightedMessage(id);
    chat.clearNavigationTarget();
  }, [
    chat.clearNavigationTarget,
    chat.messages,
    chat.navigationTarget,
    virtualizer,
  ]);

  useEffect(() => {
    if (!highlightedMessage) return;
    const timer = setTimeout(() => setHighlightedMessage(undefined), 1800);
    return () => clearTimeout(timer);
  }, [highlightedMessage]);

  return (
    <main className="conversation">
      {chat.historyError && (
        <Alert id="history-error" role="alert" color="red">
          {chat.historyError}
          {chat.before !== null && !chat.syncing && (
            <Button
              type="button"
              variant="transparent"
              size="compact-sm"
              disabled={chat.loadingOlder || !chat.connected}
              onClick={() => void chat.loadOlder()}
            >
              Retry
            </Button>
          )}
        </Alert>
      )}
      <div
        ref={history}
        id="history"
        className="history"
        aria-label="Conversation"
        onScroll={updateJump}
      >
        <div className="history-content">
          <div className="history-top" role="status" aria-live="polite">
            {chat.loadingOlder ? 'Loading older messages…' : ''}
          </div>
          <div
            ref={messages}
            id="messages"
            style={{ height: virtualizer.getTotalSize() }}
          >
            <SecureEntryUpdates.Provider value={secureEntryUpdates}>
              <MessageList
                messages={chat.messages}
                taskRows={chat.taskRows}
                onOpenTask={chat.selectedTaskId ? undefined : chat.selectChat}
                onNavigate={(id) => void chat.ensureMessage(id)}
                onReply={chat.selectReply}
                virtualizer={virtualizer}
                scrollMargin={scrollMargin}
                highlightedMessage={highlightedMessage}
                showFirstDateSeparator={chat.before === null}
              />
            </SecureEntryUpdates.Provider>
          </div>
          {chat.typing && <TypingIndicator />}
          {!chat.messages.length && !chat.loaded && (
            <div className="conversation-loading" role="status">
              {!chat.online
                ? 'Conversation unavailable offline.'
                : chat.connected
                  ? 'Loading conversation…'
                  : 'Connecting…'}
            </div>
          )}
          {!chat.messages.length && chat.loaded && (
            <div id="empty" className="empty">
              <span className="empty-mark" aria-hidden="true">
                p
              </span>
              <h2>A little space to think.</h2>
              <p id="empty-detail">
                Ask a question, share an idea, or pick up where you left off.
              </p>
            </div>
          )}
        </div>
      </div>
      {showLatest && (
        <IconAction
          id="latest"
          className="latest pal-raised-glass"
          type="button"
          label="Jump to latest"
          onMouseDownCapture={(event) => {
            if (
              event.currentTarget.ownerDocument.documentElement.hasAttribute(
                'data-keyboard-open',
              )
            )
              event.preventDefault();
          }}
          onClick={() => {
            pinnedToEnd.current = true;
            virtualizer.scrollToEnd();
            setShowLatest(false);
          }}
        >
          <ChevronDown aria-hidden="true" size={16} strokeWidth={1.75} />
        </IconAction>
      )}
    </main>
  );
}
