/// <reference lib="webworker" />

import { isBadgeSnapshot, updateBadge } from './badges';
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';
import { dynamicRoutePattern, isDynamicPath } from './routes';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<Parameters<typeof precacheAndRoute>[0][number]>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Long-lived event streams must not keep a retiring worker's fetch event open.
registerRoute(
  ({ url }) =>
    isDynamicPath(url.pathname) &&
    !['/api/stream', '/stream'].includes(url.pathname),
  new NetworkOnly(),
);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [dynamicRoutePattern],
  }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'BADGE_STATE' && isBadgeSnapshot(event.data.badge))
    event.waitUntil(
      updateBadge(self.navigator, event.data.badge, 'page').catch(
        () => undefined,
      ),
    );
  if (event.data?.type === 'BADGE_DISABLED')
    event.waitUntil(
      updateBadge(self.navigator, undefined, 'disable').catch(() => undefined),
    );
  if (
    event.data === 'SKIP_WAITING' ||
    (typeof event.data === 'object' && event.data?.type === 'SKIP_WAITING')
  )
    event.waitUntil(self.skipWaiting());
});

clientsClaim();

self.addEventListener('push', (event) => {
  const show = async () => {
    let payload: {
      title?: unknown;
      body?: unknown;
      tag?: unknown;
      badge?: unknown;
    } = {};
    try {
      const data: unknown = event.data?.json();
      if (data && typeof data === 'object') payload = data;
    } catch {
      /* visible fallback */
    }
    await Promise.all([
      isBadgeSnapshot(payload.badge)
        ? updateBadge(self.navigator, payload.badge, 'push').catch(
            () => undefined,
          )
        : Promise.resolve(),
      self.registration.showNotification(
        typeof payload.title === 'string' ? payload.title : 'Pal',
        {
          body: typeof payload.body === 'string' ? payload.body : 'New message',
          tag: typeof payload.tag === 'string' ? payload.tag : undefined,
          icon: '/icons/pal-production-192.png',
        },
      ),
    ]);
  };
  event.waitUntil(show());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const appClients = clients.filter(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      const existing =
        appClients.find((client) => client.focused) ?? appClients[0];
      if (existing) {
        existing.postMessage({ type: 'OPEN_MAIN' });
        await existing.focus();
      } else {
        await self.clients.openWindow('/?notification=main');
      }
    })(),
  );
});
