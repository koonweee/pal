import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Agent } from '/opt/pal/node_modules/@mastra/core/dist/agent/index.js';
import { Mastra } from '/opt/pal/node_modules/@mastra/core/dist/mastra/index.js';
import { Memory } from '/opt/pal/node_modules/@mastra/memory/dist/index.js';
import {
  Workspace,
  WORKSPACE_TOOLS,
} from '/opt/pal/node_modules/@mastra/core/dist/workspace/index.js';
import {
  RequestContext,
  MASTRA_THREAD_ID_KEY,
  MASTRA_RESOURCE_ID_KEY,
} from '/opt/pal/node_modules/@mastra/core/dist/request-context/index.js';
import { ConfigService } from '/opt/pal/node_modules/@nestjs/config/dist/index.js';
import { MastraAgentRuntime } from '/opt/pal/dist/agent/mastra-agent-runtime.js';
import { chatgptModel } from '/opt/pal/dist/agent/chatgpt-model.js';
import { loadAgentInstructions } from '/opt/pal/dist/agent/agent-instructions.js';
import { agentSkillPaths } from '/opt/pal/dist/agent/agent-skills.js';
import { taskWorkerDelegation } from '/opt/pal/dist/agent/task-workers.js';
import { publicOutputOptions } from '/opt/pal/dist/agent/public-output.js';
import { browserTools } from '/opt/pal/dist/browser/browser-tools.js';
import {
  androidActions,
  AndroidService,
} from '/opt/pal/dist/android/android.service.js';
import { androidTools } from '/opt/pal/dist/android/android-tools.js';
import { loginTools } from '/opt/pal/dist/login/login-tools.js';
import {
  comparisonSchedule,
  comparisonScore,
  exposesComparisonSecret,
} from './comparison-cases.mjs';
import { comparisonPrivate } from './comparison-private.mjs';
import { productEvidence } from './comparison-evidence.mjs';
import { prepareNativeFixture } from './comparison-native.mjs';
import { validComparisonInventory } from './comparison-tools.mjs';
import { installFixture } from './fixtures.mjs';
import { trace, toolTiming } from './trace.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const settings = JSON.parse(readFileSync(directory + 'config.json', 'utf8'));
const telemetry = trace(directory + 'trace.jsonl');
export const prototype = MastraAgentRuntime.prototype;
const scope = (globalThis.__palBrowserBenchmark = {
  runtime: null,
  active: false,
  stopping: false,
  abort: null,
});
const busy = () =>
  scope.runtime.main.session.stream.isActive() ||
  scope.runtime.main.taskAgent.listActiveThreadRuns().length ||
  scope.runtime.taskRuns.size;
const model = (name) =>
  chatgptModel(
    name,
    scope.runtime.config.getOrThrow('PAL_AGENT_AUTH_PATH'),
    'medium',
  );
const options = (sample, role) => ({
  maxSteps: 0,
  stopWhen: () => false,
  modelSettings: {
    maxRetries: 1,
    timeout: { firstChunkMs: 120000, stepMs: 180000 },
    headers: { 'session-id': `pal-browser-bench:${sample}:${role}` },
  },
});
const hash = (value) => createHash('sha256').update(value).digest('hex');
const parseLines = (name) =>
  readFileSync(directory + name, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);
const plain = (text) => {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v.text) ? v.text.join('\n') : (v.text ?? text);
  } catch {
    return text;
  }
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function result(row) {
  appendFileSync(directory + 'results.jsonl', JSON.stringify(row) + '\n', {
    mode: 0o600,
  });
  telemetry.emit('sample.end', {
    sample: row.sample,
    key: row.key,
    status: row.status,
    success: row.success,
  });
}

scope.preflight = async () => {
  if (busy()) throw Error('Dev agent is busy');
  const r = scope.runtime;
  const availability = [];
  for (const name of ['gpt-6.1-sol', 'gpt-6.1-terra']) {
    const a = new Agent({
      id: 'comparison-availability-' + randomUUID(),
      name: 'Availability',
      instructions: 'Reply OK',
      model: model(name),
    });
    let supported = false;
    try {
      const output = await a.stream('Reply OK', {
        ...options('availability-' + name, 'probe'),
        abortSignal: AbortSignal.timeout(60000),
      });
      for await (const _ of output.fullStream) {
      }
      supported = /OK/.test(await output.text);
    } catch {}
    availability.push({ model: name, effort: 'medium', supported });
  }
  const taskInstructions = await loadAgentInstructions('task'),
    workerInstructions = await loadAgentInstructions('worker');
  const protocol = {
    version: 1,
    jobs: comparisonSchedule(settings).map(({ key, arm, round, scenario }) => ({
      key,
      arm,
      round,
      case: scenario.id,
    })),
    models: availability,
    prompts: { task: taskInstructions, worker: workerInstructions },
    skills: Object.fromEntries(
      agentSkillPaths('worker').map((path) => [
        path.split('/').at(-1),
        readFileSync(path + '/SKILL.md', 'utf8'),
      ]),
    ),
    capabilities: {},
    privacy:
      'No raw tool arguments, private fill values, full hierarchy or screenshots are persisted. Public product excerpts and bounded worker findings support separate live outcome review.',
    humanPolicy:
      'Queue all human-dependent steps; assisted run follows completed main.',
  };
  for (const service of ['amazon', 'facebook']) {
    const origin =
      service === 'amazon'
        ? 'https://www.amazon.com'
        : 'https://www.facebook.com';
    try {
      protocol.capabilities[service] = {
        matchingAccounts: (await r.login.accounts(origin)).length,
      };
    } catch {
      protocol.capabilities[service] = { vaultUnavailable: true };
    }
  }
  if (r.android.enabled) {
    const owner = { taskId: randomUUID(), workerId: randomUUID() };
    for (const packageName of new Set(
      comparisonSchedule(settings)
        .filter((job) => job.arm === 'android')
        .map((job) => job.scenario.packageName)
        .filter(Boolean),
    )) {
      let capability;
      try {
        await r.android.call(owner, 'android_launch_app', { packageName });
        await delay(1200);
        const view = await r.android.call(owner, 'android_foreground_app', {});
        capability = {
          setupRequired:
            view.isError || !JSON.stringify(view.content).includes(packageName),
        };
      } catch {
        capability = { setupRequired: true, observationUnavailable: true };
      }
      protocol.capabilities[packageName] = capability;
    }
    await r.android.release(owner.taskId, owner.workerId);
  }
  protocol.promptHash = hash(
    JSON.stringify({ prompts: protocol.prompts, skills: protocol.skills }),
  );
  if (existsSync(directory + 'protocol.json')) {
    const frozen = JSON.parse(
      readFileSync(directory + 'protocol.json', 'utf8'),
    );
    if (
      frozen.promptHash !== protocol.promptHash ||
      JSON.stringify(frozen.jobs) !== JSON.stringify(protocol.jobs)
    )
      throw Error('Frozen comparison protocol changed');
    protocol.capabilities = frozen.capabilities;
  }
  writeFileSync(
    directory + 'protocol.json',
    JSON.stringify(protocol, null, 2),
    { mode: 0o600 },
  );
  writeFileSync(directory + 'availability.json', JSON.stringify(availability), {
    mode: 0o600,
  });
  return {
    models: availability,
    capabilities: protocol.capabilities,
    samples: protocol.jobs.length,
  };
};

scope.run = async () => {
  if (scope.active || busy()) throw Error('Dev agent is busy');
  scope.active = true;
  const r = scope.runtime,
    protocol = JSON.parse(readFileSync(directory + 'protocol.json', 'utf8'));
  const previous = parseLines('results.jsonl'),
    completed = new Set(previous.map((row) => row.key));
  // An interrupted live mutation must never be silently replayed on resume.
  for (const event of parseLines('trace.jsonl').filter(
    (e) => e.event === 'sample.start' && !completed.has(e.key),
  )) {
    result({
      ...event,
      event: undefined,
      status: 'interrupted',
      success: false,
      needsHuman: true,
      reason: 'Review uncertain prior sample before any replay',
    });
    completed.add(event.key);
  }
  try {
    for (const job of comparisonSchedule(settings)) {
      if (scope.stopping) break;
      if (completed.has(job.key)) continue;
      if (busy()) throw Error('Normal dev work started');
      const { arm, scenario } = job,
        sample = randomUUID();
      const emit = (event, values = {}) =>
        telemetry.emit(event, { sample, ...values });
      const evidence = [];
      const workerFindings = [];
      const row = {
        sample,
        workerFindings,
        key: job.key,
        case: scenario.id,
        kind: scenario.kind,
        variant: arm,
        context: 'fresh',
        round: job.round,
        taskModel: 'gpt-6.1-sol',
        workerModel: 'gpt-6.1-terra',
        workerEffort: 'medium',
        taskEffort: 'medium',
      };
      const live = scenario.kind === 'live';
      const readiness =
        protocol.capabilities[
          scenario.id.startsWith('amazon') ? 'amazon' : 'facebook'
        ];
      const native = protocol.capabilities[scenario.packageName];
      let reason;
      if (!protocol.models.every((m) => m.supported))
        reason = 'model-unavailable';
      else if (arm === 'android' && !r.android.enabled)
        reason = 'phone-unavailable';
      else if (
        live &&
        scenario.login &&
        settings.phase !== 'assisted' &&
        readiness?.matchingAccounts !== 1
      )
        reason = 'account-setup-or-choice';
      else if (live && arm === 'android' && native?.setupRequired)
        reason = 'native-first-run-setup';
      if (reason) {
        result({
          ...row,
          status: 'deferred',
          success: null,
          needsHuman: true,
          reason,
          elapsedMs: null,
        });
        continue;
      }
      let fixture,
        entry,
        task,
        android = r.android,
        workspace,
        start,
        end,
        status = 'completed',
        answer = '',
        errorType,
        needsHuman = false,
        privacyValid = true;
      const workerIds = new Set(),
        fillRoles = [],
        toolInventory = [];
      let seedWorker = randomUUID();
      scope.abort = new AbortController();
      const timer = setTimeout(
        () => scope.abort.abort(),
        (settings.timeout +
          (settings.phase === 'assisted'
            ? (settings.humanWaitSeconds ?? 900)
            : 0)) *
          1000,
      );
      emit('sample.start', { key: job.key, arm, case: scenario.id });
      try {
        task = await r.tasks.create({
          title: 'UI comparison ' + scenario.id,
          goal: scenario.prompt,
        });
        emit('owned.task', { taskId: task.id });
        if (!live && arm !== 'android')
          fixture = await installFixture(
            r.browser,
            scenario,
            sample.slice(0, 8),
          );
        let url = fixture?.url ?? scenario.url;
        if (arm === 'android' && !live) {
          await prepareNativeFixture(r.android, {
            taskId: task.id,
            workerId: seedWorker,
          });
          emit('fixture.startVerified', { stage: 'username' });
          await r.android.release(task.id, seedWorker);
          android = new AndroidService(new ConfigService(process.env));
          url = 'dev.pal.securefixture';
        }
        entry = await comparisonPrivate(
          r,
          task,
          android,
          settings.database,
          !live,
          emit,
          settings.phase === 'assisted',
          settings.humanWaitSeconds,
          scope.abort.signal,
        );
        if (arm !== 'android') {
          await r.browser.command(
            task.id,
            ['tab', 'new', url],
            undefined,
            seedWorker,
          );
          // CDP can report a new target before Playwright has initialized its
          // Page (observed during Apple account redirects). Wait outside timing.
          const deadline = Date.now() + 10_000;
          let page;
          while (!page) {
            try {
              page = await r.browser.selectedPage(task.id, seedWorker);
            } catch (error) {
              if (error.message !== 'Browser tab is unavailable' || Date.now() >= deadline)
                throw error;
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
          }
          await page.bringToFront();
          if (live && scenario.login) {
            const auth =
              'input[type=password],input[autocomplete=username],input[name=email],input#email,input[name=login]';
            if (
              !(await page
                .locator(auth)
                .first()
                .isVisible()
                .catch(() => false))
            ) {
              // Sign-outs are authorized; use the actual site's visible account UI.
              if (scenario.id === 'amazon-order') {
                await page
                  .locator('#nav-link-accountList')
                  .hover({ timeout: 5000 })
                  .catch(() => {});
                await page
                  .getByText('Sign Out', { exact: true })
                  .click({ timeout: 5000 })
                  .catch(() => {});
              } else if (scenario.id === 'facebook-event') {
                await page
                  .getByRole('button', { name: /Account|Your profile/i })
                  .first()
                  .click({ timeout: 5000 })
                  .catch(() => {});
                await page
                  .getByText('Log out', { exact: true })
                  .click({ timeout: 5000 })
                  .catch(() => {});
              }
              await page
                .goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
                .catch(() => {});
            }
            if (
              !(await page
                .locator(auth)
                .first()
                .isVisible()
                .catch(() => false))
            ) {
              result({
                ...row,
                status: 'deferred',
                success: null,
                needsHuman: true,
                reason: 'fresh-login-setup-or-challenge',
                elapsedMs: null,
              });
              continue;
            }
            emit('starting-state', {
              signedOut: true,
              source: 'visible-login-input',
            });
          }
        }
        const capturePublicEvidence = async () => {
          if (scenario.id !== 'amazon-products' || arm === 'android') return;
          try {
            const page = await r.browser.selectedPage(task.id, seedWorker);
            if (!/(^|\.)amazon\.com$/.test(new URL(page.url()).hostname))
              return;
            for (const item of await page.evaluate(productEvidence)) {
              evidence.push(item);
              emit('evidence.public', item);
            }
          } catch {
            /* Evidence gaps remain pending review. */
          }
        };
        const privateScreen = async () => {
          if (arm === 'android' || (!fillRoles.length && !entry.fills.length))
            return false;
          const page = await r.browser.selectedPage(task.id, seedWorker);
          return page
            .locator(
              'input[type=password],input[autocomplete=username],input[autocomplete="one-time-code"],input[name=email],input#email',
            )
            .filter({ visible: true })
            .count()
            .then((count) => count > 0)
            .catch(() => false);
        };
        const tools = {
          ...loginTools(entry.service),
          ...(arm === 'browser'
            ? browserTools(r.browser)
            : arm === 'android'
              ? await androidTools(
                  android,
                  Object.keys(androidActions).filter(
                    (name) =>
                      scenario.packageName === 'com.android.chrome' ||
                      name !== 'android_open_url',
                  ),
                )
              : {}),
        };
        if (scenario.packageName !== 'com.android.chrome')
          delete tools.android_open_url;
        for (const [name, tool] of Object.entries(tools)) {
          const execute = tool.execute.bind(tool);
          tools[name] = Object.assign(
            Object.create(Object.getPrototypeOf(tool)),
            tool,
            {
              execute: async (args, context) => {
                if (!live && exposesComparisonSecret(args)) {
                  privacyValid = false;
                  throw Error('Secret in ordinary tool arguments');
                }
                const actions =
                  name === 'android_batch'
                    ? args.steps
                    : [{ name, arguments: args }];
                if (
                  actions.some(
                    (step) =>
                      step.name === 'android_launch_app' &&
                      step.arguments.packageName !==
                        (scenario.packageName ?? 'dev.pal.securefixture'),
                  )
                )
                  throw Error('App outside case');
                if (
                  (name === 'browser_screenshot' ||
                    (name === 'browser' &&
                      ['snapshot', 'get', 'eval'].includes(args.args?.[0]))) &&
                  (await privateScreen())
                )
                  throw Error(
                    'Use masked login_inspect while private fields are populated',
                  );
                if (
                  name === 'browser' &&
                  ['eval', 'eval-file'].includes(args.args?.[0]) &&
                  /fetch|XMLHttpRequest|WebSocket|localStorage|document\.cookie/.test(
                    args.args.join(' '),
                  )
                )
                  throw Error(
                    'Network/storage bypass is outside the browser UI arm',
                  );
                if (
                  arm === 'computer' &&
                  args.action &&
                  name !== 'login_session'
                )
                  throw Error('Computer navigation must use computer tools');
                if (name === 'login_inspect' && arm === 'android')
                  args = {
                    ...args,
                    target: 'android',
                    website: scenario.url
                      ? new URL(scenario.url).origin
                      : 'https://android-fixture.example.test',
                  };
                if (arm !== 'android' && args.target === 'android')
                  throw Error('Phone outside assigned method');
                const result = await execute(args, context);
                if (name === 'android_inspect')
                  emit('android.observation', {
                    characters: result.content
                      .filter((part) => part.type === 'text')
                      .reduce((sum, part) => sum + part.text.length, 0),
                  });
                if (
                  scenario.id === 'amazon-products' &&
                  [
                    'android_inspect',
                    'android_batch',
                    'android_clipboard',
                  ].includes(name)
                ) {
                  const facts = result.content
                    .filter((part) => part.type === 'text')
                    .flatMap((part) => part.text.split('\n'))
                    .filter((line) =>
                      /WH-1000XM5|QuietComfort|\bBlack\b|\$\s*\d|in stock|available to ship|ships from|sold by|\ba\.co\/|amazon\.com\/(dp|gp\/product)/i.test(
                        line,
                      ),
                    )
                    .map((line) => line.slice(0, 600))
                    .slice(0, 30);
                  if (facts.length)
                    evidence.push({
                      source: 'android-public-product-excerpt',
                      tool: name,
                      facts,
                    });
                }
                await capturePublicEvidence();
                if (
                  !live &&
                  !name.startsWith('android_') &&
                  exposesComparisonSecret(result)
                ) {
                  privacyValid = false;
                  throw Error('Observation privacy gate failed');
                }
                if (name === 'secure_fill' && result.status === 'filled') {
                  fillRoles.push(...result.fields);
                  emit('private.fill', {
                    roles: result.fields,
                    source: 'saved-vault',
                  });
                }
                return result;
              },
            },
          );
        }
        workspace = new Workspace({
          id: 'comparison-workspace-' + sample,
          filesystem: r.main.workspace.filesystem,
          sandbox: r.main.workspace.sandbox,
          tools: {
            enabled: false,
            requireApproval: false,
            ...Object.fromEntries(
              Object.values(WORKSPACE_TOOLS.COMPUTER).map((name) => [
                name,
                { enabled: arm === 'computer' },
              ]),
            ),
          },
        });
        const boundaryProcessor = {
          id: 'comparison-boundary',
          processInputStep({ tools: available }) {
            const names = Object.keys(available);
            toolInventory.push(names);
            if (!validComparisonInventory(arm, 'worker', names))
              throw Error('Unexpected method capability');
            emit('tool.inventory', {
              tools: names,
              hash: hash(JSON.stringify(names.sort())),
            });
            return {
              tools: Object.fromEntries(
                Object.entries(available).map(([name, tool]) => {
                  if (!name.startsWith('mastra_workspace_computer_'))
                    return [name, tool];
                  return [
                    name,
                    Object.assign(
                      Object.create(Object.getPrototypeOf(tool)),
                      tool,
                      {
                        execute: async (args, ...rest) => {
                          if (!live && exposesComparisonSecret(args)) {
                            privacyValid = false;
                            throw Error(
                              'Secret in ordinary computer arguments',
                            );
                          }
                          if (
                            name.includes('screenshot') &&
                            (await privateScreen())
                          )
                            throw Error(
                              'Use masked login_inspect while private fields are populated',
                            );
                          const result = await tool.execute(args, ...rest);
                          await capturePublicEvidence();
                          return result;
                        },
                      },
                    ),
                  ];
                }),
              ),
            };
          },
        };
        const memory = new Memory({
          storage: r.main.storage,
          options: {
            lastMessages: 100,
            semanticRecall: false,
            workingMemory: { enabled: false },
          },
        });
        const guidance = `\nBenchmark method: ${arm}. Use only the assigned UI method and Pal private filling. No service/API/search/shell/code-mode bypass. ${arm === 'computer' ? 'Use screenshots/mouse/keyboard for navigation; private inspection/filling are allowed. Do not supply browser actions to login tools.' : ''} ${arm === 'android' ? (scenario.packageName === 'com.android.chrome' ? 'Use Android Chrome on the phone for the supplied website, through Android UI tools.' : 'Use the native app; browser handoffs require reporting a blocker.') : ''} Preserve unrelated tabs/apps. ${settings.phase === 'warm' ? 'Use the existing signed-in session only. Do not sign out, fill credentials, or start private entry. Report any authentication challenge as a blocker and stop.' : 'Request credentials only through private entry, then yield.'} Return a setup/challenge blocker immediately when user action is required. Verify the actual destination/draft before reporting success.`;
        const worker = new Agent({
          id: 'comparison-worker-' + sample,
          name: 'Interaction',
          description:
            'Complete the assigned UI workflow and return verified findings.',
          model: model('gpt-6.1-terra'),
          instructions: protocol.prompts.worker + guidance,
          skills: agentSkillPaths('worker'),
          workspace,
          memory,
          tools,
          inputProcessors: [
            boundaryProcessor,
            toolTiming(telemetry.emit, sample, 'worker'),
          ],
          defaultOptions: options(sample, 'worker'),
        });
        const hooks = taskWorkerDelegation(
          async (taskId, workerId, complete, since) => {
            workerIds.add(workerId);
            const retain = await entry.service.retainWorkerSession(
              taskId,
              workerId,
              complete,
              since,
            );
            await android.release(taskId, workerId, retain);
            if (!retain && arm !== 'android')
              await r.browser.closeSession(taskId, workerId);
          },
          async (taskId, assignment) =>
            (await entry.service.resumeWorker(taskId, assignment)) ??
            seedWorker,
        );
        const delegation = {
          ...hooks,
          onDelegationStart: async (c) => {
            const value = await hooks.onDelegationStart(c);
            emit('delegation.start', {
              inheritedMessages: 0,
              workerId: c.requestContext.get('palWorkerId'),
            });
            return value;
          },
          onDelegationComplete: async (c) => {
            if (!live && exposesComparisonSecret(c.result))
              privacyValid = false;
            if (live || !exposesComparisonSecret(c.result))
              workerFindings.push({
                success: c.success,
                text: plain(
                  typeof c.result === 'string'
                    ? c.result
                    : JSON.stringify(c.result ?? ''),
                ).slice(0, 6000),
              });
            emit('delegation.end', { ms: c.duration, success: c.success });
            return hooks.onDelegationComplete(c);
          },
        };
        const agent = new Agent({
          id: 'comparison-task-' + sample,
          name: 'Task',
          instructions:
            protocol.prompts.task +
            guidance +
            '\nDelegate the entire UI workflow. No scheduling or task metadata tools exist in this benchmark.',
          model: model('gpt-6.1-sol'),
          tools: {},
          memory,
          agents: { worker },
          defaultOptions: {
            ...options(sample, 'task'),
            structuredOutput: publicOutputOptions,
            delegation,
          },
        });
        new Mastra({
          agents: { task: agent, worker },
          storage: r.main.storage,
        });
        const requestContext = new RequestContext([
          [MASTRA_THREAD_ID_KEY, 'pal-task:' + task.id],
          [MASTRA_RESOURCE_ID_KEY, 'pal-owner'],
        ]);
        const threadId = 'pal-task:' + task.id;
        start = Date.now();
        let message = `${scenario.prompt}\nMethod: ${arm}. ${arm === 'android' ? 'Android package: ' + (scenario.packageName ?? 'dev.pal.securefixture') + (scenario.packageName === 'com.android.chrome' ? '. Navigate to: ' + url : '') : 'Website already open in the owned session: ' + url}`;
        for (let turn = 0; turn < 8; turn++) {
          const output = await agent.stream(message, {
            ...options(sample, 'task'),
            structuredOutput: publicOutputOptions,
            delegation,
            threadId,
            resourceId: 'pal-owner',
            requestContext,
            abortSignal: scope.abort.signal,
          });
          for await (const chunk of output.fullStream)
            if (chunk.type === 'error') status = 'error';
          answer = plain(await output.text);
          if (!live && exposesComparisonSecret(answer)) {
            privacyValid = false;
            answer = '[withheld by privacy gate]';
            break;
          }
          const continuation = await entry.continue();
          if (!continuation) break;
          if (continuation.needsHuman) {
            needsHuman = true;
            reason = continuation.reason;
            status = 'needs-human';
            break;
          }
          message = continuation.message;
        }
        if (evidence.some((item) => item.challenge)) {
          needsHuman = true;
          reason = 'site-challenge';
          status = 'needs-human';
        }
        if (scope.abort.signal.aborted)
          status = scope.stopping ? 'interrupted' : 'timeout';
        end = Date.now();
        let state = fixture?.state;
        if (!live && arm === 'android') {
          const view = await android.call(
            { taskId: task.id, workerId: seedWorker },
            'android_inspect',
            {},
          );
          const text = JSON.stringify(view.content);
          state = {
            authenticated: !view.isError && text.includes('Authenticated'),
            draft: text.includes('Draft saved: PAL-DRAFT-42')
              ? 'PAL-DRAFT-42'
              : null,
            saves: text.includes('saves: 1') ? 1 : 0,
          };
        }
        if (!live && arm === 'android') {
          await prepareNativeFixture(android, {
            taskId: task.id,
            workerId: seedWorker,
          });
          emit('fixture.resetVerified', { stage: 'username' });
        }
        const events = telemetry.rows.filter((e) => e.sample === sample),
          boundaryValid =
            toolInventory.length > 0 &&
            events
              .filter((e) => e.event === 'model.start')
              .every((e) => validComparisonInventory(arm, e.role, e.tools));
        const grading = comparisonScore({
          scenario,
          state,
          fillRoles: [...fillRoles, ...entry.fills],
          boundaryValid,
          privacyValid,
          answer,
          status,
        });
        result({
          ...row,
          status,
          elapsedMs: end - start,
          activeMs: end - start - entry.humanWaitMs,
          humanWaitMs: entry.humanWaitMs,
          needsHuman,
          reason,
          answer,
          evidence,
          startingState: {
            login: scenario.login
              ? 'verified signed out'
              : live
                ? 'available session; review authentication/marketplace'
                : 'fresh fixture',
          },
          ...grading,
          boundaryValid,
          privacyValid,
          fillRoles: [...fillRoles, ...entry.fills],
          websiteState: state,
          promptHash: protocol.promptHash,
        });
        if (!privacyValid) throw Error('Privacy failure; collection stopped');
      } catch (error) {
        if (!parseLines('results.jsonl').some((v) => v.sample === sample))
          result({
            ...row,
            status: scope.abort.signal.aborted
              ? scope.stopping
                ? 'interrupted'
                : 'timeout'
              : 'error',
            success: false,
            errorType: error.name,
            elapsedMs: start ? Date.now() - start : null,
            privacyValid,
            needsHuman: false,
          });
        emit('sample.error', {
          error: error.name,
          diagnostic:
            /^(Private|Owned native fixture|Unexpected method|Benchmark|Expected|Observation|Dev|Cleanup|Secret)/.test(
              error.message,
            )
              ? error.message
              : undefined,
        });
        if (!privacyValid) throw error;
      } finally {
        clearTimeout(timer);
        let cleanupFailed = false;
        for (const [stage, cleanup] of [
          ['private', async () => entry?.close()],
          [
            'workers',
            async () => {
              for (const worker of new Set([seedWorker, ...workerIds])) {
                await android.release(task?.id, worker);
                if (arm !== 'android' && task)
                  await r.browser.closeSession(task.id, worker);
              }
            },
          ],
          [
            'android-client',
            async () => {
              if (android !== r.android) await android.onApplicationShutdown();
            },
          ],
          [
            'tabs',
            async () => {
              if (task) await r.browser.closeGroup(task.id);
            },
          ],
          ['fixture', async () => fixture?.close()],
          [
            'task',
            async () => {
              if (task)
                await r.tasks.update(task.id, {
                  status: 'completed',
                  archived: true,
                });
            },
          ],
        ])
          try {
            await cleanup();
          } catch (error) {
            cleanupFailed = true;
            emit('cleanup.error', { stage, error: error.name });
          }
        scope.abort = null;
        if (cleanupFailed) throw Error('Cleanup not verified');
      }
    }
  } finally {
    scope.active = false;
  }
  return { completed: true };
};
scope.stop = async () => {
  scope.stopping = true;
  scope.abort?.abort();
  for (let i = 0; scope.active && i < 300; i++) await delay(100);
  if (scope.active) throw Error('Benchmark still settling');
  telemetry.close();
  scope.runtime = null;
  delete globalThis.__palBrowserBenchmark;
  return { restored: true };
};
