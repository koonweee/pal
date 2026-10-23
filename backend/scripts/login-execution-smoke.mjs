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
  assert.equal(result.inputs.length, 2);
  const fields = {
    username: result.inputs[0].ref,
    password: result.inputs[1].ref,
  };
  await assert.rejects(inspector.fill(b, first, fields, { password: 'dummy' }));
  await assert.rejects(
    inspector.fill(a, second, fields, { password: 'dummy' }),
  );
  const filled = await inspector.fill(a, first, fields, {
    username: 'SYNTHETIC_USER',
    password: 'SYNTHETIC_PASSWORD',
  });
  assert.equal(await a.locator('#pass').inputValue(), 'SYNTHETIC_PASSWORD');
  assert.equal(await b.locator('#pass').inputValue(), '');
  assert.equal(await a.locator('#comment').inputValue(), '');
  assert.ok(
    !JSON.stringify({ inputs: result.inputs, filled }).includes('SYNTHETIC'),
  );
  await a.setContent(
    '<form>' +
      Array.from(
        { length: 6 },
        (_, i) => `<input type="tel" aria-label="Digit ${i + 1}">`,
      ).join('') +
      '</form>',
  );
  const code = await inspector.inspect(a, first);
  assert.equal(code.inputs.length, 6);
  const codeFilled = await inspector.fill(
    a,
    first,
    { code: code.inputs.map((input) => input.ref) },
    {
      code: '731946',
    },
  );
  assert.equal(
    await a
      .locator('input')
      .evaluateAll((es) => es.map((e) => e.value).join('')),
    '731946',
  );
  assert.ok(
    !JSON.stringify({ inputs: code.inputs, codeFilled }).includes('731946'),
  );
  console.log(
    'PASS real execution Chrome: verification digit group filled privately; pinned worker tabs, generic input extraction, private fill, unrelated fields untouched, secret-free results',
  );
} finally {
  await service.closeGroup(id).catch(() => {});
  service.onModuleDestroy();
  await service.browser?.close();
  await execution.sandbox._stop();
}
