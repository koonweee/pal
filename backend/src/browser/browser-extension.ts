import { setTimeout as delay } from 'node:timers/promises';

type Target = { targetId: string; type: string; url: string };

/** Reach only the extension; Playwright's page initialization can block on a hung renderer. */
export async function extensionRequest<T>(
  endpoint: string,
  request: object,
): Promise<T> {
  const socket = new WebSocket(endpoint);
  let id = 0;
  let failure: Error | undefined;
  let reply:
    | {
        id: number;
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  let opened!: () => void;
  let openFailed!: (error: Error) => void;
  let scriptURL: string | undefined;
  let pageSession: string | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    opened = resolve;
    openFailed = reject;
  });
  const fail = (error: Error) => {
    failure = error;
    openFailed(error);
    reply?.reject(error);
  };
  const timer = setTimeout(
    () => fail(new Error('Pal browser extension request timed out')),
    10_000,
  );
  socket.onopen = () => opened();
  socket.onerror = () =>
    fail(new Error('Pal browser extension connection failed'));
  socket.onclose = () =>
    fail(new Error('Pal browser extension connection closed'));
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(String(data)) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
      method?: string;
      sessionId?: string;
      params?: { versions?: { scriptURL: string }[] };
    };
    if (reply && message.id === reply.id) {
      const current = reply;
      reply = undefined;
      if (message.error) current.reject(new Error(message.error.message));
      else current.resolve(message.result);
    }
    if (
      message.sessionId === pageSession &&
      message.method === 'ServiceWorker.workerVersionUpdated'
    ) {
      scriptURL =
        message.params?.versions?.find((version) =>
          isExtension(version.scriptURL),
        )?.scriptURL ?? scriptURL;
    }
  };
  const send = async <R>(
    method: string,
    params: object = {},
    sessionId?: string,
  ): Promise<R> => {
    if (failure) throw failure;
    return new Promise<unknown>((resolve, reject) => {
      reply = { id: ++id, resolve, reject };
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    }) as Promise<R>;
  };
  try {
    await ready;
    const targets = async () =>
      (await send<{ targetInfos: Target[] }>('Target.getTargets')).targetInfos;
    let inventory = await targets();
    let worker = inventory.find(
      (target) => target.type === 'service_worker' && isExtension(target.url),
    );
    if (!worker) {
      const page = inventory.find((target) => target.type === 'page');
      if (!page) throw new Error('Chromium has no open window');
      ({ sessionId: pageSession } = await send<{ sessionId: string }>(
        'Target.attachToTarget',
        { targetId: page.targetId, flatten: true },
      ));
      // These browser-handled commands do not run page JavaScript, even when
      // its renderer is hung. Wait for the asynchronous registration event.
      await send('ServiceWorker.enable', {}, pageSession);
      while (!scriptURL) {
        if (failure) throw failure;
        await delay(50);
      }
      await send(
        'ServiceWorker.startWorker',
        { scopeURL: new URL('.', scriptURL).href },
        pageSession,
      );
      while (!worker) {
        inventory = await targets();
        worker = inventory.find(
          (target) =>
            target.type === 'service_worker' && target.url === scriptURL,
        );
        if (!worker) await delay(50);
      }
    }
    const { sessionId } = await send<{ sessionId: string }>(
      'Target.attachToTarget',
      { targetId: worker.targetId, flatten: true },
    );
    const result = await send<{
      result: { value?: T };
      exceptionDetails?: unknown;
    }>(
      'Runtime.evaluate',
      {
        expression: 'globalThis.palBrowser(' + JSON.stringify(request) + ')',
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    );
    if (result.exceptionDetails)
      throw new Error('Pal browser extension operation failed');
    return result.result.value as T;
  } finally {
    clearTimeout(timer);
    // Disconnecting detaches only this client's sessions. Never close Chrome,
    // a user page, or another debugger connection during extension control.
    socket.close();
  }
}

function isExtension(url: string) {
  return (
    url.startsWith('chrome-extension://') && url.endsWith('/pal-task-groups.js')
  );
}
