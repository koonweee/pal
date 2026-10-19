import { useDrag } from '@use-gesture/react';
import { useEffect, useRef } from 'react';

const maximumDistance = 72;
const activationDistance = 56;
const releaseDistance = 44;
const resetDelay = 180;
const interactiveTarget =
  'a, button, input, textarea, select, [contenteditable="true"]';

function isTouchPointer(event: UIEvent) {
  return 'pointerType' in event && event.pointerType === 'touch';
}

function startedFromInteractiveContent(event: UIEvent) {
  return (
    event.target instanceof Element && !!event.target.closest(interactiveTarget)
  );
}

export function useSwipeReply({
  enabled,
  onReply,
}: {
  enabled: boolean;
  onReply(): void;
}) {
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  return useDrag(
    ({ canceled, cancel, event, first, last, movement: [movementX] }) => {
      const row = event.currentTarget;
      if (!(row instanceof HTMLElement)) return;
      if (startedFromInteractiveContent(event)) {
        cancel();
        return;
      }

      if (first) {
        if (!isTouchPointer(event)) {
          cancel();
          return;
        }
        if (resetTimer.current) clearTimeout(resetTimer.current);
      }

      const distance = Math.min(maximumDistance, Math.max(0, -movementX));
      const wasArmed = row.dataset.replySwipe === 'armed';
      const armed = wasArmed
        ? distance >= releaseDistance
        : distance >= activationDistance;

      row.style.setProperty('--pal-reply-swipe-offset', `${-distance}px`);
      row.style.setProperty(
        '--pal-reply-swipe-progress',
        String(Math.min(1, distance / activationDistance)),
      );
      row.dataset.replySwipe = armed ? 'armed' : 'tracking';

      if (!last) return;

      const triggered = !canceled && armed;
      row.dataset.replySwipe = triggered ? 'triggered' : 'settling';
      row.style.setProperty('--pal-reply-swipe-offset', '0px');
      row.style.setProperty('--pal-reply-swipe-progress', '0');
      if (triggered) onReply();

      resetTimer.current = setTimeout(() => {
        delete row.dataset.replySwipe;
        row.style.removeProperty('--pal-reply-swipe-offset');
        row.style.removeProperty('--pal-reply-swipe-progress');
      }, resetDelay);
    },
    {
      enabled,
      axis: 'x',
      axisThreshold: { touch: 8 },
      filterTaps: true,
      pointer: { keys: false },
    },
  );
}
