import { useEffect, type RefObject } from 'react';
import type { WebPushBadge } from '../api/client';
import { markWebPushBadgeSeen } from './web-push';

export function useNotificationBadge(
  badge: WebPushBadge | undefined,
  active: boolean,
  viewport: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!badge?.count || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let busy = false;
    const acknowledge = async () => {
      const node = viewport.current;
      if (
        stopped ||
        busy ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus() ||
        !node?.clientHeight ||
        node.scrollHeight - node.clientHeight - node.scrollTop >= 100
      )
        return;
      busy = true;
      const success = await markWebPushBadgeSeen(badge);
      busy = false;
      if (!success && !stopped)
        timer = setTimeout(() => void acknowledge(), 2000);
    };
    const visible = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void acknowledge());
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    visible();
    return () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
    };
  }, [active, badge, viewport]);
}
