import { MCPClient } from '/opt/pal/node_modules/@mastra/mcp/dist/index.js';
import { createTool } from '/opt/pal/node_modules/@mastra/core/dist/tools/index.js';
import { jsonSchema } from '/opt/pal/node_modules/ai/dist/index.mjs';
import { fileURLToPath } from 'node:url';
import { cuaModelOutput } from './cua-output.mjs';

export async function cuaTools(
  runtime,
  taskId,
  url,
  computerOnly,
  documentPid,
) {
  await runtime.execution.sandbox._start();
  const client = new MCPClient({
    id: 'bench-cua-' + taskId,
    registerProcessHooks: false,
    servers: {
      cua: {
        command: 'node',
        args: [
          fileURLToPath(new URL('./cua-transport.mjs', import.meta.url)),
          runtime.execution.sandbox.container.id,
        ],
      },
    },
  });
  const native = await client.listTools().catch(async (error) => {
    await client.disconnect();
    throw error;
  });
  const sessions = new Map();
  const opened = new Set();
  const invoke = (name, args, context) =>
    native['cua_' + name].execute(args, context);
  async function binding(context) {
    const workerId = context?.requestContext?.get('palWorkerId');
    if (!workerId) throw Error('Cua requires a trusted worker identity');
    if (!sessions.has(workerId))
      sessions.set(
        workerId,
        (async () => {
          let page = await runtime.browser
            .selectedPage(taskId, workerId)
            .catch(() => null);
          if (!page || new URL(page.url()).origin !== new URL(url).origin) {
            const ownedUrl = new URL(url);
            ownedUrl.searchParams.set('_worker', workerId);
            await runtime.browser.command(
              taskId,
              ['tab', 'new', ownedUrl.href],
              context.abortSignal,
              workerId,
            );
            page = await runtime.browser.selectedPage(taskId, workerId);
          }
          const session = 'bench-' + workerId;
          await invoke('start_session', { session }, context);
          opened.add(session);
          const windows = await invoke(
            'list_windows',
            { app: 'Chromium', session },
            context,
          );
          if (windows.windows.length !== 1)
            throw Error('Expected one benchmark Chromium window');
          const { pid, window_id } = windows.windows[0];
          await invoke(
            'browser_prepare',
            { pid, window_id, session, strategy: { kind: 'existing_profile' } },
            context,
          );
          const result = await invoke(
            'get_browser_state',
            { pid, window_id, session },
            context,
          );
          const matches = result.tabs?.filter((t) => t.url === page.url());
          if (result.binding_quality !== 'exact' || matches?.length !== 1)
            throw Error('Cua did not resolve exactly the owned fixture tab');
          if (computerOnly) await page.bringToFront();
          let document;
          if (documentPid) {
            const windows = await invoke('list_windows', { session }, context);
            const matches = windows.windows.filter(
              (w) => w.pid === documentPid,
            );
            if (matches.length !== 1)
              throw Error('Expected one owned document window');
            document = { pid: documentPid, window_id: matches[0].window_id };
          }
          return {
            session,
            target_id: result.target_id,
            tab_id: matches[0].tab_id,
            pid,
            window_id,
            document,
          };
        })(),
      );
    return sessions.get(workerId);
  }
  const browserNames = [
    'get_browser_state',
    'browser_navigate',
    'browser_click',
    'browser_type',
    'browser_select',
    'browser_pointer',
    'browser_dialog',
    'browser_set_input_files',
  ];
  const desktopNames = [
    'get_desktop_state',
    'get_window_state',
    'click',
    'double_click',
    'right_click',
    'type_text',
    'press_key',
    'hotkey',
    'scroll',
    'drag',
  ];
  const definitions = await client
    .listToolDefinitions()
    .catch(async (error) => {
      await client.disconnect();
      throw error;
    });
  // Schema inspection is kept explicit to fail closed on dependency API changes.
  const all = Object.values(definitions).flatMap((v) =>
    Array.isArray(v) ? v : Object.values(v),
  );
  const tools = {};
  for (const name of computerOnly
    ? desktopNames
    : documentPid
      ? [...browserNames, ...desktopNames]
      : browserNames) {
    const source = native['cua_' + name];
    const definition = all.find(
      (d) => d?.name === name || d?.name === 'cua_' + name,
    );
    const schema = definition?.inputSchema;
    if (!schema) {
      await client.disconnect();
      throw Error(
        'Missing Cua input schema: ' +
          name +
          ' catalog=' +
          JSON.stringify(definitions).slice(0, 300),
      );
    }
    const hidden = new Set([
      'session',
      'target_id',
      'tab_id',
      'pid',
      'window_id',
      'target',
      'delivery_mode',
      'input_route',
      'screenshot_out_file',
    ]);
    const desktop = desktopNames.includes(name) && name !== 'get_desktop_state';
    tools['cua_' + name] = createTool({
      id: 'cua_' + name,
      description:
        source.description +
        '\nPal supplies the owned session, window and tab. Use only this fixture.',
      inputSchema: jsonSchema({
        ...schema,
        properties: {
          ...Object.fromEntries(
            Object.entries(schema.properties ?? {}).filter(
              ([key]) => !hidden.has(key),
            ),
          ),
          ...(documentPid && desktop
            ? {
                application: {
                  type: 'string',
                  enum: ['browser', 'document'],
                  description: 'Owned application to observe or operate.',
                },
              }
            : {}),
        },
        required: (schema.required ?? []).filter((key) => !hidden.has(key)),
        additionalProperties: false,
      }),
      execute: async (args, context) => {
        const target = await binding(context);
        const { application, ...nativeArgs } = args;
        const window = application === 'document' ? target.document : target;
        if (
          name === 'browser_navigate' &&
          new URL(args.url).origin !== new URL(url).origin
        )
          throw Error('Navigation outside benchmark fixture');
        const injected =
          name.startsWith('browser_') || name === 'get_browser_state'
            ? {
                session: target.session,
                target_id: target.target_id,
                tab_id: target.tab_id,
              }
            : {
                session: target.session,
                ...(name === 'get_desktop_state'
                  ? {}
                  : { pid: window.pid, window_id: window.window_id }),
              };
        return invoke(
          name,
          {
            ...nativeArgs,
            ...injected,
            ...([
              'browser_click',
              'browser_pointer',
              'browser_dialog',
              'click',
              'double_click',
              'right_click',
              'type_text',
              'press_key',
              'hotkey',
              'scroll',
              'drag',
            ].includes(name)
              ? { delivery_mode: 'foreground' }
              : {}),
            ...(name === 'get_browser_state'
              ? { snapshot_format: 'semantic_v2' }
              : {}),
          },
          context,
        );
      },
      toModelOutput: cuaModelOutput,
    });
  }
  return {
    tools,
    ensure: binding,
    close: async () => {
      await Promise.allSettled(sessions.values());
      for (const session of opened)
        await invoke('end_session', { session }).catch(() => {});
      await client.disconnect();
    },
  };
}
