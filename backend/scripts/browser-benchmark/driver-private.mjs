import { randomUUID } from 'node:crypto';
import { DatabaseService } from '/opt/pal/dist/database/database.service.js';
import { LoginRepository } from '/opt/pal/dist/login/login.repository.js';
import { LoginService } from '/opt/pal/dist/login/login.service.js';
import { loginTools } from '/opt/pal/dist/login/login-tools.js';
import { PARENT_TASK_ID, WORKER_ID } from '/opt/pal/dist/agent/task-workers.js';
import { migrate } from '/opt/pal/node_modules/drizzle-orm/node-postgres/migrator.js';
import { driverSecrets } from './driver-cases.mjs';

// Production login business logic, isolated persistence, and an in-memory vault.
// Synthetic user submissions never pass through model context.
export async function privateFixture(runtime, task, fixture, scenario) {
  const connection = new URL(runtime.config.getOrThrow('DATABASE_URL'));
  connection.pathname = '/pal_cua_comparison_test';
  const db = new DatabaseService({
    getOrThrow: (key) => {
      if (key !== 'DATABASE_URL') throw Error('Unexpected config key');
      return connection.href;
    },
  });
  try {
    await migrate(db.db, { migrationsFolder: '/opt/pal/migrations' });
    await db.pool.query('INSERT INTO tasks(id,title,goal) VALUES($1,$2,$3)', [
      task.id,
      'Cua comparison',
      scenario.id,
    ]);
  } catch (error) {
    await db.onApplicationShutdown();
    throw error;
  }
  const items = [];
  const vault = {
    configured: true,
    matching: async () => structuredClone(items),
    cards: async () => [],
    save: async (origin, input) => {
      let item = input.accountId
        ? items.find((i) => i.id === input.accountId)
        : undefined;
      if (!item) {
        item = {
          id: randomUUID(),
          type: 1,
          name: 'Synthetic comparison',
          login: { uris: [{ uri: origin, match: 1 }] },
        };
        items.push(item);
      }
      for (const role of ['username', 'password'])
        if (input[role] !== undefined) item.login[role] = input[role];
      fixture.state.accounts = items.length;
      return item.id;
    },
  };
  const repository = new LoginRepository(db);
  const service = new LoginService(
    runtime.browser,
    vault,
    repository,
    { publish() {} },
    {
      details: async () => ({ ...task, status: 'in-progress' }),
      update: async () => {},
    },
    { publish: async () => {} },
    runtime.android,
  );
  const tools = loginTools(service);
  const pending = [];
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute.bind(tool);
    tool.execute = async (args, context) => {
      if (name === 'inspect_private_fields') {
        const workerId = context?.requestContext?.get(WORKER_ID);
        const parentTaskId = context?.requestContext?.get(PARENT_TASK_ID);
        if (typeof workerId === 'string')
          service.activateSurface(
            typeof parentTaskId === 'string' ? parentTaskId : task.id,
            workerId,
            scenario.packageName ? 'android' : 'browser',
          );
      }
      const result = await execute(args, context);
      if (result?.status !== 'awaiting_user' || !result.requestId)
        return result;
      const row = await repository.current(result.requestId);
      const submit = async () => {
        if (row.kind === 'code') {
          fixture.state.roles.push('code');
          await service.submitCode(row.id, driverSecrets.code);
        } else if (row.kind === 'card') {
          await service.submitCard(row.id, {
            ...driverSecrets,
            cardholderName: 'Synthetic Customer',
            expMonth: '12',
            expYear: '2029',
            username: undefined,
            password: undefined,
            code: undefined,
          });
        } else {
          const roles = ['username', 'password'].filter(
            (role) => row.fields?.[role],
          );
          fixture.state.roles.push(...roles);
          await service.finish(row.id, {
            label: 'Synthetic comparison',
            ...Object.fromEntries(
              roles.map((role) => [role, driverSecrets[role]]),
            ),
          });
        }
        const current = await repository.current(row.id);
        await repository.notified(row.id, current.status);
        return current.status;
      };
      if (scenario.resume) {
        pending.push({ id: row.id, submit });
        fixture.state.pauses++;
        return result;
      }
      const status = await submit();
      return {
        status,
        requestId: row.id,
        message:
          status === 'filled'
            ? 'Synthetic user completed private entry. Continue with the known next action; values are already filled.'
            : 'Synthetic user saved private entry. Inspect and fill the saved account before continuing.',
      };
    };
  }
  return {
    tools,
    service,
    async checkCancellation() {
      const workerId = randomUUID();
      try {
        await runtime.browser.command(
          task.id,
          ['tab', 'new', fixture.origin + '/code'],
          undefined,
          workerId,
        );
        const inspection = await service.inspect(task.id, workerId);
        const request = await service.request(
          task.id,
          { code: inspection.inputs.map((input) => input.ref) },
          workerId,
        );
        await service.finish(request.requestId);
        await service.submitCode(request.requestId, driverSecrets.code);
        const page = await runtime.browser.selectedPage(task.id, workerId);
        const empty = await page
          .locator('input')
          .evaluateAll((inputs) => inputs.every((input) => input.value === ''));
        const row = await repository.current(request.requestId);
        const resume = await service.resumeWorker(
          task.id,
          `secure entry request ${row.id}`,
        );
        return row.status === 'cancelled' && empty && resume === undefined;
      } finally {
        await runtime.browser.closeSession(task.id, workerId);
      }
    },
    async resume() {
      const entry = pending.shift();
      if (!entry) return;
      const status = await entry.submit();
      return `Private entry ${status} for secure entry request ${entry.id}. Delegate a fresh interaction assignment referencing that exact request to continue its existing browser session. ${status === 'filled' ? 'Values are already filled; proceed with the known next action' : 'Inspect and fill the saved account'} and verify completion.`;
    },
    async close() {
      service.onModuleDestroy();
      try {
        await db.pool.query('DELETE FROM tasks WHERE id=$1', [task.id]);
      } finally {
        await db.onApplicationShutdown();
      }
    },
  };
}
