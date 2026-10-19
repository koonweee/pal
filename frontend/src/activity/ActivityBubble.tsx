import { Button, Modal, ScrollArea, UnstyledButton } from '@mantine/core';
import { useEffect, useState, type ReactNode } from 'react';
import { Check, Layers2, Sparkle } from 'lucide-react';
import type { AgentActivity } from '../api/client';
import {
  completionDuration,
  selectBubble,
  selectCompletion,
  type ActivityConnection,
} from './select-bubble';
import './activity.css';

export function ActivityBubble({
  activity,
  connection,
  disabled,
  fallback,
  onNavigate,
}: {
  activity?: AgentActivity;
  connection: ActivityConnection;
  disabled: boolean;
  fallback: ReactNode;
  onNavigate(taskId: string, messageId?: string): void;
}) {
  const [now, setNow] = useState(Date.now);
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => {
    const current = Date.now();
    setNow(current);
    const completion = activity?.latestCompletion;
    if (!completion) return;
    const remaining =
      Date.parse(completion.occurredAt) + completionDuration - current;
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining);
    return () => window.clearTimeout(timer);
  }, [activity]);
  const bubble = selectBubble(activity, connection, now);
  const completion = selectCompletion(activity, connection, now);
  const tasks = bubble?.tasks;
  useEffect(() => {
    if (!tasks) setListOpen(false);
  }, [tasks]);
  if (!bubble) return fallback;
  const label =
    bubble.kind === 'completion' ? `${bubble.text} finished` : bubble.text;
  const motif = completion
    ? 'completion'
    : bubble.kind === 'input'
      ? 'input'
      : bubble.kind === 'multiple'
        ? 'multiple'
        : bubble.kind === 'working' && !bubble.dots
          ? 'star'
          : undefined;
  const content = (
    <span className="activity-card">
      <span className="activity-sheet" aria-hidden="true" />
      <span className="activity-sheet" aria-hidden="true" />
      <span className="activity-speech">
        {motif && (
          <span
            className="activity-charm"
            data-motif={motif}
            aria-hidden="true"
          >
            {motif === 'completion' ? (
              <Check size={12} strokeWidth={2} />
            ) : motif === 'multiple' ? (
              <Layers2 size={12} strokeWidth={1.5} />
            ) : motif === 'input' ? (
              '?'
            ) : (
              <Sparkle size={12} strokeWidth={1.5} fill="currentColor" />
            )}
          </span>
        )}
        {bubble.dots ? (
          <span key="dots" className="activity-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span key={bubble.text} className="activity-text">
            {bubble.text}
          </span>
        )}
      </span>
    </span>
  );
  const interactive = !!bubble.taskId || !!tasks;
  return (
    <>
      <span className="activity-quest" data-kind={bubble.kind}>
        {interactive ? (
          <UnstyledButton
            className="activity-bubble"
            aria-label={label}
            aria-haspopup={tasks ? 'dialog' : undefined}
            disabled={disabled}
            onClick={() => {
              if (tasks) setListOpen(true);
              else if (bubble.taskId)
                onNavigate(bubble.taskId, bubble.messageId);
            }}
          >
            {content}
          </UnstyledButton>
        ) : (
          <span className="activity-bubble" role="status" aria-label={label}>
            {content}
          </span>
        )}
        {completion && (
          <span key={completion.cueId} className="activity-completion">
            <span className="sr-only" role="status">
              {completion.title} finished
            </span>
            <span className="activity-sparkles" aria-hidden="true">
              <Sparkle
                className="activity-spark"
                size={12}
                fill="currentColor"
              />
              <Sparkle
                className="activity-spark"
                size={10}
                fill="currentColor"
              />
              <Sparkle
                className="activity-spark"
                size={9}
                fill="currentColor"
              />
            </span>
          </span>
        )}
      </span>
      <Modal
        opened={listOpen && !!tasks}
        onClose={() => setListOpen(false)}
        title={bubble.listTitle}
        centered
        size="sm"
        classNames={{
          content: 'panel-surface',
          header: 'activity-list-header',
        }}
      >
        <ScrollArea.Autosize mah="60dvh" type="auto">
          <div className="activity-list">
            {tasks?.map((task) => (
              <Button
                key={task.id}
                variant="subtle"
                justify="flex-start"
                disabled={disabled}
                onClick={() => {
                  setListOpen(false);
                  onNavigate(task.id);
                }}
              >
                {task.title || '…'}
              </Button>
            ))}
          </div>
        </ScrollArea.Autosize>
      </Modal>
    </>
  );
}
