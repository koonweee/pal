import { useEffect, useRef } from 'react';

export function useNotificationNavigation(openMain: () => void) {
  const latest = useRef(openMain);
  latest.current = openMain;
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const receive = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_MAIN') latest.current();
    };
    navigator.serviceWorker.addEventListener('message', receive);
    const url = new URL(location.href);
    if (url.searchParams.get('notification') === 'main') {
      url.searchParams.delete('notification');
      history.replaceState(null, '', url);
      latest.current();
    }
    return () =>
      navigator.serviceWorker.removeEventListener('message', receive);
  }, []);
}
