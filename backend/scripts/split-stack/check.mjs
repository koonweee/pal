import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { ExecutionService } from './dist/execution/execution.service.js';
import { BrowserService } from './dist/browser/browser.service.js';
import { EventsService } from './dist/events/events.service.js';
import { X11Computer } from './dist/agent/x11-computer.js';

const config = new ConfigService({
  ...process.env,
  PAL_DESKTOP_ENABLED: true,
});
const execution = new ExecutionService(config);
const smokeUrl = process.env.PAL_SMOKE_BROWSER_URL ?? 'https://example.com';
const smokeTitle = process.env.PAL_SMOKE_BROWSER_TITLE ?? 'Example Domain';
const browser = new BrowserService(
  config,
  {
    details: async () => ({
      title: 'Split runtime check',
      status: 'in-progress',
      archived: false,
    }),
  },
  new EventsService(),
  execution,
);
try {
  const opened = await browser.command('split-check', ['open', smokeUrl]);
  assert.equal(opened.success, true, JSON.stringify(opened));
  const title = await browser.command('split-check', ['get', 'title']);
  assert.equal(title.success, true, JSON.stringify(title));
  assert.ok(
    JSON.stringify(title.data).includes(smokeTitle),
    JSON.stringify(title.data),
  );
  const screenshot = await browser.screenshot('split-check', false);
  assert.equal(
    Buffer.from(screenshot.data, 'base64').subarray(1, 4).toString(),
    'PNG',
  );
  const computer = new X11Computer(execution);
  assert.deepEqual(await computer.getScreenSize(), {
    width: 1200,
    height: 900,
  });
  await computer.moveMouse(321, 232);
  assert.deepEqual(await computer.getCursorPosition(), { x: 321, y: 232 });
  await browser.command('split-check', [
    'eval',
    'document.body.innerHTML = "<input id=fixture>"; document.getElementById("fixture").focus();',
  ]);
  await computer.type('Split café');
  await computer.press('End');
  let typed;
  const deadline = Date.now() + 5000;
  do {
    typed = await browser.command('split-check', [
      'eval',
      'document.getElementById("fixture").value',
    ]);
    if (JSON.stringify(typed.data).includes('Split café')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.match(JSON.stringify(typed.data), /Split café/);
  const desktop = await computer.screenshot();
  assert.equal(desktop.data.subarray(1, 4).toString(), 'PNG');
  await browser.command(
    'split-check',
    ['open', smokeUrl],
    undefined,
    'split-worker',
  );
  let groups = await browser.groups();
  assert.equal(
    groups.filter((group) => group.taskId === 'split-check').length,
    1,
  );
  await browser.closeSession('split-check', 'split-worker');
  groups = await browser.groups();
  assert(
    groups.find((group) => group.taskId === 'split-check')?.tabs?.length > 0,
  );
  await browser.closeGroup('split-check');
  console.log(
    'PASS: public browser navigation, task/worker grouping, browser screenshot, and native desktop screenshot across the container boundary',
  );
} finally {
  await browser.shutdown();
  await execution.sandbox._stop();
}
