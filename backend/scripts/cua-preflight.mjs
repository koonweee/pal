import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const directory = new URL(
  '../../.local/cua-comparison/preflight/',
  import.meta.url,
);
await mkdir(directory, { recursive: true });
const client = new Client({ name: 'pal-cua-preflight', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: 'docker',
  args: [
    'exec',
    '-i',
    '-e',
    'CUA_DRIVER_RS_HOME=/tmp/pal-cua-comparison/state',
    '-e',
    'DO_NOT_TRACK=1',
    'pal-dev-split-execution-1',
    '/tmp/pal-cua-comparison/cua-driver',
    'mcp',
    '--socket',
    '/tmp/pal-cua-comparison/driver.sock',
  ],
  stderr: 'pipe',
});
const records = [];
const session = 'pal-cua-preflight-' + randomUUID();
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  await writeFile(
    new URL('tools.json', directory),
    JSON.stringify(tools, null, 2),
  );
  console.log(JSON.stringify({ tools: tools.map((t) => t.name) }));
  const windows = await client.callTool({
    name: 'list_windows',
    arguments: { app: 'Chromium' },
  });
  const window = windows.structuredContent?.windows?.[0];
  console.log(JSON.stringify({ window }));
  const calls = [
    ['start_session', { session }],
    ['get_desktop_state', {}],
  ];
  if (window)
    calls.push(
      [
        'get_window_state',
        {
          pid: window.pid,
          window_id: window.window_id,
          include_screenshot: false,
        },
      ],
      [
        'browser_prepare',
        {
          pid: window.pid,
          window_id: window.window_id,
          session,
          strategy: { kind: 'existing_profile' },
        },
      ],
      [
        'get_browser_state',
        { pid: window.pid, window_id: window.window_id, session },
      ],
    );
  for (const [name, args] of calls) {
    const started = performance.now();
    const result = await client.callTool({ name, arguments: args });
    const text = result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    const record = {
      name,
      milliseconds: performance.now() - started,
      isError: result.isError ?? false,
      images: result.content.filter((c) => c.type === 'image').length,
      text,
      structured: result.structuredContent,
    };
    records.push(record);
    console.log(JSON.stringify({ ...record, structured: undefined }));
    if (
      name === 'get_browser_state' &&
      args.pid &&
      result.structuredContent?.target_id
    ) {
      const binding = result.structuredContent;
      const tab = binding.tabs.find((t) => t.url === 'http://127.0.0.1:18765/');
      if (tab)
        calls.push([
          'get_browser_state',
          {
            session,
            target_id: binding.target_id,
            tab_id: tab.tab_id,
            snapshot_format: 'semantic_v2',
            include_screenshot: true,
          },
        ]);
    } else if (name === 'get_browser_state' && args.tab_id) {
      const snapshot = result.structuredContent;
      const field = snapshot?.refs?.find((r) => r.name === 'Reference');
      const button = snapshot?.refs?.find((r) => r.name === 'Save reference');
      const target = {
        session,
        target_id: args.target_id,
        tab_id: args.tab_id,
      };
      if (field && button)
        calls.push(
          [
            'browser_type',
            { ...target, ref: field.ref, text: 'pal-cua-proof', replace: true },
          ],
          ['browser_click', { ...target, ref: button.ref }],
          [
            'browser_click',
            { ...target, ref: button.ref, input_route: 'dom_event' },
          ],
          [
            'browser_click',
            { ...target, ref: button.ref, delivery_mode: 'foreground' },
          ],
        );
    }
  }
} finally {
  await client
    .callTool({ name: 'end_session', arguments: { session } })
    .catch(() => {});
  await client.close();
  await writeFile(
    new URL('results.json', directory),
    JSON.stringify(records, null, 2),
  );
}
