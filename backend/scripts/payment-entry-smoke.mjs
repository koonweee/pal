import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { ConfigService } from '@nestjs/config';

// Create pal_payment_smoke_test on dev PostgreSQL first; drop it after this script.
// Run through stdin in dev agent-service. Isolated test database on dev PostgreSQL and real execution Chrome;
// synthetic HTTPS checkout and local Vault Management API. Never touches the real vault.
assert.equal(process.env.PAL_EXECUTION_ID, 'pal-dev-split-execution');
const { ExecutionService } = await import(
  './dist/execution/execution.service.js'
);
const { BrowserService } = await import('./dist/browser/browser.service.js');
const { EventsService } = await import('./dist/events/events.service.js');
const { DatabaseService } = await import('./dist/database/database.service.js');
const { LoginRepository } = await import('./dist/login/login.repository.js');
const { LoginService } = await import('./dist/login/login.service.js');
const { BitwardenService } = await import('./dist/login/bitwarden.service.js');
const testUrl = new URL(process.env.DATABASE_URL);
testUrl.pathname = '/pal_payment_smoke_test';
const config = new ConfigService({
  ...process.env,
  DATABASE_URL: testUrl.href,
  PAL_DESKTOP_ENABLED: true,
});
const taskId = randomUUID(),
  workerId = randomUUID();
const synthetic = {
  cardholderName: 'Synthetic Customer',
  number: '4242424242424242',
  expMonth: '12',
  expYear: '2029',
  securityCode: '765',
};
const items = [
  { id: randomUUID(), type: 3, name: 'Synthetic card', card: { ...synthetic } },
];
let saves = 0;
const server = createServer(async (req, res) => {
  let data;
  if (req.url === '/sync') data = {};
  else if (req.url === '/list/object/items') data = { data: items };
  else if (req.url.startsWith('/list/object/items?')) data = { data: [] };
  else if (req.url === '/object/item' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    data = { ...JSON.parse(body), id: randomUUID() };
    items.push(data);
    saves++;
  } else {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ success: true, data }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
class SyntheticVault extends BitwardenService {
  get configured() {
    return true;
  }
  get endpoint() {
    return 'http://127.0.0.1:' + server.address().port;
  }
  async ensureReady() {}
}
const db = new DatabaseService(config),
  vault = new SyntheticVault(config),
  execution = new ExecutionService(config),
  events = new EventsService();
const outputs = [];
const tasks = {
  details: async () => ({
    id: taskId,
    title: 'Synthetic payment acceptance',
    status: 'in-progress',
    archived: false,
  }),
  update: async (_id, state) => outputs.push(state),
};
const browser = new BrowserService(config, tasks, events, execution);
const repository = new LoginRepository(db);
const service = new LoginService(browser, vault, repository, events, tasks, {
  publish: async (value) => outputs.push(value),
});
try {
  assert.equal(
    new URL(config.get('DATABASE_URL')).pathname,
    '/pal_payment_smoke_test',
  );
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(db.db, { migrationsFolder: './migrations' });
  await db.pool.query('INSERT INTO tasks(id,title,goal) VALUES($1,$2,$3)', [
    taskId,
    'Synthetic payment acceptance',
    'Temporary dev validation',
  ]);
  const opened = await browser.command(
    taskId,
    ['open', 'about:blank'],
    undefined,
    workerId,
  );
  assert.ok(opened.success);
  const page = await browser.selectedPage(taskId, workerId);
  await page.route('https://pal-payment.example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<input autocomplete="cc-name"><iframe src="https://pal-processor.example.test/number"></iframe><iframe src="https://pal-processor.example.test/security"></iframe><select autocomplete="cc-exp-month"><option value="">Month</option><option value="12">December</option></select><input autocomplete="cc-exp-year" maxlength="2"><button onclick="document.body.dataset.purchased=\'yes\'">Pay</button>',
    }),
  );
  await page.route('https://pal-processor.example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: route.request().url().endsWith('number')
        ? '<input autocomplete="cc-number">'
        : '<input autocomplete="cc-csc">',
    }),
  );
  await page.goto('https://pal-payment.example.test/');
  const inspect = async () => {
    const r = await service.inspect(taskId, workerId);
    outputs.push({ ...r, image: undefined });
    const ref = (a) => r.inputs.find((i) => i.autocomplete === a).ref;
    return {
      cardholderName: ref('cc-name'),
      number: ref('cc-number'),
      expMonth: ref('cc-exp-month'),
      expYear: ref('cc-exp-year'),
      securityCode: ref('cc-csc'),
    };
  };
  let fields = await inspect();
  const picker = await service.fill(taskId, fields, undefined, workerId);
  outputs.push(picker);
  const metadata = await service.get(picker.requestId);
  outputs.push(metadata);
  assert.equal(metadata.cards[0].lastFour, '4242');
  outputs.push(
    await service.submitCard(picker.requestId, { accountId: items[0].id }),
  );
  assert.equal(
    await page.frames()[1].locator('input').inputValue(),
    synthetic.number,
  );
  assert.equal(await page.locator('select').inputValue(), '12');
  assert.equal(
    await page.locator('[autocomplete="cc-exp-year"]').inputValue(),
    '29',
  );
  console.log(
    'PASS saved card: private picker, hosted frames, month dropdown and two-digit year',
  );
  const transient = await service.request(taskId, await inspect(), workerId);
  outputs.push(await service.submitCard(transient.requestId, { ...synthetic }));
  assert.equal(saves, 0);
  const saved = await service.request(taskId, await inspect(), workerId);
  outputs.push(
    await service.submitCard(saved.requestId, {
      ...synthetic,
      save: true,
      label: 'Saved synthetic',
    }),
  );
  outputs.push(
    await service.submitCard(saved.requestId, {
      ...synthetic,
      save: true,
      label: 'Saved synthetic',
    }),
  );
  assert.equal(saves, 1);
  console.log(
    'PASS new card: one-time entry and opt-in vault save; duplicate submit does not save twice',
  );
  fields = await inspect();
  const partial = await service.request(
    taskId,
    { securityCode: fields.securityCode },
    workerId,
  );
  outputs.push(
    await service.submitCard(partial.requestId, { securityCode: '876' }),
  );
  assert.equal(await page.frames()[2].locator('input').inputValue(), '876');
  console.log('PASS missing-details request: CVV-only private entry');
  const stale = await service.request(
    taskId,
    { securityCode: (await inspect()).securityCode },
    workerId,
  );
  await page.reload();
  assert.equal(
    (await service.submitCard(stale.requestId, { securityCode: '987' })).status,
    'updating',
  );
  const retry = await service.request(
    taskId,
    { securityCode: (await inspect()).securityCode },
    workerId,
  );
  assert.equal((await service.get(stale.requestId)).id, retry.requestId);
  outputs.push(
    await service.submitCard(retry.requestId, { securityCode: '987' }),
  );
  assert.equal(await page.locator('body').getAttribute('data-purchased'), null);
  outputs.push(
    (
      await db.pool.query('SELECT * FROM login_requests WHERE task_id=$1', [
        taskId,
      ])
    ).rows,
  );
  const serialized = JSON.stringify(outputs);
  assert.ok(!serialized.includes(synthetic.number));
  assert.ok(!serialized.includes(synthetic.cardholderName));
  console.log(
    'PASS stale recovery, secret-free outputs/persisted requests and no purchase submission',
  );
} finally {
  service.onModuleDestroy();
  vault.onModuleDestroy();
  await browser.closeGroup(taskId).catch(() => {});
  browser.onModuleDestroy();
  await browser.browser?.close();
  await execution.sandbox?._stop();
  await db.pool.query('DELETE FROM tasks WHERE id=$1', [taskId]);
  await db.onApplicationShutdown();
  await new Promise((resolve) => server.close(resolve));
  console.log(
    'CLEANUP synthetic task, request rows, inspection images, browser group and vault fixture',
  );
}
