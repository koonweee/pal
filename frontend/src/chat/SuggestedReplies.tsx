import { Button } from '@mantine/core';
import { useState } from 'react';

export function SuggestedReplies({
  messageId,
  replies,
  disabled,
  onSelect,
}: {
  messageId: string;
  replies: string[];
  disabled: boolean;
  onSelect(messageId: string, index: number): void;
}) {
  // Retain the labels while their container fades and collapses after consumption.
  const [displayed, setDisplayed] = useState(replies);
  if (replies.length && displayed !== replies) setDisplayed(replies);
  if (!displayed.length) return null;
  const visible = replies.length > 0;
  return (
    <div
      className="suggested-replies"
      role="group"
      aria-label="Suggested replies"
      aria-hidden={!visible}
      inert={!visible}
      data-visible={visible}
    >
      <div className="suggested-replies-clip">
        <div className="suggested-replies-options">
          {displayed.map((reply, index) => (
            <Button
              key={reply}
              type="button"
              variant="outline"
              size="compact-sm"
              fw={400}
              radius="xl"
              className="suggested-reply"
              disabled={disabled || !visible}
              onClick={() => onSelect(messageId, index)}
            >
              {reply}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
