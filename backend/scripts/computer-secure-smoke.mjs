import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { BrowserService } from '../dist/browser/browser.service.js';
import { ExecutionService } from '../dist/execution/execution.service.js';
import { X11Computer } from '../dist/agent/x11-computer.js';
import { LoginBrowser } from '../dist/login/login-browser.js';
import { EventsService } from '../dist/events/events.service.js';

// Run in the existing dev service with no concurrent desktop interaction.
assert.equal(process.env.PAL_EXECUTION_ID, 'pal-dev-split-execution');
const config = new ConfigService({ ...process.env, PAL_DESKTOP_ENABLED: true });
const execution = new ExecutionService(config);
const taskId = randomUUID(),
  workerId = randomUUID();
const browser = new BrowserService(
  config,
  {
    details: async () => ({
      title: 'Computer secure-fill acceptance',
      status: 'in-progress',
    }),
  },
  new EventsService(),
  execution,
);
const computer = new X11Computer(execution);
const login = new LoginBrowser();
const origin = 'https://pal-computer.example.test';
let context;
const waitFor = async (read) => {
  const deadline = Date.now() + 10000;
  do {
    const result = await read().catch(() => undefined);
    if (result) return result;
    await delay(100);
  } while (Date.now() < deadline);
  throw Error('Acceptance condition timed out');
};
const navigate = async (path) => {
  await computer.press(['Control_L', 'l']);
  await computer.type(origin + path);
  await computer.press('Return');
  return waitFor(async () => {
    const p = await browser.selectedPage(taskId, workerId);
    return p.url() === origin + path && (await p.locator('#user').count())
      ? p
      : undefined;
  });
};
try {
  await browser.prepareComputer(taskId, workerId);
  const initial = await browser.selectedPage(taskId, workerId);
  context = initial.context();
  await context.route(origin + '/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Computer fill fixture</title><form><input id="user" autocomplete="username"><input id="pass" type="password" autocomplete="current-password"></form><input id="otp" autocomplete="one-time-code"><a href="/popup" target="_blank">Popup</a>',
    }),
  );
  const first = await navigate('/first');
  await computer.press(['Control_L', 't']);
  await waitFor(async () => {
    const p = await browser.selectedPage(taskId, workerId);
    return p !== first ? p : undefined;
  });
  const second = await navigate('/second');
  assert.notEqual(first, second);
  const inspection = await login.inspect(second, workerId);
  const fields = {
    username:
      inspection.inputs.find((x) => x.autocomplete === 'username')?.ref ??
      inspection.inputs[0].ref,
    password:
      inspection.inputs.find((x) => x.type === 'password')?.ref ??
      inspection.inputs[1].ref,
  };
  await login.fill(second, workerId, fields, {
    username: 'SYNTHETIC_USER',
    password: 'SYNTHETIC_PASSWORD',
  });
  assert.equal(await second.locator('#user').inputValue(), 'SYNTHETIC_USER');
  assert.equal(await first.locator('#user').inputValue(), '');
  await computer.press(['Control_L', 'Shift_L', 'Tab']);
  assert.equal(await browser.selectedPage(taskId, workerId), first);
  await assert.rejects(
    login.fill(first, workerId, fields, { password: 'WRONG_TAB' }),
  );
  // Fixture opens a real popup; verify native extension adoption and active binding.
  await first.evaluate(() => window.open('/popup', '_blank'));
  const popup = await waitFor(async () => {
    const p = await browser.selectedPage(taskId, workerId);
    return p.url() === origin + '/popup' ? p : undefined;
  });
  const code = await login.inspect(popup, workerId);
  const otp =
    code.inputs.find((x) => x.autocomplete === 'one-time-code') ??
    code.inputs[2];
  await login.fill(popup, workerId, { code: [otp.ref] }, { code: '731946' });
  assert.equal(await popup.locator('#otp').inputValue(), '731946');
  assert.ok(!JSON.stringify(inspection.inputs).includes('SYNTHETIC_PASSWORD'));
  browser.releaseComputer(taskId, workerId);
  await browser.prepareComputer(taskId, workerId);
  assert.equal(await browser.selectedPage(taskId, workerId), popup);
  console.log(
    JSON.stringify({
      passed: true,
      navigation: 'computer keyboard',
      newTab: true,
      tabSwitch: true,
      popup: true,
      privateCredentials: true,
      privateCode: true,
      wrongTabRejected: true,
      continuation: true,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      owned: (await browser.groups())
        .filter((g) => g.taskId === taskId)
        .map((g) => ({
          sessions: g.computerSessions,
          tabs: g.tabs.map((t) => ({
            active: t.active,
            owned: t.sessionId === 'worker-' + workerId,
            url: t.url?.startsWith(origin) ? t.url : 'other',
          })),
        })),
    }),
  );
  throw error;
} finally {
  await context?.unroute(origin + '/**');
  await browser.closeGroup(taskId);
  assert.ok(!(await browser.groups()).some((g) => g.taskId === taskId));
  browser.onModuleDestroy();
  await browser.browser?.close();
  await execution.sandbox._stop();
}
