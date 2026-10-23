import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Run inside the development agent-service: node --input-type=module < this-file.
// Uses two temporary worker tabs; leaves the persistent browser and other tabs running.
assert.equal(process.env.PAL_EXECUTION_ID, 'pal-dev-split-execution');
const load = (path) => import(pathToFileURL(resolve('dist/' + path)).href);
const { ExecutionService } = await load('execution/execution.service.js');
const { BrowserService } = await load('browser/browser.service.js');
const { LoginBrowser } = await load('login/login-browser.js');
const { EventsService } = await load('events/events.service.js');
const config = new ConfigService({ ...process.env, PAL_DESKTOP_ENABLED: true });
const execution = new ExecutionService(config);
const id = randomUUID(),
  first = randomUUID(),
  second = randomUUID();
const tasks = {
  details: async (taskId) => ({
    id: taskId,
    title: 'Login acceptance',
    status: 'in-progress',
    archived: false,
  }),
};
const service = new BrowserService(
  config,
  tasks,
  new EventsService(),
  execution,
);
const inspector = new LoginBrowser();
const command = async (worker) => {
  const result = await service.command(
    id,
    ['open', 'about:blank'],
    undefined,
    worker,
  );
  assert.ok(result.success, 'Could not open synthetic worker tab');
};
try {
  await command(first);
  await command(second);
  const a = await service.selectedPage(id, first),
    b = await service.selectedPage(id, second);
  assert.notEqual(a, b);
  for (const page of [a, b]) {
    await page.route('https://pal-login.example.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<form><input id="user" autocomplete="username"><input id="pass" type="password" autocomplete="current-password"><button>Sign in</button></form><textarea id="comment"></textarea>',
      }),
    );
    await page.goto('https://pal-login.example.test/');
  }
  const result = await inspector.inspect(a, first);
  assert.equal(result.targets.length, 1);
  const reference = result.targets[0].loginRef;
  await assert.rejects(
    inspector.fill(b, first, reference, { password: 'dummy' }),
  );
  await assert.rejects(
    inspector.fill(a, second, reference, { password: 'dummy' }),
  );
  const filled = await inspector.fill(a, first, reference, {
    username: 'SYNTHETIC_USER',
    password: 'SYNTHETIC_PASSWORD',
  });
  assert.equal(await a.locator('#pass').inputValue(), 'SYNTHETIC_PASSWORD');
  assert.equal(await b.locator('#pass').inputValue(), '');
  assert.equal(await a.locator('#comment').inputValue(), '');
  assert.ok(
    !JSON.stringify({ targets: result.targets, filled }).includes('SYNTHETIC'),
  );
  console.log(
    'PASS real execution Chrome: pinned worker tabs, deterministic inspection, private fill, unrelated fields untouched, secret-free results',
  );
} finally {
  await service.closeGroup(id).catch(() => {});
  service.onModuleDestroy();
  await service.browser?.close();
  await execution.sandbox._stop();
}
