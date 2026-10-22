import assert from 'node:assert/strict';
import { smokeExecution, fixtureServer } from './smoke-execution.mjs';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

const { BrowserService } = await import('../dist/browser/browser.service.js');
const { browserTools } = await import('../dist/browser/browser-tools.js');
const { EventsService } = await import('../dist/events/events.service.js');
const { chromium } = await import('playwright-core');
const remote = await smokeExecution();
const { config, execution, exec: execFileSync, read: readFileSync } = remote;
const directory = '/home/pal/tmp/browser-smoke-' + randomUUID();
await execution.filesystem.mkdir(directory, { recursive: true });
const states = new Map();
const task = (title) => {
  const id = randomUUID();
  states.set(id, { id, title, status: 'in-progress', archived: false });
  return id;
};
const tasks = { details: async (id) => states.get(id) };
const events = new EventsService();
let service = new BrowserService(config, tasks, events, execution);
let observer;
let main, pool, schema;
const services = [service];
const a = task('Flights'),
  b = task('Hotels');
const token = 'PAL-' + randomUUID().slice(0, 8);
const submitted = [];
const fixture = await fixtureServer(
  remote,
  (req, res) => {
    if (req.url.startsWith('/submit')) {
      submitted.push(
        new URL(req.url, 'http://local').searchParams.get('value'),
      );
      res.end('ok');
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    const fixturePages = {
      '/f1-tickets':
        '<h1>Carousell-style Saturday F1 tickets — synthetic fixture</h1><p>Currency SGD. Saturday tickets only. Compare available quantities and total for three.</p><ul><li>Lotus: three available, S$175 each, total S$525. Listing <a href="/lotus">Lotus tickets</a>.</li><li>Spectre: only two available, S$160 each.</li><li>PitLane: three available, S$190 each, total S$570.</li><li>SoldOut: three S$150 each, SOLD.</li><li>FridayOnly: three S$100 each, Friday only.</li></ul>',
      '/lotus':
        '<h1>Lotus Saturday tickets</h1><p>Available: three Saturday F1 tickets at S$175 each, total S$525. Synthetic listing; no purchase required.</p>',
      '/fan-zone':
        '<h1>F1 Fan Zone</h1><p>TODAY in Asia/Singapore, 17:00 at Marina Square. Free admission.</p>',
      '/simulator':
        '<h1>Race Simulator Challenge</h1><p>TODAY in Asia/Singapore, 19:30 at Esplanade. S$12 per person.</p>',
      '/makan':
        '<h1>Makan Pit Stop</h1><p>Dinner S$10 per person, three-minute walk from Marina Square, open until 22:00.</p>',
      '/f1-events':
        '<h1>F1 fan events — synthetic fixture</h1><p>Today in Asia/Singapore. All times Singapore local time.</p><ul><li>F1 Fan Zone: TODAY 17:00 at Marina Square, free. <a href="/fan-zone">Details</a></li><li>Race Simulator Challenge: TODAY 19:30 at Esplanade, S$12 per person. <a href="/simulator">Details</a></li><li>Driver Signing: TOMORROW 18:00, not today.</li></ul>',
      '/f1-dinner':
        '<h1>Dinner near the F1 events — synthetic fixture</h1><ul><li>Makan Pit Stop: S$10 per person, three-minute walk from Marina Square, open until 22:00. <a href="/makan">Menu</a></li><li>Pasta Garage: S$18 per person, five-minute walk, open until 21:00.</li></ul>',
    };
    if (fixturePages[req.url]) {
      res.end(
        '<!doctype html><title>F1 fixture</title>' + fixturePages[req.url],
      );
      return;
    }
    res.end(
      `<!doctype html><title>${req.url}</title><h1>${req.url}</h1><p>Visible code: ${token}${req.url === '/agent-a' ? '-ONE' : req.url === '/agent-b' ? '-TWO' : ''}</p><label>Message<input id="message"></label><button onclick="fetch('/submit?value='+encodeURIComponent(document.querySelector('input').value))">Confirm</button><a href="/popup" target="_blank">Popup</a>`,
    );
  },
  { token },
  (kind, value) => {
    if (kind === 'submitted') submitted.push(value);
  },
);
const origin = fixture.origin;
const command = async (id, args) => {
  const result = await service.command(id, args);
  assert.ok(result.success, JSON.stringify(result));
  return result.data;
};
const until = async (check, timeout = 10000) => {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Browser fixture timed out');
    await delay(100);
  }
};
const resources = async (label) => {
  const rows = (
    await execFileSync('ps', ['-eo', 'pid,ppid,rss,args'], {
      encoding: 'utf8',
    })
  )
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      parent: Number(match[2]),
      rss: Number(match[3]),
      args: match[4],
    }));
  const ids = new Set(
    rows
      .filter((row) =>
        row.args.includes('--user-data-dir=' + '/home/pal/.config/chromium'),
      )
      .map((row) => row.pid),
  );
  for (let previous = -1; previous !== ids.size;) {
    previous = ids.size;
    for (const row of rows) if (ids.has(row.parent)) ids.add(row.pid);
  }
  const browserRows = rows.filter((row) => ids.has(row.pid));
  const daemonIds = new Set(
    await Promise.all(
      [a, b].map(async (id) => {
        try {
          return Number(
            await readFileSync(
              '/tmp/pal-runtime/agent-browser/pal-task-' + id + '.pid',
              'utf8',
            ),
          );
        } catch {
          return undefined;
        }
      }),
    ),
  );
  const daemons = rows.filter((row) => daemonIds.has(row.pid));
  console.log(
    'RESOURCE',
    label,
    JSON.stringify({
      browserProcesses: browserRows.length,
      browserRssMiB: Math.round(
        browserRows.reduce((sum, row) => sum + row.rss, 0) / 1024,
      ),
      taskDaemons: daemons.length,
      daemonRssMiB: Math.round(
        daemons.reduce((sum, row) => sum + row.rss, 0) / 1024,
      ),
    }),
  );
};
const deadline = setTimeout(
  () => {
    console.error('Browser smoke deadline exceeded');
    process.exit(1);
  },
  process.argv.includes('--workers')
    ? 360000
    : process.argv.includes('--agent')
      ? 240000
      : 120000,
);
try {
  // The isolated execution desktop owns Chromium and its persistent profile.
  await service.groups();
  await resources('idle');
  observer = await chromium.connectOverCDP(await service.cdpEndpoint(), {
    noDefaults: true,
  });
  let ctx = observer.contexts()[0];
  const human = await ctx.newPage();
  await human.goto(origin + '/human');
  const humanGroupPage = await ctx.newPage();
  await humanGroupPage.goto(origin + '/human-group');
  const worker = ctx.serviceWorkers()[0];
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url.endsWith('/human-group'));
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, { title: 'Human group' });
  });
  const opened = await Promise.all([
    command(a, ['open', origin + '/flights']),
    command(b, ['open', origin + '/hotels']),
  ]);
  await command(a, [
    'eval',
    "document.cookie='pal_login=shared; path=/; max-age=3600'; localStorage.setItem('pal_login','shared')",
  ]);
  const login = await command(b, [
    'eval',
    'JSON.stringify({cookie:document.cookie,storage:localStorage.getItem("pal_login")})',
  ]);
  assert.match(JSON.stringify(login), /pal_login=shared/);
  assert.match(JSON.stringify(login), /shared/);
  const snapshots = await Promise.all([
    command(a, ['snapshot', '-i']),
    command(b, ['snapshot', '-i']),
  ]);
  assert.match(JSON.stringify(snapshots[0]), /Message/);
  const urls = await Promise.all([
    command(a, ['get', 'url']),
    command(b, ['get', 'url']),
  ]);
  assert.match(JSON.stringify(urls[0]), /flights/);
  assert.match(JSON.stringify(urls[1]), /hotels/);
  await execFileSync(
    '/opt/pal/node_modules/.bin/agent-browser',
    ['--session', 'pal-task-' + b, 'close'],
    { timeout: 30000 },
  );
  await command(b, ['snapshot']);
  assert.match(JSON.stringify(await command(b, ['get', 'url'])), /hotels/);
  await resources('two active tasks plus human tabs');
  const { X11Computer } = await import('../dist/agent/x11-computer.js');
  await writeFile(
    '/tmp/pal-browser-groups.png',
    (await new X11Computer(execution).screenshot()).data,
  );
  const owned = await service.groups();
  assert.equal(owned.length, 2);
  assert.equal(typeof owned[0].tabs[0].targetId, 'string');
  assert.equal(ctx.pages().length, 5, 'First task attach leaked a tab');
  const extra = await command(a, [
    'tab',
    'new',
    '--label',
    'extra',
    origin + '/extra',
  ]);
  await command(a, ['tab', opened[0].targetId]);
  assert.match(JSON.stringify(await command(a, ['get', 'url'])), /flights/);
  await command(a, ['tab', extra.targetId]);
  assert.match(JSON.stringify(await command(a, ['get', 'url'])), /extra/);
  let groupA = (await service.groups()).find((g) => g.taskId === a);
  assert.equal(groupA.tabs.length, 2);
  await command(a, ['wait', 'a']);
  await command(a, ['click', 'a']);
  await until(
    async () =>
      (await service.groups()).find((g) => g.taskId === a).tabs.length === 3,
  );
  // Moving a tab out changes cleanup membership without a retained flag.
  await worker.evaluate(async (groupId) => {
    const tabs = await chrome.tabs.query({ groupId });
    const tab = tabs.find((t) => t.url.endsWith('/extra'));
    await chrome.tabs.ungroup([tab.id]);
  }, groupA.groupId);
  await service.closeGroup(a);
  assert.ok(ctx.pages().some((p) => p.url().endsWith('/extra')));
  assert.ok(ctx.pages().some((p) => p.url().endsWith('/human')));
  assert.ok(ctx.pages().some((p) => p.url().endsWith('/human-group')));
  await command(b, ['snapshot']);
  console.log(
    'PASS shared login, concurrent task tabs, automatic groups/popups, moved-tab preservation, independent group close',
  );

  const shot = await service.screenshot(b, false);
  assert.equal(
    Buffer.from(shot.data, 'base64').subarray(1, 4).toString(),
    'PNG',
  );
  const tools = browserTools(service);
  assert.equal(
    tools.browser_screenshot.toModelOutput(shot).value[1].type,
    'media',
  );
  console.log('PASS screenshot file converted to native image content');
  const controller = new AbortController();
  const cancelled = service.command(b, ['wait', '5000'], controller.signal);
  await delay(250);
  controller.abort();
  await assert.rejects(cancelled, /abort/i);
  assert.ok(
    !(await execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' }))
      .split('\n')
      .some((line) => line.includes('--session pal-task-' + b)),
  );
  await command(b, ['snapshot']);
  console.log(
    'PASS cancellation stops the CLI caller without an orphaned wrapper child',
  );

  // API reconnect reads Chrome session storage; no ownership DB is needed.
  service = new BrowserService(config, tasks, events, execution);
  services.push(service);
  assert.ok((await service.groups()).some((g) => g.taskId === b));
  await command(b, ['get', 'url']);
  const saved = (await service.groups()).find((g) => g.taskId === b);
  service.bindActiveTasks(() => [b]);
  await service.sweep(saved.lastActivity + 31 * 60_000);
  assert.equal((await service.groups()).length, 1);
  service.bindActiveTasks(() => []);
  await service.sweep(saved.lastActivity + 29 * 60_000);
  assert.equal((await service.groups()).length, 1);
  await service.sweep(saved.lastActivity + 31 * 60_000);
  assert.equal((await service.groups()).length, 0);
  await service.closeGroup(b);
  await delay(200);
  assert.equal(ctx.pages().length, 4, 'Cleanup leaked a task tab');
  await resources('after task cleanup; human tabs remain');
  console.log(
    'PASS API reconnect, active-run exclusion, idle threshold, idempotent cleanup',
  );

  await command(a, ['open', origin + '/again']);
  states.get(a).archived = true;
  await service.sweep();
  assert.equal((await service.groups()).length, 0);
  states.get(a).archived = false;
  await command(a, ['open', origin + '/again']);
  states.get(a).status = 'completed';
  await service.sweep();
  assert.equal((await service.groups()).length, 0);
  states.get(a).status = 'in-progress';
  console.log('PASS completion/archive cleanup and later task reuse');

  await command(b, ['open', origin + '/pin']);
  const selected = (await service.groups()).find((g) => g.taskId === b).tabs[0]
    .id;
  await worker.evaluate((id) => chrome.tabs.remove(id), selected);
  const gone = await service.command(b, ['snapshot']);
  assert.equal(gone.success, false);
  assert.match(JSON.stringify(gone), /tab_gone/);
  await service.closeGroup(b);
  console.log(
    'PASS externally closed tab fails without selecting another task or human tab',
  );

  // Three workers start together before the parent opens any browser tab.
  const workerIds = [randomUUID(), randomUUID(), randomUUID()];
  const workerCommand = async (id, args) => {
    const result = await service.command(a, args, undefined, id);
    assert.ok(result.success, JSON.stringify(result));
    return result.data;
  };
  await Promise.all(
    workerIds.map((id, index) =>
      workerCommand(id, ['open', origin + '/worker-' + index]),
    ),
  );
  let workerGroup = (await service.groups()).find(
    (group) => group.taskId === a,
  );
  assert.equal(
    (await service.groups()).length,
    1,
    'Parallel workers created duplicate task groups',
  );
  assert.equal(workerGroup.tabs.length, 3);
  assert.equal(new Set(workerGroup.tabs.map((tab) => tab.targetId)).size, 3);
  const workerUrls = await Promise.all(
    workerIds.map((id) => workerCommand(id, ['get', 'url'])),
  );
  for (let index = 0; index < 3; index++)
    assert.match(
      JSON.stringify(workerUrls[index]),
      new RegExp('/worker-' + index),
    );
  const workerTab = workerGroup.tabs.find((tab) =>
    tab.sessionId.endsWith(workerIds[0]),
  );
  // Chromium blocks popups from inactive tabs; foreground this opener to
  // exercise attribution. Background work can use explicit tab new.
  await worker.evaluate(
    (id) => chrome.tabs.update(id, { active: true }),
    workerTab.id,
  );
  await workerCommand(workerIds[0], ['click', 'a']);
  await until(
    async () =>
      (await service.groups()).find((group) => group.taskId === a).tabs
        .length === 4,
  );
  await worker.evaluate((id) => chrome.tabs.ungroup(id), workerTab.id);
  // Reconnect and suspend the extension before cleanup to prove persistence.
  service = new BrowserService(config, tasks, events, execution);
  services.push(service);
  await service.groups();
  await service.closeSession(a, workerIds[0]);
  workerGroup = (await service.groups()).find((group) => group.taskId === a);
  assert.equal(
    workerGroup.tabs.length,
    2,
    'Worker cleanup affected another worker or leaked its popup',
  );
  assert.ok(
    await ctx
      .pages()
      .find((page) => page.url().endsWith('/worker-0'))
      .url(),
  );
  await workerCommand(workerIds[1], ['get', 'url']);
  await service.closeGroup(a);
  assert.equal((await service.groups()).length, 0);
  const workerPid = (id) =>
    '/tmp/pal-runtime/agent-browser/pal-task-worker-' + id + '.pid';
  await until(async () =>
    (
      await Promise.all(
        workerIds.map(async (id) => {
          try {
            await readFileSync(workerPid(id));
            return false;
          } catch {
            return true;
          }
        }),
      )
    ).every(Boolean),
  );
  for (const id of workerIds) await assert.rejects(readFileSync(workerPid(id)));
  await ctx
    .pages()
    .find((page) => page.url().endsWith('/worker-0'))
    .close();
  console.log(
    'PASS three independent worker sessions in one group, reconnect, popup cleanup, moved-tab preservation, and daemon teardown',
  );

  if (process.argv.includes('--agent')) {
    const { RequestContext, MASTRA_THREAD_ID_KEY, MASTRA_RESOURCE_ID_KEY } =
      await import('@mastra/core/request-context');
    const { createMainSession, MAIN_RESOURCE_ID } =
      await import('../dist/agent/main-session.js');
    const { chatgptModel } = await import('../dist/agent/chatgpt-model.js');
    const { default: pg } = await import('pg');
    const url = new URL(process.env.TEST_DATABASE_URL);
    pool = new pg.Pool({ connectionString: url.toString() });
    schema = 'pal_browser_' + randomUUID().replaceAll('-', '');
    const publications = [];
    main = await createMainSession({
      connectionString: url.toString(),
      schemaName: schema,
      model: chatgptModel(
        process.env.PAL_AGENT_MODEL,
        process.env.PAL_AGENT_AUTH_PATH,
        process.env.PAL_AGENT_THINKING_EFFORT,
      ),
      memoryOptions: {
        lastMessages: 20,
        semanticRecall: false,
        workingMemory: { enabled: false },
      },
      publish: async () => {},
      onEvent: () => {},
      task: {
        instructions:
          'Use browser tools to complete the fixture in your task tab. Read the visible code from a screenshot, then fill Message and click Confirm. Return the code. Do not use eval or read source.',
        tools: browserTools(service),
        publish: async (output, context) => {
          publications.push({
            threadId: context.threadId,
            text: output.text,
          });
        },
      },
    });
    service.bindActiveTasks(() =>
      main.taskAgent
        .listActiveThreadRuns()
        .map((run) => run.threadId.slice('pal-task:'.length)),
    );
    await Promise.all([
      command(a, ['open', origin + '/agent-a']),
      command(b, ['open', origin + '/agent-b']),
    ]);
    const runs = await Promise.all(
      [a, b].map(async (id) => {
        const threadId = 'pal-task:' + id;
        const requestContext = new RequestContext([
          [MASTRA_THREAD_ID_KEY, threadId],
          [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
        ]);
        const delivery = await main.taskAgent.sendMessage(
          'Take a screenshot, read the visible code, and submit it in the form.',
          {
            resourceId: MAIN_RESOURCE_ID,
            threadId,
            ifIdle: { streamOptions: { requestContext, maxSteps: 10 } },
          },
        ).accepted;
        assert.equal(delivery.action, 'wake');
        return delivery.output;
      }),
    );
    assert.equal(main.taskAgent.listActiveThreadRuns().length, 2);
    await service.sweep(Date.now() + 31 * 60_000);
    assert.equal((await service.groups()).length, 2);
    for (const output of await Promise.all(
      runs.map((run) => run.getFullOutput()),
    )) {
      assert.notEqual(output.finishReason, 'error');
      assert.ok(
        output.toolCalls.some(
          (call) => call.payload.toolName === 'browser_screenshot',
        ),
        'Task did not use native screenshot media',
      );
    }
    for (const [id, suffix] of [
      [a, '-ONE'],
      [b, '-TWO'],
    ]) {
      assert.ok(submitted.includes(token + suffix));
      assert.ok(
        publications.some(
          (entry) =>
            entry.threadId === 'pal-task:' + id &&
            entry.text.includes(token + suffix),
        ),
      );
    }
    await Promise.all([service.closeGroup(a), service.closeGroup(b)]);
    await main.close();
    main = undefined;
    service.bindActiveTasks(() => []);
    console.log(
      'PASS two real task threads interpreted independent screenshots, submitted their forms, and excluded active native runs from cleanup',
    );
  }
  if (process.argv.includes('--workers') && process.argv.includes('--agent')) {
    const { RequestContext, MASTRA_THREAD_ID_KEY, MASTRA_RESOURCE_ID_KEY } =
      await import('@mastra/core/request-context');
    const { createMainSession, MAIN_RESOURCE_ID } =
      await import('../dist/agent/main-session.js');
    const { mainTaskTools, taskStatusTool, taskUpdateTool } =
      await import('../dist/agent/task-tools.js');
    const { TaskToolDiscoveryProcessor } =
      await import('../dist/agent/task-tool-discovery.processor.js');
    const { chatgptModel } = await import('../dist/agent/chatgpt-model.js');
    const { default: pg } = await import('pg');
    const url = new URL(process.env.TEST_DATABASE_URL);
    pool = new pg.Pool({ connectionString: url.toString() });
    schema = 'pal_workers_' + randomUUID().replaceAll('-', '');
    const { loadAgentInstructions } =
      await import('../dist/agent/agent-instructions.js');
    const [taskInstructions, workerInstructions] = await Promise.all([
      loadAgentInstructions('task'),
      loadAgentInstructions('worker'),
    ]);
    const publications = [],
      mainPublications = [],
      runs = [],
      intervals = [];
    const fixtureIds = new Set(),
      active = new Map();
    let peak = 0,
      nativePeak = 0;
    const nativeIntervals = [],
      nativeActive = new Map();
    Object.assign(tasks, {
      create: async (input) => {
        const id = task(input.title);
        fixtureIds.add(id);
        Object.assign(states.get(id), input);
        return states.get(id);
      },
      update: async (id, input) => Object.assign(states.get(id), input),
      search: async ({ queries }) => ({
        tasks: [...fixtureIds]
          .map((id) => states.get(id))
          .filter((entry) =>
            queries.some((query) =>
              query
                .toLowerCase()
                .split(/\s+/)
                .every((term) =>
                  JSON.stringify(entry).toLowerCase().includes(term),
                ),
            ),
          ),
        after: null,
      }),
    });
    const chat = {
      history: async ({ taskId }) => ({
        messages: publications
          .filter((entry) => entry.taskId === taskId)
          .map((entry) => ({ role: 'assistant', text: entry.text })),
      }),
    };
    const originalCommand = service.command.bind(service);
    service.command = async (taskId, args, signal, workerId) => {
      if (workerId && !active.has(workerId)) {
        const interval = { taskId, workerId, start: Date.now() };
        intervals.push(interval);
        active.set(workerId, interval);
        console.log('WORKER browser start', workerId, args[0]);
        peak = Math.max(
          peak,
          [...active.values()].filter((entry) => entry.taskId === taskId)
            .length,
        );
      }
      return originalCommand(taskId, args, signal, workerId);
    };
    const delegate = async (input) => {
      const entry = input.taskId
        ? await tasks.details(input.taskId)
        : await tasks.create({
            title: input.title,
            goal: input.goal,
            description: input.message,
          });
      const threadId = 'pal-task:' + entry.id;
      const requestContext = new RequestContext([
        [MASTRA_THREAD_ID_KEY, threadId],
        [MASTRA_RESOURCE_ID_KEY, MAIN_RESOURCE_ID],
      ]);
      const delivery = await main.taskAgent.sendMessage(input.message, {
        resourceId: MAIN_RESOURCE_ID,
        threadId,
        ifIdle: { streamOptions: { requestContext } },
      }).accepted;
      assert.equal(delivery.action, 'wake');
      // Drain the native task stream immediately, as the application does.
      // Waiting for worker activity first can backpressure delegated streams.
      const completion = delivery.output.getFullOutput();
      completion.catch(() => {});
      runs.push({ output: delivery.output, completion });
      return { taskId: entry.id };
    };
    main = await createMainSession({
      connectionString: url.toString(),
      schemaName: schema,
      workingDirectory: directory,
      sandbox: execution.sandbox,
      filesystem: execution.filesystem,
      model: chatgptModel(
        process.env.PAL_AGENT_MODEL,
        process.env.PAL_AGENT_AUTH_PATH,
        process.env.PAL_AGENT_THINKING_EFFORT,
      ),
      memoryOptions: {
        lastMessages: 20,
        semanticRecall: false,
        workingMemory: { enabled: false },
      },
      tools: mainTaskTools(tasks, chat, delegate),
      publish: async (output) => {
        mainPublications.push(output.text);
      },
      onEvent: () => {},
      task: {
        instructions: async ({ requestContext }) =>
          taskInstructions +
          '\nTask: ' +
          JSON.stringify(
            await tasks.details(
              requestContext
                .get(MASTRA_THREAD_ID_KEY)
                .slice('pal-task:'.length),
            ),
          ) +
          '\nCurrent UTC: ' +
          new Date().toISOString(),
        tools: () => ({
          ...browserTools(service),
          set_task_status: taskStatusTool(tasks),
          update_task: taskUpdateTool(tasks),
        }),
        inputProcessors: [new TaskToolDiscoveryProcessor(() => ({}))],
        publish: async (output, context) => {
          publications.push({
            taskId: context.threadId.slice('pal-task:'.length),
            text: output.text,
          });
        },
        worker: {
          instructions:
            workerInstructions + '\nCurrent UTC: ' + new Date().toISOString(),
          tools: browserTools(service),
          inputProcessors: [new TaskToolDiscoveryProcessor(() => ({}))],
          cleanup: async (taskId, workerId) => {
            await service.closeSession(taskId, workerId);
            const interval = active.get(workerId);
            if (interval) interval.end = Date.now();
            active.delete(workerId);
            console.log('WORKER cleanup', workerId);
          },
        },
      },
    });
    const defaults = await main.taskAgent.getDefaultOptions({
      requestContext: new RequestContext(),
    });
    const startDelegation = defaults.delegation.onDelegationStart;
    const completeDelegation = defaults.delegation.onDelegationComplete;
    defaults.delegation.onDelegationStart = async (context) => {
      const result = await startDelegation(context);
      if (result?.proceed === false) return result;
      const workerId = context.requestContext.get('palWorkerId');
      const entry = {
        workerId,
        runId: context.runId,
        toolCallId: context.toolCallId,
        start: Date.now(),
        taskId: context.requestContext.get('palParentTaskId'),
      };
      nativeIntervals.push(entry);
      nativeActive.set(workerId, entry);
      nativePeak = Math.max(
        nativePeak,
        [...nativeActive.values()].filter((run) => run.taskId === entry.taskId)
          .length,
      );
      console.log('WORKER delegated', workerId, context.prompt.slice(0, 180));
      return result;
    };
    defaults.delegation.onDelegationComplete = async (context) => {
      const entry = [...nativeActive.values()].find(
        (run) =>
          run.runId === context.runId && run.toolCallId === context.toolCallId,
      );
      try {
        await completeDelegation(context);
      } finally {
        if (entry) {
          entry.end = Date.now();
          nativeActive.delete(entry.workerId);
        }
      }
    };
    service.bindActiveTasks(() =>
      main.taskAgent
        .listActiveThreadRuns()
        .map((run) => run.threadId.slice('pal-task:'.length)),
    );
    const prompts = [
      'check cheapest saturday f1 tickets for 3 on carousell, and also f1 related events happening today',
      'also check the cheapest saturday f1 tickets for 3, f1 events today, and cheap dinner near those events',
    ];
    for (let index = 0; index < prompts.length; index++) {
      peak = 0;
      nativePeak = 0;
      const startNative = nativeIntervals.length;
      const startIntervals = intervals.length,
        startPublications = publications.length,
        previousRuns = runs.length;
      await main.session.sendMessage({
        content:
          prompts[index] +
          '. Keep this together as one task. Run these ' +
          (index ? 'three' : 'two') +
          ' independent checks concurrently using workers, then combine the findings. Singapore timezone. This is a read-only validation using synthetic local sources: tickets ' +
          origin +
          '/f1-tickets; events ' +
          origin +
          '/f1-events' +
          (index ? '; dinner ' + origin + '/f1-dinner' : '') +
          '. Use browser tools to inspect those pages. Do not contact sellers, buy anything, or use external sites. Return valid cheapest total for three and today’s events with links' +
          (index ? ', plus cheap dinner' : '') +
          '.',
      });
      assert.equal(
        runs.length,
        previousRuns + 1,
        'Main did not delegate one task',
      );
      if (!index) {
        await until(() => nativeIntervals.length > startNative, 60000);
        await main.session.sendMessage({
          content: 'While those checks run, what is 2 + 2? Answer briefly.',
        });
        assert.match(mainPublications.at(-1), /4|four/i);
      }
      const output = await runs.at(-1).completion;
      assert.notEqual(output.finishReason, 'error');
      const newIntervals = intervals.slice(startIntervals);
      assert.equal(
        nativePeak,
        index ? 3 : 2,
        'Expected native workers to overlap for independent branches',
      );
      assert.ok(
        newIntervals.every((entry) => entry.end),
        'Worker cleanup did not settle',
      );
      assert.ok(
        output.toolCalls.filter(
          (call) => call.payload.toolName === 'agent-worker',
        ).length >= (index ? 3 : 2),
      );
      const answer = publications
        .slice(startPublications)
        .map((entry) => entry.text)
        .join('\n');
      assert.match(answer, /525/);
      assert.match(answer, /Fan Zone/i);
      assert.match(answer, /Simulator/i);
      if (index) {
        assert.match(answer, /Makan/i);
        assert.match(answer, /10/);
      }
      for (const entry of newIntervals) {
        await assert.rejects(readFileSync(workerPid(entry.workerId)));
        const group = (await service.groups()).find(
          (group) => group.taskId === entry.taskId,
        );
        assert.ok(
          !group?.sessions.some((session) => session.endsWith(entry.workerId)),
        );
      }
      console.log(
        'PASS real-model prompt',
        JSON.stringify({
          prompt: prompts[index],
          peakWorkers: nativePeak,
          browserPeak: peak,
          workerCount: newIntervals.length,
          answer,
        }),
      );
    }
    assert.equal(fixtureIds.size, 1, 'Follow-up should reuse the public task');
    for (const id of fixtureIds) await service.closeGroup(id);
    await main.close();
    main = undefined;
    service.bindActiveTasks(() => []);
    console.log(
      'PASS Main stayed responsive; one task synthesized two/three private worker branches and cleaned their tabs/daemons',
    );
  }
  // Restart the browser with the same fixture profile: auth persists,
  // task associations belong to the new browser session.
  const cdp = await observer.newBrowserCDPSession();
  await cdp.send('Browser.close');
  await until(() => !observer.isConnected());
  // A CDP disconnect precedes profile shutdown; wait for the persistent writer to exit.
  await until(
    async () => !(await execution.run('pgrep', ['-x', 'chromium'])).success,
  );
  service = new BrowserService(config, tasks, events, execution);
  services.push(service);
  assert.equal((await service.groups()).length, 0);
  await command(b, ['open', origin + '/restarted']);
  const restoredLogin = await command(b, ['eval', 'document.cookie']);
  assert.match(JSON.stringify(restoredLogin), /pal_login=shared/);
  observer = await chromium.connectOverCDP(await service.cdpEndpoint(), {
    noDefaults: true,
  });
  console.log(
    'PASS browser restart preserves login and starts fresh task groups',
  );
  const workerControl = await observer
    .contexts()[0]
    .newCDPSession(observer.contexts()[0].pages()[0]);
  await workerControl.send('ServiceWorker.enable');
  await workerControl.send('ServiceWorker.stopAllWorkers');
  await delay(500);
  const stoppedGroups = await service.groups();
  const cold = new BrowserService(config, tasks, events, execution);
  services.push(cold);
  await workerControl.send('ServiceWorker.stopAllWorkers');
  await delay(500);
  assert.deepEqual(await cold.groups(), stoppedGroups);
  await workerControl.detach();
  console.log('PASS extension operations after service-worker suspension');
  console.log('Browser smoke complete');
} finally {
  if (main) {
    for (const run of main.taskAgent.listActiveThreadRuns())
      main.taskAgent.abortRunStream(run.runId);
    await main.close();
  }
  if (pool) {
    await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await pool.end();
  }
  for (const ownedService of services)
    await ownedService.shutdown().catch(() => {});
  if (observer?.isConnected()) {
    const cdp = await observer.newBrowserCDPSession();
    await cdp.send('Browser.close').catch(() => {});
    await observer.close().catch(() => {});
  }
  await fixture.close();
  await execution.filesystem.rmdir(directory, {
    recursive: true,
    force: true,
  });
  await execution.sandbox._stop();
  clearTimeout(deadline);
}
