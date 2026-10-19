import { useCallback, useEffect, useRef, useState } from 'react';

const typingAppearanceRate = 0.8;
const minimumReadDelayMs = 1_000;
const maximumReadDelayMs = 5_000;
const minimumTypingDelayMs = 2_000;
const maximumTypingDelayMs = 8_000;
const minimumTypingDurationMs = 2_200;
const maximumTypingDurationMs = 8_000;

export interface ConversationPacingTiming {
  readDelayMs: number;
  typingDelayMs?: number;
  typingDurationMs?: number;
}

function randomDuration(
  random: () => number,
  minimum: number,
  maximum: number,
) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

export function conversationPacingTiming(
  random: () => number = Math.random,
): ConversationPacingTiming {
  const readDelayMs = randomDuration(
    random,
    minimumReadDelayMs,
    maximumReadDelayMs,
  );
  if (random() >= typingAppearanceRate) return { readDelayMs };
  return {
    readDelayMs,
    typingDelayMs: randomDuration(
      random,
      minimumTypingDelayMs,
      maximumTypingDelayMs,
    ),
    typingDurationMs: randomDuration(
      random,
      minimumTypingDurationMs,
      maximumTypingDurationMs,
    ),
  };
}

interface BurstMessage {
  accepted: boolean;
  key: string;
  persisted: boolean;
}

interface ConversationBurst {
  afterSequence: number;
  assistantArrived: boolean;
  messages: BurstMessage[];
  readDue: boolean;
  readTimer?: ReturnType<typeof setTimeout>;
  typingDue: boolean;
  typingDurationMs?: number;
  typingFinished: boolean;
  typingTimer?: ReturnType<typeof setTimeout>;
  typingTimeout?: ReturnType<typeof setTimeout>;
}

interface PacingView {
  activeMessageKey?: string;
  receiptMessageKey?: string;
  typingVisible: boolean;
}

function latestMessage(burst: ConversationBurst) {
  return burst.messages.at(-1);
}

function clearBurstTimers(burst?: ConversationBurst) {
  clearTimeout(burst?.readTimer);
  clearTimeout(burst?.typingTimer);
  clearTimeout(burst?.typingTimeout);
}

export function useConversationPacing() {
  const [view, setView] = useState<PacingView>({ typingVisible: false });
  const currentView = useRef(view);
  const burst = useRef<ConversationBurst | undefined>(undefined);

  const commit = useCallback((update: Partial<PacingView>) => {
    const next = { ...currentView.current, ...update };
    currentView.current = next;
    setView(next);
  }, []);

  const activateDuePresentation = useCallback(() => {
    const active = burst.current;
    const latest = active && latestMessage(active);
    if (!active || !latest) return;

    const receiptVisible =
      latest.persisted &&
      (active.readDue || active.typingDue || active.assistantArrived);
    const typingVisible =
      latest.persisted &&
      latest.accepted &&
      active.typingDue &&
      !active.typingFinished &&
      !active.assistantArrived;
    const update: Partial<PacingView> = {};
    if (receiptVisible) update.receiptMessageKey = latest.key;
    if (typingVisible && !currentView.current.typingVisible) {
      update.typingVisible = true;
      if (!active.typingTimeout) {
        const expected = active;
        active.typingTimeout = setTimeout(() => {
          if (burst.current !== expected) return;
          expected.typingTimeout = undefined;
          expected.typingFinished = true;
          commit({ typingVisible: false });
        }, active.typingDurationMs);
      }
    }
    if (Object.keys(update).length) commit(update);
  }, [commit]);

  const reset = useCallback(() => {
    clearBurstTimers(burst.current);
    burst.current = undefined;
    commit({
      activeMessageKey: undefined,
      receiptMessageKey: undefined,
      typingVisible: false,
    });
  }, [commit]);

  const messageSubmitted = useCallback(
    (key: string, afterSequence: number) => {
      let active = burst.current;
      if (!active || active.assistantArrived) {
        clearBurstTimers(active);
        const timing = conversationPacingTiming();
        active = {
          afterSequence,
          assistantArrived: false,
          messages: [],
          readDue: false,
          typingDue: false,
          typingDurationMs: timing.typingDurationMs,
          typingFinished: timing.typingDelayMs === undefined,
        };
        burst.current = active;
        const expected = active;
        active.readTimer = setTimeout(() => {
          if (burst.current !== expected) return;
          expected.readTimer = undefined;
          expected.readDue = true;
          activateDuePresentation();
        }, timing.readDelayMs);
        if (timing.typingDelayMs !== undefined)
          active.typingTimer = setTimeout(() => {
            if (burst.current !== expected) return;
            expected.typingTimer = undefined;
            expected.typingDue = true;
            activateDuePresentation();
          }, timing.typingDelayMs);
      }
      active.messages.push({ accepted: false, key, persisted: false });
      commit({
        activeMessageKey: key,
        receiptMessageKey: undefined,
        typingVisible: false,
      });
      activateDuePresentation();
    },
    [activateDuePresentation, commit],
  );

  const messageAccepted = useCallback(
    (key: string) => {
      const active = burst.current;
      const message = active?.messages.find(
        (candidate) => candidate.key === key,
      );
      if (!active || !message) return;
      message.accepted = true;
      if (message === latestMessage(active)) activateDuePresentation();
    },
    [activateDuePresentation],
  );

  const messagesPersisted = useCallback(
    (keys: Set<string>) => {
      const active = burst.current;
      if (!active) return;
      let changed = false;
      for (const message of active.messages)
        if (!message.persisted && keys.has(message.key)) {
          message.persisted = true;
          changed = true;
        }
      if (changed) activateDuePresentation();
    },
    [activateDuePresentation],
  );

  const messageFailed = useCallback(
    (key: string) => {
      const active = burst.current;
      if (!active) return;
      active.messages = active.messages.filter(
        (message) => message.key !== key,
      );
      const latest = latestMessage(active);
      if (!latest) {
        reset();
        return;
      }
      commit({
        activeMessageKey: latest.key,
        receiptMessageKey: undefined,
        typingVisible: false,
      });
      activateDuePresentation();
    },
    [activateDuePresentation, commit, reset],
  );

  const assistantArrived = useCallback(
    (sequence: number) => {
      const active = burst.current;
      if (
        !active ||
        active.assistantArrived ||
        sequence <= active.afterSequence
      )
        return;
      active.assistantArrived = true;
      active.readDue = true;
      active.typingFinished = true;
      clearTimeout(active.readTimer);
      clearTimeout(active.typingTimer);
      clearTimeout(active.typingTimeout);
      active.readTimer = undefined;
      active.typingTimer = undefined;
      active.typingTimeout = undefined;
      commit({ typingVisible: false });
      activateDuePresentation();
    },
    [activateDuePresentation, commit],
  );

  useEffect(
    () => () => {
      clearBurstTimers(burst.current);
      burst.current = undefined;
    },
    [],
  );

  return {
    ...view,
    assistantArrived,
    messageAccepted,
    messageFailed,
    messageSubmitted,
    messagesPersisted,
    reset,
  };
}
