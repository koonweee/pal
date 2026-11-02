import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  allVariants as variants,
  cases,
  history,
  schedule,
  score,
  supportBrief,
} from './cases.mjs';
import { installFixture, initialState } from './fixtures.mjs';
import { cuaTools } from './cua.mjs';
import { privateFixture } from './driver-private.mjs';
import { exposesDriverSecret, recordRecoveryStep } from './driver-cases.mjs';
import { trace, toolTiming } from './trace.mjs';
import { Agent } from '/opt/pal/node_modules/@mastra/core/dist/agent/index.js';
import { Mastra } from '/opt/pal/node_modules/@mastra/core/dist/mastra/index.js';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '/opt/pal/node_modules/@mastra/core/dist/request-context/index.js';
import {
  Workspace,
  WORKSPACE_TOOLS,
} from '/opt/pal/node_modules/@mastra/core/dist/workspace/index.js';
import {
  taskToolAllowed,
  delegationGuidance,
  validBoundaries,
} from './delegation.mjs';
import { Memory } from '/opt/pal/node_modules/@mastra/memory/dist/index.js';
import { MastraAgentRuntime } from '/opt/pal/dist/agent/mastra-agent-runtime.js';
import { chatgptModel } from '/opt/pal/dist/agent/chatgpt-model.js';
import { loadAgentInstructions } from '/opt/pal/dist/agent/agent-instructions.js';
import { agentSkillPaths } from '/opt/pal/dist/agent/agent-skills.js';
import { taskWorkerDelegation } from '/opt/pal/dist/agent/task-workers.js';
import { TaskToolDiscoveryProcessor } from '/opt/pal/dist/agent/task-tool-discovery.processor.js';
import { publicOutputOptions } from '/opt/pal/dist/agent/public-output.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
export const prototype = MastraAgentRuntime.prototype;
const scope = (globalThis.__palBrowserBenchmark = {
  runtime: null,
  abort: null,
  active: false,
});
const settings = JSON.parse(readFileSync(directory + '/config.json', 'utf8'));
const telemetry = trace(directory + '/trace.jsonl');
const emit = telemetry.emit;
const sharedFile = (name) =>
  readFileSync(`/opt/pal/dist/agent/instructions/${name}.md`, 'utf8');
const withoutSection = (text, title) =>
  text.replace(new RegExp(`## ${title}\\n[\\s\\S]*?(?=\\n## |$)`, 'g'), '');
const model = (name, effort) =>
  chatgptModel(
    name,
    scope.runtime.config.getOrThrow('PAL_AGENT_AUTH_PATH'),
    effort,
  );
const options = (sample, role) => ({
  maxSteps: 0,
  stopWhen: () => false,
  modelSettings: {
    maxRetries: 1,
    timeout: { firstChunkMs: 120000, stepMs: 300000 },
    headers: { 'session-id': `pal-browser-bench:${sample}:${role}` },
  },
});
const busy = () =>
  scope.runtime.main.session.stream.isActive() ||
  scope.runtime.main.taskAgent.listActiveThreadRuns().length ||
  scope.runtime.taskRuns.size;
const plain = (value) => {
  try {
    const data = JSON.parse(value);
    return Array.isArray(data.text)
      ? data.text.join('\n')
      : (data.text ?? value);
  } catch {
    return value;
  }
};
function result(row) {
  appendFileSync(directory + '/results.jsonl', JSON.stringify(row) + '\n', {
    mode: 0o600,
  });
  emit('sample.end', {
    sample: row.sample,
    key: row.key,
    success: row.success,
    status: row.status,
    elapsedMs: row.elapsedMs,
  });
}

scope.preflight = async () => {
  if (busy()) throw Error('Dev agent is busy; wait until idle');
  const availability = [];
  for (const variant of variants.filter((v) =>
    settings.variants.includes(v.id),
  )) {
    const sample = 'preflight-' + variant.id;
    const agent = new Agent({
      id: sample,
      name: 'Availability probe',
      instructions: 'Reply with OK.',
      model: model(variant.model, variant.effort),
      defaultOptions: options(sample, 'probe'),
    });
    try {
      const output = await agent.stream('Reply with OK.', {
        ...options(sample, 'probe'),
        abortSignal: AbortSignal.timeout(60000),
      });
      for await (const _chunk of output.fullStream) {
        /* consume the OAuth streaming endpoint */
      }
      availability.push({
        ...variant,
        supported: /OK/.test(await output.text),
      });
    } catch (error) {
      availability.push({
        ...variant,
        supported: false,
        error: error.name,
        status: error.statusCode,
        message: String(error.message).slice(0, 300),
      });
    }
    emit('availability', availability.at(-1));
  }
  writeFileSync(
    directory + '/availability.json',
    JSON.stringify(availability, null, 2),
  );
  return availability;
};

scope.run = async () => {
  if (scope.active || busy()) throw Error('Dev agent is busy; wait until idle');
  scope.active = true;
  const r = scope.runtime;
  const supported = JSON.parse(
    readFileSync(directory + '/availability.json', 'utf8'),
  );
  const jobs = schedule(
    variants.filter((v) => settings.variants.includes(v.id)),
    settings.cases.map((id) => cases.find((c) => c.id === id)),
    settings.contexts,
    settings.repetitions,
    settings.round_offset ?? 0,
  );
  const completed = new Set();
  try {
    for (const line of readFileSync(directory + '/results.jsonl', 'utf8')
      .trim()
      .split('\n'))
      if (line) completed.add(JSON.parse(line).key);
  } catch {}
  try {
    for (const job of jobs) {
      if (completed.has(job.key)) continue;
      if (busy())
        throw Error('Normal dev work started; stop benchmark and resume later');
      if (!supported.find((v) => v.id === job.variant.id)?.supported) {
        result({
          key: job.key,
          variant: job.variant.id,
          case: job.scenario.id,
          context: job.context,
          round: job.round,
          status: 'unsupported',
          success: null,
        });
        continue;
      }
      const sample = randomUUID(),
        startedSetup = Date.now();
      const { scenario, variant, context } = job;
      let fixture,
        task,
        timer,
        agent,
        answer = '',
        status = 'completed',
        errorType,
        start,
        end;
      const liveState = initialState(),
        workerIds = new Set();
      let originalCommand,
        briefPath,
        cua,
        privateEntry,
        documentProcess,
        documentPid,
        documentPath;
      const workerOutputs = [];
      let activeWorkers = 0;
      let cleanupFailed = false;
      const row = {
        sample,
        key: job.key,
        variant: variant.id,
        case: scenario.id,
        kind: scenario.kind,
        context,
        round: job.round,
        taskModel: 'gpt-6.1-sol',
        taskEffort: 'medium',
        workerModel: variant.delegated ? variant.model : null,
        workerEffort: variant.delegated ? variant.effort : null,
        ...(variant.boundary
          ? {
              delegationBoundary: variant.boundary,
              ...(variant.boundary === 'interaction-mcp'
                ? {
                    generalWorkerAvailable: false,
                    mcpOwner: 'worker',
                    mcpToolCount: Object.keys(r.mcp.tools()).length,
                  }
                : {}),
              generalModel:
                variant.boundary === 'interaction-mcp'
                  ? null
                  : (variant.generalModel ?? 'gpt-6.1-sol'),
              generalEffort:
                variant.boundary === 'interaction-mcp'
                  ? null
                  : (variant.generalEffort ?? 'medium'),
            }
          : {}),
      };
      try {
        task = await r.tasks.create({
          title: `Benchmark ${job.key}`,
          goal: scenario.prompt,
          description: scenario.constraints,
        });
        row.taskId = task.id;
        emit('owned.task', { sample, taskId: task.id });
        const thread = 'pal-task:' + task.id;
        const requestContext = new RequestContext([
          [MASTRA_THREAD_ID_KEY, thread],
          [MASTRA_RESOURCE_ID_KEY, 'pal-owner'],
        ]);
        if (scenario.kind === 'synthetic')
          fixture = await installFixture(
            r.browser,
            scenario,
            sample.slice(0, 8),
          );
        if (fixture)
          emit('owned.fixture', {
            sample,
            origin: fixture.origin,
            accountId: fixture.accountId,
          });
        const url = fixture?.url ?? scenario.url;
        if (
          scenario.driverCase &&
          ['driver-auth', 'driver-payment', 'driver-resume'].includes(
            scenario.id,
          )
        )
          privateEntry = await privateFixture(r, task, fixture, scenario);
        if (scenario.id === 'driver-form') {
          briefPath = `/home/pal/tmp/pal-cua-${sample}-diagnostic.txt`;
          await r.main.workspace.filesystem.writeFile(
            briefPath,
            'Diagnostic E42: export failed.',
          );
        }
        if (scenario.desktopDocument) {
          documentPath = `/home/pal/tmp/pal-cua-${sample}-document.txt`;
          await r.main.workspace.filesystem.writeFile(
            documentPath,
            'Document reference: DOC-739\nDocument amount: 83.27\n',
          );
          documentProcess = await r.execution.sandbox.processes.spawn(
            `mousepad --disable-server '${documentPath}'`,
            { timeout: 900000 },
          );
          await new Promise((resolve) => setTimeout(resolve, 700));
          const pids = (
            await r.execution.output('pgrep', [
              '-f',
              '^mousepad --disable-server ' + documentPath,
            ])
          )
            .toString()
            .trim()
            .split(/\s+/);
          if (pids.length !== 1)
            throw Error('Expected one owned document process');
          documentPid = Number(pids[0]);
        }
        if (scenario.attachment) {
          briefPath = `/home/pal/tmp/pal-bench-${sample}-brief.txt`;
          await r.main.workspace.filesystem.writeFile(briefPath, supportBrief);
          emit('owned.file', { sample, path: briefPath });
        }
        originalCommand = r.browser.command;
        // Only this benchmark task is intercepted. Synthetic navigation uses an
        // adopted blank target so routing is installed before its first request.
        r.browser.command = async function (taskId, args, signal, workerId) {
          let output;
          if (
            taskId === task.id &&
            fixture &&
            args[0] === 'tab' &&
            args[1] === 'new' &&
            args[2]?.startsWith(fixture.origin)
          ) {
            output = await originalCommand.call(
              this,
              taskId,
              ['tab', 'new', 'about:blank'],
              signal,
              workerId,
            );
            if (output.success) {
              const selected = await this.selectedPage(taskId, workerId);
              await selected.goto(args[2], {
                waitUntil: 'domcontentloaded',
                timeout: 15000,
              });
              output.data.url = selected.url();
            }
          } else
            output = await originalCommand.call(
              this,
              taskId,
              args,
              signal,
              workerId,
            );
          // Agent-browser creates targets through a separate CDP connection.
          // Adopt the owned target explicitly; generic context events can miss it.
          // tab list is excluded because selectedPage uses it internally.
          if (
            taskId === task.id &&
            scenario.kind === 'live' &&
            !liveState.evidence &&
            args[0] !== 'close' &&
            !(args[0] === 'tab' && ['list', 'close'].includes(args[1]))
          ) {
            const captureStart = Date.now();
            try {
              const selected = await this.selectedPage(taskId, workerId);
              if (selected.url().startsWith(scenario.url)) {
                liveState.pages.push(selected.url());
                const body = await selected
                  .locator('body')
                  .innerText({ timeout: 2000 });
                if (body.length > (liveState.evidence?.length ?? 0)) {
                  liveState.evidence = body.slice(0, 100000);
                  liveState.evidenceAt = Date.now();
                }
              }
            } catch {
              /* Missing evidence remains visible to the reviewer. */
            }
            emit('evidence.capture', { sample, ms: Date.now() - captureStart });
          }
          return output;
        };
        if (scenario.computer && variant.driver !== 'cua') {
          await r.browser.command(task.id, ['tab', 'new', url]);
          await (await r.browser.selectedPage(task.id)).bringToFront();
        }
        const baseTools = await r.main.taskAgent.listTools({ requestContext });
        const workerTools = await r.main.worker.listTools({ requestContext });
        let interactionTools = Object.fromEntries(
          Object.entries(workerTools).filter(([name]) =>
            /^(browser|inspect_private_fields|enter_private_fields|confirm_authentication)/.test(
              name,
            ),
          ),
        );
        if (privateEntry)
          interactionTools = {
            ...Object.fromEntries(
              Object.entries(interactionTools).filter(
                ([name]) =>
                  !/^(inspect_private_fields|enter_private_fields|confirm_authentication)/.test(
                    name,
                  ),
              ),
            ),
            ...privateEntry.tools,
          };
        if (variant.driver === 'cua') {
          cua = await cuaTools(r, task.id, url, scenario.computer, documentPid);
          interactionTools = {
            ...Object.fromEntries(
              Object.entries(interactionTools).filter(([name]) =>
                /^(inspect_private_fields|enter_private_fields|confirm_authentication)/.test(
                  name,
                ),
              ),
            ),
            ...cua.tools,
          };
          for (const [name, tool] of Object.entries(interactionTools)) {
            if (
              !/^(inspect_private_fields|enter_private_fields|confirm_authentication)/.test(
                name,
              )
            )
              continue;
            const execute = tool.execute.bind(tool);
            interactionTools[name] = Object.assign(
              Object.create(Object.getPrototypeOf(tool)),
              tool,
              {
                execute: async (args, context) => {
                  await cua.ensure(context);
                  return execute(args, context);
                },
              },
            );
          }
        }
        if (scenario.driverCase)
          for (const [name, tool] of Object.entries(interactionTools)) {
            const execute = tool.execute.bind(tool);
            interactionTools[name] = Object.assign(
              Object.create(Object.getPrototypeOf(tool)),
              tool,
              {
                execute: async (args, context) => {
                  const workerId = context.requestContext.get('palWorkerId');
                  const observation =
                    name === 'browser_screenshot' ||
                    name === 'cua_get_browser_state' ||
                    (name === 'browser' &&
                      ['snapshot', 'eval', 'get', 'screenshot'].includes(
                        args.args?.[0],
                      ));
                  const page =
                    scenario.concurrent ||
                    (observation &&
                      (privateEntry || scenario.id === 'driver-recovery'))
                      ? await r.browser
                          .selectedPage(task.id, workerId)
                          .catch(() => null)
                      : null;
                  if (page && scenario.concurrent)
                    fixture.owners.set(page, workerId);
                  if (privateEntry && observation && page) {
                    for (const frame of page.frames()) {
                      const populated = await frame
                        .evaluate(() =>
                          Array.from(document.querySelectorAll('input')).some(
                            (input) =>
                              input.value &&
                              /^(username|password|digit[0-5]|number|securityCode)$/.test(
                                input.name,
                              ),
                          ),
                        )
                        .catch(() => false);
                      if (populated) fixture.state.unmaskedObservation = true;
                    }
                  }
                  const result = await execute(args, context);
                  const recoveryAction =
                    scenario.id === 'driver-recovery' &&
                    (name === 'cua_browser_click' ||
                      (name === 'browser' && args.args?.[0] === 'click'));
                  if (
                    recoveryAction &&
                    fixture.state.pages.includes('/recover-next')
                  ) {
                    const deadline = Date.now() + 500;
                    while (!fixture.state.submissions && Date.now() < deadline)
                      await new Promise((resolve) => setTimeout(resolve, 10));
                  }
                  if (scenario.concurrent) {
                    const owned = await r.browser
                      .selectedPage(task.id, workerId)
                      .catch(() => null);
                    if (owned) fixture.owners.set(owned, workerId);
                  }
                  if (exposesDriverSecret(result))
                    fixture.state.secretExposed = true;
                  if (
                    scenario.id === 'driver-recovery' &&
                    recordRecoveryStep(fixture.state, {
                      action: recoveryAction,
                      observation,
                      url: page?.url(),
                    })
                  ) {
                    throw Error(
                      'Synthetic action timeout: acknowledgement lost. The action may have completed. Inspect current state before retrying.',
                    );
                  }
                  return result;
                },
              },
            );
          }
        let taskTools = variant.delegated
          ? Object.fromEntries(
              Object.entries(baseTools).filter(
                ([name]) =>
                  !/^(browser|inspect_private_fields|enter_private_fields|confirm_authentication|web_search)/.test(
                    name,
                  ),
              ),
            )
          : baseTools;
        let taskInstructions = await r.main.taskAgent.getInstructions({
          requestContext,
        });
        if (typeof taskInstructions !== 'string')
          throw Error('Unexpected Task instruction format');
        if (variant.delegated) {
          taskInstructions =
            ['voice', 'texting', 'files', 'preferences', 'preference-learning']
              .map(sharedFile)
              .join('\n') +
            '\n' +
            withoutSection(
              withoutSection(sharedFile('task'), 'Browser'),
              'Workers',
            ) +
            '\n## Interaction delegation\nDelegate all browser, desktop, website authentication and page verification to agent-worker. Supply a compact complete assignment containing the URL, relevant prior constraints, requested interaction method and required evidence. The worker receives only your assignment, never your conversation history. Own planning, user communication and synthesis. You have no browser, computer, shell or website-authentication tools. Do not perform interaction through other services. Keep necessary work in the worker until complete.';
        }
        let taskWorkspace, generalWorkspace, interactionWorkspace;
        const interactionMcp = variant.boundary === 'interaction-mcp';
        const isolatedBoundary = variant.boundary;
        const cleanExecution = withoutSection(
          withoutSection(sharedFile('execution'), 'Secure browser entry'),
          'Choosing an interaction method',
        );
        if (isolatedBoundary) {
          taskTools = Object.fromEntries(
            Object.entries(baseTools).filter(([name]) =>
              taskToolAllowed(isolatedBoundary, name),
            ),
          );
          taskInstructions =
            ['voice', 'texting', 'files', 'preferences', 'preference-learning']
              .map(sharedFile)
              .join('\n') +
            '\n' +
            withoutSection(
              withoutSection(sharedFile('task'), 'Browser'),
              'Workers',
            ) +
            '\n' +
            (isolatedBoundary === 'coordinator' ? '' : cleanExecution) +
            delegationGuidance(variant);
          const noComputerTools = Object.fromEntries(
            Object.values(WORKSPACE_TOOLS.COMPUTER).map((name) => [
              name,
              { enabled: false },
            ]),
          );
          if (!interactionMcp)
            generalWorkspace = new Workspace({
              id: 'bench-general-workspace-' + sample,
              filesystem: r.main.workspace.filesystem,
              sandbox: r.main.workspace.sandbox,
              tools: { requireApproval: false, ...noComputerTools },
            });
          if (isolatedBoundary !== 'coordinator')
            taskWorkspace = new Workspace({
              id: 'bench-task-workspace-' + sample,
              filesystem: r.main.workspace.filesystem,
              ...(['execution', 'interaction-mcp'].includes(isolatedBoundary)
                ? { sandbox: r.main.workspace.sandbox }
                : {}),
              tools:
                isolatedBoundary === 'services'
                  ? {
                      enabled: false,
                      requireApproval: false,
                      [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: { enabled: true },
                    }
                  : { requireApproval: false, ...noComputerTools },
            });
        }
        if (interactionMcp || variant.driver)
          interactionWorkspace = new Workspace({
            id: 'bench-interaction-workspace-' + sample,
            filesystem: r.main.workspace.filesystem,
            sandbox: r.main.workspace.sandbox,
            tools: {
              enabled: false,
              requireApproval: false,
              ...Object.fromEntries(
                Object.values(WORKSPACE_TOOLS.COMPUTER).map((name) => [
                  name,
                  { enabled: variant.driver !== 'cua' },
                ]),
              ),
            },
          });
        // Reuse production code mode, but Task has no connected-service catalog in this arm.
        const taskDiscovery = new TaskToolDiscoveryProcessor(() =>
          interactionMcp ? {} : r.mcp.tools(),
        );
        const taskDiscoveryProcessor = interactionMcp
          ? {
              id: 'bench-task-local-code',
              async processInputStep(args) {
                const result = await taskDiscovery.processInputStep(args);
                delete result.tools.search_tools;
                return result;
              },
            }
          : taskDiscovery;
        // Browser-only tasks explicitly exercise the UI; APIs/search would measure a different workflow.
        const benchmarkGuidance =
          '\nFor this benchmark the user requests browser UI interaction (or screenshot/computer interaction when explicitly specified). Use visible page content and UI controls. Do not bypass the UI with fetch, hidden APIs, source-code inspection or direct network/shell requests. DOM inspection and normal browser actions are allowed for browser cases. Do not interact with unrelated tabs or real accounts. Return evidence and state uncertainty honestly.';
        const memory = new Memory({
          storage: r.main.storage,
          options: {
            lastMessages: 200,
            semanticRecall: false,
            workingMemory: { enabled: false },
          },
        });
        let worker, general, delegation;
        if (variant.delegated) {
          worker = new Agent({
            id: 'bench-worker-' + sample,
            name: 'Interaction worker',
            description: interactionMcp
              ? 'Complete browser/computer or connected-service/MCP operations and return verified findings. Supply all relevant facts and constraints; local file processing belongs to Task.'
              : 'Complete a browser/computer operation and return verified findings. Supply the full compact assignment and necessary constraints.',
            instructions:
              (interactionMcp
                ? sharedFile('voice') +
                  '\n' +
                  withoutSection(
                    withoutSection(sharedFile('worker'), 'Files'),
                    'Preferences',
                  ) +
                  '\n' +
                  withoutSection(
                    withoutSection(sharedFile('execution'), 'File processing'),
                    'Public web research',
                  ) +
                  '\n' +
                  r.mcp.instructions() +
                  '\nUse MCP discovery and code mode for connected services. You have no shell, file-processing, public web-search or preference tools. Return local file processing to Task; use facts supplied in your assignment. Code mode combines your available tools; do not use it for shell or filesystem access.'
                : await loadAgentInstructions('worker')) +
              benchmarkGuidance +
              (variant.driver === 'cua'
                ? '\nUse cua_* tools for interaction. Pal binds your owned fixture tab and session automatically; begin with cua_get_browser_state (browser tasks) or cua_get_desktop_state (computer tasks). For browser state, the semantic outline and refs are in the returned JSON. Reinspect after navigation or stale refs. Pal supplies foreground delivery for trusted actions on this dedicated test desktop. Use inspect_private_fields and enter_private_fields for private credentials. Do not use ordinary Cua observation on populated secret fields. Return results to Task.'
                : ''),
            model: model(variant.model, variant.effort),
            memory,
            skills: agentSkillPaths('worker'),
            tools: interactionMcp
              ? interactionTools
              : isolatedBoundary
                ? {
                    ...interactionTools,
                    web_search: baseTools.web_search,
                    read_preferences: baseTools.read_preferences,
                    inspect_message: baseTools.inspect_message,
                  }
                : interactionTools,
            workspace: interactionWorkspace ?? r.main.workspace,
            inputProcessors: [
              ...(isolatedBoundary
                ? [new TaskToolDiscoveryProcessor(() => r.mcp.tools())]
                : []),
              toolTiming(emit, sample, 'worker'),
            ],
            defaultOptions: options(sample, 'worker'),
          });
          if (isolatedBoundary && !interactionMcp)
            general = new Agent({
              id: 'bench-general-' + sample,
              name: 'General worker',
              description:
                'Non-interaction research and file processing. No browser, computer or login tools. Supply the complete assignment and file paths.',
              instructions:
                ['voice', 'files', 'preferences'].map(sharedFile).join('\n') +
                '\n' +
                cleanExecution +
                '\nComplete non-interaction assignments and return findings, sources and output paths to the parent. Do not operate websites, browsers, computer or login flows. Return proposed interaction work to the parent for its interaction worker.' +
                benchmarkGuidance,
              model: model(
                variant.generalModel ?? 'gpt-6.1-sol',
                variant.generalEffort ?? 'medium',
              ),
              memory,
              workspace: generalWorkspace,
              tools: {
                web_search: baseTools.web_search,
                read_preferences: baseTools.read_preferences,
                inspect_message: baseTools.inspect_message,
              },
              inputProcessors: [
                new TaskToolDiscoveryProcessor(() => r.mcp.tools()),
                toolTiming(emit, sample, 'general'),
              ],
              defaultOptions: options(sample, 'general'),
            });
          const hooks = taskWorkerDelegation(
            async (_taskId, workerId) => {
              workerIds.add(workerId);
            },
            privateEntry
              ? (taskId, assignment) =>
                  privateEntry.service.resumeWorker(taskId, assignment)
              : undefined,
          );
          delegation = {
            ...hooks,
            messageFilter: () => [],
            includeSubAgentToolResultsInModelContext: false,
            onDelegationStart: async (c) => {
              const value = await hooks.onDelegationStart(c);
              activeWorkers++;
              if (scenario.concurrent && activeWorkers > 1)
                fixture.state.concurrentOverlap = true;
              const workerId = c.requestContext.get('palWorkerId');
              workerIds.add(workerId);
              emit('delegation.start', {
                sample,
                workerId,
                promptCharacters: c.prompt.length,
                inheritedMessages: 0,
              });
              return { ...value, modifiedMaxSteps: 0 };
            },
            onDelegationComplete: async (c) => {
              activeWorkers--;
              workerOutputs.push(
                typeof c.result === 'string'
                  ? c.result
                  : (c.result?.text ?? ''),
              );
              emit('delegation.end', {
                sample,
                ms: c.duration,
                success: c.success,
              });
              return hooks.onDelegationComplete(c);
            },
          };
        }
        agent = new Agent({
          id: 'bench-task-' + sample,
          name: 'Task',
          model: model('gpt-6.1-sol', 'medium'),
          instructions: taskInstructions + benchmarkGuidance,
          tools: taskTools,
          skills: variant.delegated ? [] : agentSkillPaths('task'),
          memory,
          ...(variant.delegated
            ? {
                agents: { worker, ...(general ? { general } : {}) },
                ...(taskWorkspace ? { workspace: taskWorkspace } : {}),
              }
            : { workspace: r.main.workspace }),
          inputProcessors: variant.delegated
            ? [
                ...(isolatedBoundary && isolatedBoundary !== 'coordinator'
                  ? [taskDiscoveryProcessor]
                  : []),
                toolTiming(emit, sample, 'task'),
              ]
            : [
                new TaskToolDiscoveryProcessor(() => r.mcp.tools()),
                toolTiming(emit, sample, 'task'),
              ],
          defaultOptions: {
            ...options(sample, 'task'),
            structuredOutput: publicOutputOptions,
            ...(delegation ? { delegation } : {}),
          },
        });
        // Register with a separate host using existing storage; do not start schedulers.
        new Mastra({
          agents: {
            task: agent,
            ...(worker ? { worker } : {}),
            ...(general ? { general } : {}),
          },
          storage: r.main.storage,
        });
        const messages = [
          ...history(context, scenario),
          {
            role: 'user',
            content: `${scenario.prompt}\nWebsite: ${url}${briefPath ? '\nSupplied attachment: ' + briefPath : ''}${documentPath ? '\nDocument is open in the Mousepad desktop application. Read it through desktop tools; do not use shell, file-reading tools or a browser file URL.' : ''}`,
          },
        ];
        scope.abort = new AbortController();
        timer = setTimeout(() => scope.abort.abort(), settings.timeout * 1000);
        start = Date.now();
        emit('sample.start', {
          ...row,
          setupMs: start - startedSetup,
          historyCharacters: JSON.stringify(messages).length,
        });
        let turnMessages = messages;
        for (let turn = 0; turn < (scenario.resume ? 5 : 1); turn++) {
          const output = await agent.stream(turnMessages, {
            ...options(sample, 'task'),
            structuredOutput: publicOutputOptions,
            ...(delegation ? { delegation } : {}),
            requestContext,
            memory: { thread, resource: 'pal-owner' },
            abortSignal: scope.abort.signal,
          });
          let blocks = [];
          for await (const chunk of output.fullStream) {
            if (chunk.type === 'text-delta')
              blocks.push(
                chunk.payload?.text ?? chunk.payload?.textDelta ?? '',
              );
            if (chunk.type === 'error') {
              status = 'error';
              errorType = 'AgentStreamError';
            }
          }
          answer = plain((await output.text) || blocks.join(''));
          const continuation = await privateEntry?.resume();
          if (!continuation) break;
          turnMessages = [{ role: 'user', content: continuation }];
        }
        if (documentPath)
          fixture.state.documentPreserved =
            (await r.execution.readFile(documentPath, 1024)).toString() ===
            'Document reference: DOC-739\nDocument amount: 83.27\n';
        if (scope.abort.signal.aborted) status = 'timeout';
        end = Date.now();
        if (scenario.resume && !scope.abort.signal.aborted)
          fixture.state.cancellationSafe =
            await privateEntry.checkCancellation();
      } catch (error) {
        status = scope.abort?.signal.aborted ? 'timeout' : 'error';
        errorType = error.name;
        emit('sample.error', {
          sample,
          error: error.name,
          message: String(error.message).slice(0, 500),
        });
      } finally {
        clearTimeout(timer);
        end ??= Date.now();
        if (originalCommand) r.browser.command = originalCommand;
        try {
          const events = telemetry.rows.filter((e) => e.sample === sample);
          const toolNames = events
            .filter((e) => e.event === 'tool.start')
            .map((e) => e.tool);
          const grading = score(
            scenario,
            fixture?.state ?? liveState,
            answer,
            toolNames,
          );
          const boundaries = events.filter((e) => e.event === 'model.start');
          const boundaryValid = validBoundaries(
            variant,
            boundaries,
            Object.keys(r.mcp.tools()),
          );
          result({
            ...row,
            status,
            errorType,
            elapsedMs: start ? end - start : null,
            setupMs: start ? start - startedSetup : end - startedSetup,
            websiteMs:
              fixture?.state.completedAt && start
                ? fixture.state.completedAt - start
                : null,
            ...grading,
            success:
              status === 'completed' && boundaryValid ? grading.success : false,
            boundaryValid,
            answer,
            websiteState: fixture?.state ?? liveState,
            workerOutputs,
          });
        } finally {
          // Continue cleanup even if one operation fails. Errors remain visible in traces.
          for (const [stage, cleanup] of [
            ['cua', async () => cua?.close()],
            ['private-entry', async () => privateEntry?.close()],
            [
              'document',
              async () => {
                if (documentPid)
                  await r.execution
                    .output('kill', ['-TERM', String(documentPid)])
                    .catch(() => {});
                if (documentProcess)
                  r.execution.sandbox.processes.release(documentProcess.pid);
                if (documentPath)
                  await r.main.workspace.filesystem.deleteFile(documentPath);
              },
            ],
            [
              'browser',
              async () => {
                if (task) {
                  for (const workerId of workerIds)
                    await r.browser.closeSession(task.id, workerId);
                  await r.browser.closeGroup(task.id);
                }
              },
            ],
            ['fixture', async () => fixture?.close()],
            [
              'file',
              async () => {
                if (briefPath)
                  await r.main.workspace.filesystem.deleteFile(briefPath);
              },
            ],
            [
              'task',
              async () => {
                if (task)
                  await r.tasks.update(task.id, {
                    archived: true,
                    status: 'completed',
                  });
              },
            ],
          ]) {
            try {
              await cleanup();
            } catch (error) {
              cleanupFailed = true;
              emit('cleanup.error', {
                sample,
                stage,
                error: error.name,
                ...(stage === 'fixture' &&
                error.message.startsWith('Benchmark vault ')
                  ? { message: error.message }
                  : {}),
              });
            }
          }
          scope.abort = null;
        }
      }
      if (cleanupFailed)
        throw Error(
          'Benchmark cleanup failed; inspect owned resources before resuming',
        );
      if (scope.stopping) break;
    }
  } finally {
    scope.active = false;
  }
  return { completed: true };
};
scope.stop = async () => {
  scope.stopping = true;
  scope.abort?.abort();
  // Let the in-flight stream and its owned tools settle before restoring instrumentation.
  const deadline = Date.now() + 30000;
  while (scope.active && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (scope.active)
    throw Error('Benchmark still settling; retry stop before detaching');
  telemetry.close();
  telemetry.rows.length = 0;
  scope.runtime = null;
  delete globalThis.__palBrowserBenchmark;
  return { restored: true };
};
