import { createServer } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { RequestContext } from '@mastra/core/request-context';
import { AndroidService } from '../dist/android/android.service.js';
import { androidTools } from '../dist/android/android-tools.js';
import { PARENT_TASK_ID, WORKER_ID } from '../dist/agent/task-workers.js';
import { CodeModeProcessor } from '../dist/agent/code-mode.processor.js';

it('binds device/worker, masks observations, serializes private operations and retains ownership through cancellation', async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const native: string[] = [];
  let hold: Promise<void> | undefined;
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
      if (input.action === 'observe') await hold;
      if (input.action === 'pause' && pauseFail) {
        response.writeHead(503).end();
        return;
      }
      response.end(
        JSON.stringify(
          input.action === 'observe'
            ? {
                status: 'ready',
                session: 'fixture',
                identity: { packageName: 'com.example.app' },
                inputs: [],
                elements: [
                  { ref: '@a1', text: 'Public heading', type: 'TextView' },
                ],
                image: 'cG5n',
                width: 1080,
                height: 2400,
                imageWidth: 576,
                imageHeight: 1280,
              }
            : input.action === 'resolve'
              ? { x: 20, y: 30 }
              : { status: 'stopped' },
        ),
      );
      return;
    }
    if (input.id === undefined) {
      response.writeHead(202).end();
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
        : { content: [{ type: 'text', text: 'ready' }] };
    } else result = { tools: [] };
    response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture address');
  const service = new AndroidService(
    new ConfigService({
      PAL_ANDROID_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
      PAL_ANDROID_MCP_TOKEN: 'fixture',
      PAL_ANDROID_DEVICE_ID: 'usb-phone',
    }),
  );
  const first = { taskId: 'one', workerId: 'one' },
    second = { taskId: 'two', workerId: 'two' };
  try {
    const tools = androidTools(service);
    expect(
      Object.keys(androidTools(new AndroidService(new ConfigService()))),
    ).toEqual([]);
    expect(Object.keys(tools)).not.toContain('mobile_clear_app_data');
    await service.call(first, 'android_apps', { device: 'wrong' });
    expect(calls[0].arguments).toEqual({ device: 'usb-phone' });
    const screenshot = await service.call(first, 'android_screenshot', {
      maxSize: 9000,
    });
    expect(native).toEqual(['pause', 'observe']);
    expect(calls).toHaveLength(1);
    expect(tools.android_screenshot!.toModelOutput!(screenshot)).toMatchObject({
      type: 'content',
      value: [
        { type: 'text', text: expect.stringContaining('Masked') },
        { type: 'media', data: 'cG5n', mediaType: 'image/png' },
      ],
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
    await expect(service.call(second, 'android_apps', {})).rejects.toThrow(
      'busy',
    );
    const gate = Promise.withResolvers<void>();
    hold = gate.promise;
    const abort = new AbortController();
    const pending = service.call(first, 'android_inspect', {}, abort.signal);
    await vi.waitFor(() => expect(native).toHaveLength(3));
    abort.abort();
    const release = service.release(first.taskId, first.workerId);
    await expect(service.call(second, 'android_apps', {})).rejects.toThrow(
      'busy',
    );
    expect(native.filter((action) => action === 'pause')).toHaveLength(1);
    gate.resolve();
    await pending;
    await release;
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
    await service.release('two', 'two', true);
    expect(service.owns('two', 'two')).toBe(true);
    await expect(service.call(first, 'android_apps', {})).rejects.toThrow(
      'busy',
    );
    fail = true;
    await expect(service.call(second, 'android_apps', {})).rejects.toThrow(
      'Android operation failed',
    );
    fail = false;
    await service.release('two', 'two');
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
      x: 20,
      y: 30,
      device: 'usb-phone',
    });
    await service.call(second, 'android_apps', {});
    expect(connections).toBe(2);
    pauseFail = true;
    await expect(service.release('two', 'two')).rejects.toThrow(
      'private operation',
    );
    await expect(service.call(first, 'android_apps', {})).rejects.toThrow(
      'busy',
    );
    pauseFail = false;
    await service.release('two', 'two');
  } finally {
    pauseFail = false;
    await service.onApplicationShutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
