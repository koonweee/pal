import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { InteractionCoordinator } from '../dist/interaction/interaction-coordinator.js';
import { SharedBrowserService } from '../dist/browser/shared-browser.service.js';
import { ExecutionService } from '../dist/execution/execution.service.js';
import { X11Computer } from '../dist/agent/x11-computer.js';
import { AndroidService } from '../dist/android/android.service.js';
import { LoginBrowser } from '../dist/login/login-browser.js';

// Run in the existing, idle development service. This is deterministic adapter
// acceptance; native model behavior is evaluated separately through dev Tasks.
assert.equal(process.env.PAL_EXECUTION_ID, 'pal-dev-split-execution');
const config = new ConfigService({ ...process.env, PAL_DESKTOP_ENABLED: true });
const coordinator = new InteractionCoordinator();
const execution = new ExecutionService(config);
const browser = new SharedBrowserService(config, execution);
const computer = new X11Computer(execution, undefined, () =>
  coordinator.unavailable('desktop'),
);
const android = new AndroidService(config, coordinator);
const includeAndroid =
  android.enabled && !process.argv.includes('--desktop-only');
const login = new LoginBrowser();
const origin = 'https://pal-queue-' + randomUUID() + '.example.test';
const events = [];
coordinator.events.subscribe((event) =>
  events.push({ ...event, at: Date.now() }),
);
const begin = (taskId) => {
  const identity = { taskId, workerId: randomUUID() };
  return { ...identity, executionId: coordinator.begin(identity, 'smoke') };
};
const turn = async (owner, operation) => {
  try {
    return await coordinator.run('desktop', owner.executionId, operation);
  } finally {
    await coordinator.finish(owner.executionId);
  }
};
let context;
let initial;
const created = new Set();
const track = (page) => {
  if (page.url().startsWith(origin) || page.url() === 'about:blank')
    created.add(page);
};
try {
  // Do not contend with the actual dev backend using a separate smoke coordinator.
  const response = await fetch('http://127.0.0.1:3000/stream', {
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(response.ok);
  const reader = response.body.getReader();
  let data = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('Missing dev activity snapshot');
      data += new TextDecoder().decode(chunk.value);
      const line = data
        .split('\n')
        .find(
          (line) => line.startsWith('data:') && line.includes('agent.activity'),
        );
      if (line) {
        assert.equal(
          JSON.parse(line.slice(5)).state.status,
          'idle',
          'Wait for existing dev agent work to settle',
        );
        break;
      }
    }
  } finally {
    await reader.cancel();
  }

  const baseline = begin('single-worker-baseline');
  const start = Date.now();
  await turn(baseline, () => computer.screenshot());
  const baselineMs = Date.now() - start;

  // Queue the entire burst before yielding to the event loop.
  const burst = Array.from({ length: 10 }, (_, index) =>
    begin('scheduled-' + index),
  );
  const interactive = begin('direct-request');
  const order = [];
  const pending = [...burst, interactive].map((owner) =>
    turn(owner, async () => {
      order.push(owner.taskId);
      const screenshot = await computer.screenshot();
      assert.equal(screenshot.data.subarray(1, 4).toString(), 'PNG');
    }),
  );
  // Observe all turns immediately so an independent-device failure can still
  // drain/cancel the burst without unhandled promise rejections masking it.
  for (const result of pending) void result.catch(() => {});
  let androidConcurrent = false;
  if (includeAndroid) {
    const phones = [begin('independent-phone'), begin('queued-phone')];
    const phoneOrder = [];
    await Promise.all(
      phones.map(async (phone) => {
        try {
          await coordinator.run('android', phone.executionId, async () => {
            phoneOrder.push(phone.taskId);
            androidConcurrent ||= coordinator
              .snapshot()
              .some((entry) => entry.resource === 'desktop' && entry.owner);
            const result = await android.call(phone, 'android_screenshot', {});
            assert.ok(!result.isError);
          });
        } finally {
          await coordinator.finish(phone.executionId);
        }
      }),
    );
    assert.deepEqual(
      phoneOrder,
      phones.map((phone) => phone.taskId),
    );
    assert.ok(
      androidConcurrent,
      'Android did not progress alongside a desktop owner',
    );
  }
  await Promise.all(pending);
  assert.deepEqual(
    order,
    [...burst, interactive].map((owner) => owner.taskId),
  );

  // Cancel after dispatch: the next turn must wait for the real adapter call.
  const cancelled = begin('cancelled-desktop');
  const follower = begin('after-cancellation');
  const abort = new AbortController();
  const started = Promise.withResolvers();
  let settled = false;
  const active = coordinator.run(
    'desktop',
    cancelled.executionId,
    async () => {
      started.resolve();
      try {
        await computer.screenshot();
      } finally {
        settled = true;
      }
    },
    abort.signal,
  );
  await started.promise;
  const following = turn(follower, async () => {
    assert.ok(settled, 'Cancelled operation overlapped its follower');
    await computer.screenshot();
  });
  abort.abort();
  await assert.rejects(
    coordinator.run('desktop', cancelled.executionId, () =>
      computer.screenshot(),
    ),
    /ended/,
  );
  await Promise.all([
    active,
    coordinator.finish(cancelled.executionId),
    following,
  ]);

  const privateOwner = begin('private-entry');
  await coordinator.run('desktop', privateOwner.executionId, async () => {
    initial = await browser.selectedPage(
      privateOwner.taskId,
      privateOwner.workerId,
      true,
    );
    context = initial.context();
    // Only the fixture host is intercepted; credentials below are synthetic.
    await context.route(origin + '/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Queue fixture</title><input id="user" autocomplete="username"><input id="password" type="password" autocomplete="current-password">',
      }),
    );
    context.on('page', track);
    await computer.press(['ctrl', 't']);
    await computer.type(origin + '/login');
    await computer.press('Return');
  });
  const deadline = Date.now() + 10000;
  let target;
  do {
    target = await browser.selectedPage(
      privateOwner.taskId,
      privateOwner.workerId,
      true,
    );
    if (
      target.url() === origin + '/login' &&
      (await target.locator('#user').count())
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.equal(target.url(), origin + '/login');
  created.add(target);
  const inspected = await coordinator.run(
    'desktop',
    privateOwner.executionId,
    () => login.inspect(target, privateOwner.workerId),
  );
  const fields = {
    username: inspected.inputs[0].ref,
    password: inspected.inputs[1].ref,
  };
  await coordinator.finish(privateOwner.executionId);

  const other = begin('intervening-task');
  await turn(other, async () => {
    await computer.press(['ctrl', 't']);
    await computer.type(origin + '/other');
    await computer.press('Return');
    // Capture identifies the intervening page without changing the private binding.
    await computer.screenshot();
  });
  await coordinator.forSession('desktop', privateOwner, async () => {
    const bound = await browser.selectedPage(
      privateOwner.taskId,
      privateOwner.workerId,
    );
    assert.equal(bound, target);
    await login.fill(bound, privateOwner.workerId, fields, {
      username: 'SYNTHETIC_USER',
      password: 'SYNTHETIC_PASSWORD',
    });
  });
  assert.equal(await target.locator('#user').inputValue(), 'SYNTHETIC_USER');
  assert.equal(
    await target.locator('#password').inputValue(),
    'SYNTHETIC_PASSWORD',
  );
  assert.ok(!target.isClosed(), 'Handoff preserves the private-entry tab');

  const acquired = events.filter((event) => event.event === 'acquired');
  console.log(
    JSON.stringify(
      {
        passed: true,
        baselineMs,
        order,
        android: includeAndroid
          ? { passed: true, concurrentWithDesktop: androidConcurrent }
          : {
              skipped: android.enabled
                ? 'explicit desktop subset'
                : 'not configured',
            },
        privateEntryAfterInterveningTask: true,
        cancellationDrainedBeforeHandoff: true,
        waits: acquired.map(({ taskId, resource, durationMs }) => ({
          taskId,
          resource,
          durationMs,
        })),
        ownership: events
          .filter((event) => event.event === 'released')
          .map(({ taskId, resource, durationMs }) => ({
            taskId,
            resource,
            durationMs,
          })),
      },
      null,
      2,
    ),
  );
} finally {
  // Fixture cleanup is itself an owning turn; existing user tabs stay open.
  if (context) {
    context.off('page', track);
    const cleanup = begin('fixture-cleanup');
    await turn(cleanup, async () => {
      for (const page of context.pages()) {
        if (created.has(page) || page.url().startsWith(origin))
          await page.close().catch(() => {});
      }
      if (initial && !initial.isClosed()) await initial.bringToFront();
      await context.unroute(origin + '/**');
    });
  }
  await coordinator.shutdown();
  await android.onApplicationShutdown();
  await browser.shutdown();
  await execution.sandbox._stop();
}
