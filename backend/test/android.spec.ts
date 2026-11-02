import { createServer } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { RequestContext } from '@mastra/core/request-context';
import {
  androidActions,
  AndroidService,
  type AndroidOwner,
} from '../dist/android/android.service.js';
import { androidTools } from '../dist/android/android-tools.js';
import { PARENT_TASK_ID, WORKER_ID } from '../dist/agent/task-workers.js';
import { CodeModeProcessor } from '../dist/agent/code-mode.processor.js';
import { InteractionCoordinator } from '../dist/interaction/interaction-coordinator.js';

it('allows fresh private inspection after a readiness failure without disabling the phone', async () => {
  const service = new AndroidService(
    new ConfigService({ PAL_ANDROID_MCP_URL: 'http://phone.test/mcp' }),
  );
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(new Error('No USB phone'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ready' })));
  const owner = { taskId: 'task', workerId: 'worker' };
  try {
    await expect(service.secure(owner, { action: 'inspect' })).rejects.toThrow(
      'unavailable',
    );
    expect(service.coordinator.snapshot()[1].unavailable).toBe(false);
    expect(await service.secure(owner, { action: 'inspect' })).toEqual({
      status: 'ready',
    });
  } finally {
    fetch.mockRestore();
    await service.coordinator.shutdown();
    await service.onApplicationShutdown();
  }
});

it('binds device/worker, preserves upstream observations and schemas, serializes private operations and retains ownership through cancellation', async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const native: string[] = [];
  let hold: Promise<void> | undefined;
  let discoveryFailure: 'initialize' | 'tools/list' | undefined;
  let fail = false,
    loseResponse = false,
    pauseFail = false,
    connections = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    expect(request.headers.authorization).toBe('Bearer fixture');
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/secure') {
      native.push(input.action);
      if (input.action === 'inspect') await hold;
      if (input.action === 'pause' && pauseFail) {
        response.writeHead(503).end();
        return;
      }
      response.end(
        JSON.stringify(
          input.action === 'inspect'
            ? {
                status: 'ready',
                session: 'fixture',
                identity: { packageName: 'com.example.app' },
                inputs: [],
                image: 'cG5n',
                width: 1080,
                height: 2400,
                imageWidth: 576,
                imageHeight: 1280,
              }
            : { status: 'stopped' },
        ),
      );
      return;
    }
    if (input.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    if (input.method === discoveryFailure) {
      if (discoveryFailure === 'initialize') response.writeHead(503).end();
      // Leave discovery unanswered to exercise the real SDK timeout.
      return;
    }
    let result: unknown;
    if (input.method === 'initialize') {
      connections++;
      result = {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'android-fixture', version: '1' },
      };
    } else if (input.method === 'tools/call') {
      calls.push(input.params);
      if (loseResponse) {
        loseResponse = false;
        request.socket.destroy();
        return;
      }
      result = fail
        ? {
            isError: true,
            content: [{ type: 'text', text: 'PRIVATE_UPSTREAM_DIAGNOSTIC' }],
          }
        : {
            content:
              input.params.name === 'mobile_take_screenshot'
                ? [{ type: 'image', data: 'cG5n', mimeType: 'image/png' }]
                : [{ type: 'text', text: 'ready' }],
          };
    } else
      result = {
        tools: Object.values(androidActions).map((name) => ({
          name,
          description: name,
          inputSchema: {
            type: 'object',
            properties: {
              device: { type: 'string' },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    arguments: { type: 'object' },
                  },
                },
              },
            },
            required: ['device'],
          },
        })),
      };
    response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture address');
  const coordinator = new InteractionCoordinator();
  const service = new AndroidService(
    new ConfigService({
      PAL_ANDROID_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
      PAL_ANDROID_MCP_TOKEN: 'fixture',
      PAL_ANDROID_DEVICE_ID: 'usb-phone',
    }),
    coordinator,
  );
  const first = { taskId: 'one', workerId: 'one' },
    second = { taskId: 'two', workerId: 'two' };
  const firstExecution = coordinator.begin(first, 'parent');
  const secondExecution = coordinator.begin(second, 'parent');
  // Emulate the production tool processor while exercising the real adapter.
  const turnId = (owner: AndroidOwner) =>
    owner.workerId === first.workerId ? firstExecution : secondExecution;
  const invoke = service.call.bind(service);
  service.call = (owner, action, args, signal) =>
    coordinator.run(
      'android',
      turnId(owner),
      () => invoke(owner, action, args, signal),
      signal,
    );
  const secure = service.secure.bind(service);
  service.secure = <T>(
    owner: AndroidOwner,
    input: object,
    signal?: AbortSignal,
  ) =>
    coordinator.run(
      'android',
      turnId(owner),
      () => secure<T>(owner, input, signal),
      signal,
    );
  const activateSurface = vi.fn();
  try {
    discoveryFailure = 'initialize';
    expect(await androidTools(service)).toEqual({});
    discoveryFailure = undefined;
    const tools = await androidTools(service, undefined, activateSurface);
    expect(connections).toBe(1);
    discoveryFailure = 'tools/list';
    const discoveryStarted = Date.now();
    expect(await androidTools(service)).toEqual({});
    expect(Date.now() - discoveryStarted).toBeLessThan(6000);
    discoveryFailure = undefined;
    expect(Object.keys(await androidTools(service))).toEqual(
      Object.keys(tools),
    );
    expect(connections).toBe(2);
    expect(
      Object.keys(await androidTools(new AndroidService(new ConfigService()))),
    ).toEqual([]);
    expect(Object.keys(tools)).not.toContain('mobile_clear_app_data');
    await service.call(first, 'android_apps', { device: 'wrong' });
    expect(calls[0].arguments).toEqual({ device: 'usb-phone' });
    const screenshot = await service.call(first, 'android_screenshot', {
      maxSize: 9000,
    });
    await service.call(first, 'android_inspect', {});
    await service.call(first, 'android_inspect', {});
    expect(native).toEqual(['pause']);
    expect(calls).toHaveLength(4);
    expect(tools.android_screenshot!.toModelOutput!(screenshot)).toMatchObject({
      type: 'content',
      value: [{ type: 'media', data: 'cG5n', mediaType: 'image/png' }],
    });
    await expect(
      tools.android_apps!.execute!(
        {},
        { requestContext: new RequestContext() },
      ),
    ).rejects.toThrow('interaction worker');
    let instructions = '';
    const processed = new CodeModeProcessor().processInputStep({
      tools,
      messageList: {
        clearSystemMessages() {},
        addSystem(text: string) {
          instructions = text;
        },
      },
    } as unknown as Parameters<CodeModeProcessor['processInputStep']>[0]);
    expect(processed.tools.android_screenshot).toBeDefined();
    expect(instructions).toContain('android_inspect');
    expect(instructions).not.toContain('android_screenshot');
    const gate = Promise.withResolvers<void>();
    hold = gate.promise;
    const abort = new AbortController();
    const pending = service.secure(first, { action: 'inspect' }, abort.signal);
    await vi.waitFor(() => expect(native).toHaveLength(2));
    abort.abort();
    const release = coordinator.finish(firstExecution);
    const next = service.call(second, 'android_apps', {});
    expect(native.filter((action) => action === 'pause')).toHaveLength(1);
    gate.resolve();
    await pending;
    await release;
    await next;
    hold = undefined;
    expect(native.at(-1)).toBe('pause');
    await tools.android_apps!.execute!(
      {},
      {
        requestContext: new RequestContext([
          [PARENT_TASK_ID, 'two'],
          [WORKER_ID, 'two'],
        ]),
      },
    );
    expect(activateSurface).toHaveBeenCalledWith('two', 'two');
    expect(service.owns('two', 'two')).toBe(true);
    await service.call(second, 'android_batch', {
      steps: [
        {
          name: 'android_tap',
          arguments: { ref: '@e1', x: null, y: null, device: 'wrong' },
        },
        { name: 'android_clipboard', arguments: { text: null } },
      ],
      listElementsAtEnd: true,
    });
    expect(calls.at(-1)?.arguments).toEqual({
      device: 'usb-phone',
      listElementsAtEnd: true,
      steps: [
        {
          name: 'mobile_click_on_screen_at_coordinates',
          arguments: { ref: '@e1', device: 'usb-phone' },
        },
        { name: 'mobile_clipboard', arguments: { device: 'usb-phone' } },
      ],
    });
    await expect(
      service.call(second, 'android_batch', {
        steps: [{ name: 'mobile_clear_app_data', arguments: {} }],
      }),
    ).rejects.toThrow('Unsupported');
    fail = true;
    expect(await service.call(second, 'android_apps', {})).toMatchObject({
      isError: true,
      content: [{ text: 'PRIVATE_UPSTREAM_DIAGNOSTIC' }],
    });
    fail = false;
    const pre = new AbortController();
    pre.abort();
    await expect(
      service.call(first, 'android_apps', {}, pre.signal),
    ).rejects.toThrow();
    expect(service.owns('one', 'one')).toBe(false);
    await service.call(second, 'android_apps', {});
    const dispatched = calls.length;
    loseResponse = true;
    await expect(
      service.call(second, 'android_tap', { ref: '@a1' }),
    ).rejects.toThrow('Android connection failed');
    expect(calls).toHaveLength(dispatched + 1);
    expect(calls.at(-1)?.arguments).toEqual({
      ref: '@a1',
      device: 'usb-phone',
    });
    await expect(service.call(second, 'android_apps', {})).rejects.toThrow(
      'unavailable',
    );
    expect(connections).toBe(2);
    await coordinator.finish(secondExecution);
  } finally {
    pauseFail = false;
    await service.onApplicationShutdown();
    await coordinator.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
