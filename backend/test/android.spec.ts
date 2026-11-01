import { createServer } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { RequestContext } from '@mastra/core/request-context';
import { AndroidService } from '../dist/android/android.service.js';
import { androidTools } from '../dist/android/android-tools.js';
import { PARENT_TASK_ID, WORKER_ID } from '../dist/agent/task-workers.js';
import { CodeModeProcessor } from '../dist/agent/code-mode.processor.js';

it('binds the phone, scopes tools/media, serializes ownership, and releases after cancelled in-flight work', async () => {
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  let hold: Promise<void> | undefined;
  let fail = false;
  let loseResponse = false;
  let connections = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    expect(request.headers.authorization).toBe('Bearer fixture');
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
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
      await hold;
      result = fail
        ? {
            isError: true,
            content: [{ type: 'text', text: 'Phone disconnected' }],
          }
        : input.params.name === 'mobile_take_screenshot'
          ? {
              content: [
                { type: 'text', text: 'screen coordinates' },
                { type: 'image', data: 'cG5n', mimeType: 'image/png' },
              ],
            }
          : { content: [{ type: 'text', text: 'ready' }] };
    } else result = { tools: [] };
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw Error('Missing fixture address');
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
    expect(Object.keys(tools)).not.toContain('mobile_allocate_remote_device');
    const screenshot = await service.call(first, 'android_screenshot', {
      device: 'wrong',
      maxSize: 9000,
    });
    expect(calls[0]?.arguments).toEqual({ device: 'usb-phone', maxSize: 1280 });
    const media = tools.android_screenshot!.toModelOutput!(screenshot);
    expect(media).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'screen coordinates' },
        { type: 'media', data: 'cG5n', mediaType: 'image/png' },
      ],
    });
    await expect(
      tools.android_apps!.execute!(
        {},
        { requestContext: new RequestContext() },
      ),
    ).rejects.toThrow('interaction worker');
    const processor = new CodeModeProcessor();
    let runnerInstructions = '';
    const processed = processor.processInputStep({
      tools,
      messageList: {
        clearSystemMessages: () => {},
        addSystem: (text: string) => {
          runnerInstructions = text;
        },
      },
    } as unknown as Parameters<CodeModeProcessor['processInputStep']>[0]);
    expect(processed.tools.android_screenshot).toBeDefined();
    expect(runnerInstructions).toContain('android_inspect');
    expect(runnerInstructions).not.toContain('android_screenshot');
    await expect(service.call(second, 'android_apps', {})).rejects.toThrow(
      'busy',
    );
    const gate = Promise.withResolvers<void>();
    hold = gate.promise;
    const cancelled = new AbortController();
    const pending = service.call(
      first,
      'android_inspect',
      {},
      cancelled.signal,
    );
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    cancelled.abort();
    const release = service.release(first.taskId, first.workerId);
    await expect(service.call(second, 'android_apps', {})).rejects.toThrow(
      'busy',
    );
    gate.resolve();
    await pending;
    await release;
    hold = undefined;
    await tools.android_apps!.execute!(
      {},
      {
        requestContext: new RequestContext([
          [PARENT_TASK_ID, 'two'],
          [WORKER_ID, 'two'],
        ]),
      },
    );
    fail = true;
    await expect(service.call(second, 'android_inspect', {})).rejects.toThrow(
      'Phone disconnected',
    );
    await service.release(second.taskId, second.workerId);
    fail = false;
    await service.call(first, 'android_apps', {});
    await service.release(first.taskId, first.workerId);
    const abort = new AbortController();
    abort.abort();
    const count = calls.length;
    await expect(
      service.call(first, 'android_apps', {}, abort.signal),
    ).rejects.toThrow();
    expect(calls).toHaveLength(count);
    // An aborted-before-dispatch operation did not acquire the phone.
    await service.call(second, 'android_apps', {});
    const dispatched = calls.length;
    loseResponse = true;
    await expect(
      service.call(second, 'android_tap', { ref: '@e1' }),
    ).rejects.toThrow('Android connection failed');
    expect(calls).toHaveLength(dispatched + 1);
    await service.call(second, 'android_inspect', {});
    expect(connections).toBe(2);
  } finally {
    await service.onApplicationShutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
