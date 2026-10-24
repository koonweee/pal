// Inspect role metadata in the existing service; no models or business tools run.
import assert from 'node:assert/strict';
import {
  readdirSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const endpoint = 'http://127.0.0.1:9229/json/list';
let existing;
try {
  existing = await fetch(endpoint, { signal: AbortSignal.timeout(500) });
} catch {}
assert(
  !existing?.ok,
  'An inspector is already open; refusing to take ownership',
);
const pid = readdirSync('/proc').find((entry) => {
  if (!/^\d+$/.test(entry) || Number(entry) === process.pid) return false;
  try {
    return readFileSync(`/proc/${entry}/cmdline`, 'utf8')
      .split('\0')
      .some((arg) => arg === 'dist/main.js' || arg === '/opt/pal/dist/main.js');
  } catch {
    return false;
  }
});
assert(pid, 'Running Pal service not found');
process.kill(Number(pid), 'SIGUSR1');
let targets;
for (let attempt = 0; attempt < 30 && !targets; attempt++) {
  try {
    targets = await (
      await fetch(endpoint, { signal: AbortSignal.timeout(500) })
    ).json();
  } catch {
    await delay(100);
  }
}
assert(targets?.[0], 'Service inspector did not start');
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const result = JSON.parse(data);
  if (result.id) {
    pending.get(result.id)?.(result);
    pending.delete(result.id);
  }
};
async function call(method, params) {
  const key = ++id;
  const timeout = AbortSignal.timeout(10000);
  const result = await new Promise((resolve, reject) => {
    pending.set(key, resolve);
    timeout.addEventListener(
      'abort',
      () => reject(Error('Inspector request timed out')),
      { once: true },
    );
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  if (result.error || result.result?.exceptionDetails)
    throw Error(
      result.result?.exceptionDetails?.exception?.description ??
        result.error?.message,
    );
  return result.result;
}
const directory = mkdtempSync('/tmp/pal-role-inspect-');
const bootstrap = directory + '/loader.cjs';
writeFileSync(
  bootstrap,
  `module.exports = Promise.all([import('/opt/pal/dist/agent/mastra-agent-runtime.js'),import('/opt/pal/node_modules/@mastra/core/dist/workspace/index.js'),import('/opt/pal/node_modules/@mastra/core/dist/request-context/index.js')]).then(([runtime,workspace,context])=>({prototype:runtime.MastraAgentRuntime.prototype,createWorkspaceTools:workspace.createWorkspaceTools,RequestContext:context.RequestContext}));`,
);
const load = `process.getBuiltinModule('module').createRequire('/opt/pal/package.json')(${JSON.stringify(bootstrap)})`;
try {
  const prototype = await call('Runtime.evaluate', {
    expression: `(async()=> (await ${load}).prototype)()`,
    awaitPromise: true,
  });
  const objects = await call('Runtime.queryObjects', {
    prototypeObjectId: prototype.result.objectId,
  });
  const inspected = await call('Runtime.callFunctionOn', {
    objectId: objects.objects.objectId,
    awaitPromise: true,
    returnByValue: true,
    functionDeclaration: `async function() {
      const r = this.find(runtime => runtime.main?.taskAgent && runtime.main?.worker);
      if (!r) throw Error('Pal runtime not found');
      const {createWorkspaceTools,RequestContext} = await ${load};
      const context = new RequestContext();
      const inspect = async agent => ({
        model: (await agent.getModel()).modelId,
        coreTools: Object.keys(await agent.listTools()).sort(),
        workspaceTools: Object.keys(await createWorkspaceTools(await agent.getWorkspace())).sort(),
        skills: (await agent.listSkills()).map(skill => skill.name),
        processors: (await agent.getConfiguredProcessorIds()).inputProcessorIds,
      });
      const delegation = (await r.main.taskAgent.getDefaultOptions({requestContext: context})).delegation;
      return {
        mainModel: (await r.main.agent.getModel()).modelId,
        taskEffort: r.config.get('PAL_AGENT_THINKING_EFFORT'),
        task: await inspect(r.main.taskAgent),
        interaction: await inspect(r.main.worker),
        inheritedMessages: (await delegation.messageFilter([{role:'user',content:'sentinel'}])).length,
        privateWorkerToolResults: delegation.includeSubAgentToolResultsInModelContext === false,
        activeTaskRuns: r.main.taskAgent.listActiveThreadRuns().length,
        pendingSecureEntry: (await r.login.repository.active()).length,
      };
    }`,
  });
  const result = inspected.result.value;
  assert.equal(result.task.model, 'gpt-6.1-sol');
  assert.equal(result.taskEffort, 'medium');
  assert.equal(result.interaction.model, 'gpt-6-luna');
  assert.equal(result.inheritedMessages, 0);
  assert(result.privateWorkerToolResults);
  assert(result.task.processors.includes('pal-task-tool-discovery'));
  assert.deepEqual(result.interaction.processors, ['pal-code-mode']);
  assert.deepEqual(result.task.skills, []);
  assert.deepEqual(result.interaction.skills, ['website-authentication']);
  assert(result.task.coreTools.includes('web_search'));
  assert(
    !result.task.coreTools.some((name) =>
      /^(browser|login_|secure_)/.test(name),
    ),
  );
  assert(result.task.workspaceTools.includes('mastra_workspace_read_file'));
  assert(
    result.task.workspaceTools.includes('mastra_workspace_execute_command'),
  );
  assert(
    !result.task.workspaceTools.some((name) =>
      name.startsWith('mastra_workspace_computer_'),
    ),
  );
  assert(result.interaction.coreTools.includes('browser'));
  assert(
    !result.interaction.coreTools.some((name) =>
      /^(web_search|read_preferences|inspect_message|agent-)/.test(name),
    ),
  );
  assert(result.interaction.workspaceTools.length > 0);
  assert(
    result.interaction.workspaceTools.every((name) =>
      name.startsWith('mastra_workspace_computer_'),
    ),
  );
  console.log(JSON.stringify({ verified: true, ...result }, null, 2));
} finally {
  await call('Runtime.evaluate', {
    expression:
      "setTimeout(()=>process.getBuiltinModule('inspector').close(),100);true",
    returnByValue: true,
  }).catch(() => {});
  ws.close();
  await delay(200);
  rmSync(directory, { recursive: true, force: true });
}
