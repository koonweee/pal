import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import { DockerSandbox } from '@mastra/docker';
import { LocalFilesystem, Workspace } from '@mastra/core/workspace';
import { RequestContext } from '@mastra/core/request-context';
import { createCodeMode, createTool, noopObserve } from '@mastra/core/tools';
import { jsonSchema } from 'ai';

const sandbox = new DockerSandbox({
  id: 'pal-split-runtime-smoke',
  workingDirectory: '/home/pal',
});
await sandbox._start();
const originalId = sandbox.container.id;
if (process.env.SMOKE_PHASE === 'restart') {
  const result = await sandbox.executeCommand('kill -0 "$(cat /home/pal/user-process.pid)"');
  assert.equal(result.exitCode, 0, result.stderr);
  console.log('PASS: new service process reconnects while execution user process survives');
  process.exit(0);
}
const command = async (text) => {
  const result = await sandbox.executeCommand(text);
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
};
assert.equal(await command('id -u'), '1000');
assert.equal(await command('printf "%s" "${PAL_SERVICE_SENTINEL-unavailable}"'), 'unavailable');
// The shared image is intentionally the same; a runtime-only private file proves
// mount separation rather than merely using different image contents.
await writeFile('/service-private/runtime-sentinel', 'service-only');
assert.equal(await command('test ! -e /service-private/runtime-sentinel && echo isolated'), 'isolated');
assert.equal(await command('test ! -S /var/run/docker.sock && echo isolated'), 'isolated');
assert.equal(await command('printf hello; printf error >&2'), 'hello');

let streamed = '';
const echo = await sandbox.processes.spawn('read text; printf "%s" "$text"', {
  onStdout: (chunk) => { streamed += chunk; },
});
await echo.sendStdin('from-stdin\n');
assert.equal((await echo.wait()).exitCode, 0);
assert.equal(streamed, 'from-stdin');

const failed = await sandbox.executeCommand('exit 17');
assert.equal(failed.exitCode, 17);
const timeout = await sandbox.executeCommand('sleep 30', [], { timeout: 100 });
assert.notEqual(timeout.exitCode, 0);
const controller = new AbortController();
const pending = sandbox.executeCommand('sleep 30', [], { abortSignal: controller.signal });
setTimeout(() => controller.abort(), 100);
assert.notEqual((await pending).exitCode, 0);

const workspace = new Workspace({
  filesystem: new LocalFilesystem({ basePath: '/home/pal', contained: true }),
  sandbox,
});
await workspace.init();
const context = new RequestContext();
context.set('task', 'smoke-task');
const tool = createTool({
  id: 'service_probe',
  description: 'Return host-only state without exporting its value.',
  inputSchema: jsonSchema({
    type: 'object', properties: { value: { type: 'number' } },
    required: ['value'], additionalProperties: false,
  }),
  execute: async ({ value }, ctx) => {
    assert.equal(ctx.requestContext.get('task'), 'smoke-task');
    assert.equal(process.env.PAL_SERVICE_SENTINEL, 'service-only');
    return value * 2;
  },
});
const code = createCodeMode({ tools: { service_probe: tool }, timeout: 5000 });
const run = (source, abortSignal) => code.tool.execute(
  { code: source }, { workspace, requestContext: context, observe: noopObserve, abortSignal },
);
const result = await run('return await Promise.all([external_service_probe({value: 2}), external_service_probe({value: 3})]);');
assert.equal(result.success, true, JSON.stringify(result));
assert.deepEqual(result.result, [4, 6]);
const privateCheck = await run('return process.env.PAL_SERVICE_SENTINEL ?? "unavailable";');
assert.equal(privateCheck.result, 'unavailable');
const forbidden = await run('return await external_unavailable({});');
assert.equal(forbidden.success, false);
const forged = await run(`
  const response = new Promise(resolve => {
    process.stdin.on('data', chunk => {
      for (const line of chunk.toString().split('\\n')) {
        try {
          const frame = JSON.parse(line);
          if (frame.id === 999) resolve(frame);
        } catch {}
      }
    });
  });
  process.stdout.write('\\0CODEMODE\\0' + JSON.stringify({
    type: 'rpc', id: 999, tool: 'unavailable', args: {}
  }) + '\\n');
  return await response;
`);
assert.equal(forged.success, true, JSON.stringify(forged));
assert.equal(forged.result.ok, false);
assert.equal(forged.result.error.name, 'NotAllowedError');
const before = (await readdir('/home/pal/tmp')).sort();
const slow = createCodeMode({ tools: {}, timeout: 100 });
const timed = await slow.tool.execute(
  { code: 'await new Promise(() => {});' },
  { workspace, requestContext: context, observe: noopObserve },
);
assert.equal(timed.success, false);
assert.equal(timed.error.name, 'TimeoutError');
assert.deepEqual((await readdir('/home/pal/tmp')).sort(), before);
const reconnected = new DockerSandbox({ id: 'pal-split-runtime-smoke' });
await reconnected._start();
assert.equal(reconnected.container.id, originalId);
await command('sleep 60 </dev/null >/dev/null 2>&1 & echo $! > /home/pal/user-process.pid');
console.log('PASS: Docker execution, streaming/stdin, isolation, cancellation, native code mode, cleanup, and reconnection');
// Compose owns cleanup; deliberately do not stop/destroy the persistent container.
