import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { ExecutionService } from './dist/execution/execution.service.js';
import { SharedBrowserService } from './dist/browser/shared-browser.service.js';
import { X11Computer } from './dist/agent/x11-computer.js';
import { InteractionCoordinator } from './dist/interaction/interaction-coordinator.js';

const config = new ConfigService({ ...process.env, PAL_DESKTOP_ENABLED: true });
const execution = new ExecutionService(config);
const browser = new SharedBrowserService(config, execution);
const computer = new X11Computer(execution);
const coordinator = new InteractionCoordinator();
const id = coordinator.begin({ taskId: 'split-check', workerId: 'fixture' });
let created;
try {
  await coordinator.run('desktop', id, async () => {
    const initial = await browser.selectedPage('split-check', 'initial', true);
    // Fixture setup owns this exact page; failure cleanup cannot close user tabs.
    created = await initial.context().newPage();
    await created.bringToFront();
    await computer.press(['ctrl', 'l']);
    await computer.type(
      process.env.PAL_SMOKE_BROWSER_URL ?? 'https://example.com',
    );
    await computer.press('Return');
    const deadline = Date.now() + 15000;
    do {
      const selected = await browser.selectedPage(
        'split-check',
        'fixture',
        true,
      );
      assert.equal(selected, created);
      if (
        (await created.title()).includes(
          process.env.PAL_SMOKE_BROWSER_TITLE ?? 'Example Domain',
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(
      (await created.title()).includes(
        process.env.PAL_SMOKE_BROWSER_TITLE ?? 'Example Domain',
      ),
    );
    const screenshot = await computer.screenshot();
    assert.equal(screenshot.data.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual(await computer.getScreenSize(), {
      width: 1200,
      height: 900,
    });
    await computer.moveMouse(321, 232);
    assert.deepEqual(await computer.getCursorPosition(), { x: 321, y: 232 });
    await created.close();
  });
  console.log(
    'PASS: queued native desktop navigation, shared browser target, PNG, and fixture cleanup',
  );
} finally {
  try {
    await coordinator.run('desktop', id, async () => {
      if (created && !created.isClosed()) await created.close();
    });
  } finally {
    coordinator.finish(id);
  }
  coordinator.shutdown();
  await browser.shutdown();
  await execution.sandbox._stop();
}
