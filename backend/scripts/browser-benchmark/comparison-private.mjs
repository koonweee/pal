import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Module } from '/opt/pal/node_modules/@nestjs/common/index.js';
import { NestFactory } from '/opt/pal/node_modules/@nestjs/core/index.js';
import { ConfigService } from '/opt/pal/node_modules/@nestjs/config/dist/index.js';
import { migrate } from '/opt/pal/node_modules/drizzle-orm/node-postgres/migrator.js';
import { DatabaseService } from '/opt/pal/dist/database/database.service.js';
import { LoginRepository } from '/opt/pal/dist/login/login.repository.js';
import { LoginService } from '/opt/pal/dist/login/login.service.js';
import { FirstPartyLoginController } from '/opt/pal/dist/adapters/first-party/login.controller.js';
import { configureApp } from '/opt/pal/dist/config/configure-app.js';
import { comparisonSecrets } from './comparison-cases.mjs';

// Synthetic values cross the real private HTTP controller and shared login code.
// Live samples use the production service so its existing PWA card remains usable.
export async function comparisonPrivate(
  runtime,
  task,
  android,
  database,
  synthetic,
  emit,
  assisted = false,
  humanWaitSeconds = 900,
  signal,
) {
  const notifications = [],
    fills = [],
    items = [];
  let app, db, repository, service, originalNotify;
  if (synthetic) {
    const url = new URL(runtime.config.getOrThrow('DATABASE_URL'));
    url.pathname = '/' + database;
    db = new DatabaseService(new ConfigService({ DATABASE_URL: url.href }));
    await migrate(db.db, { migrationsFolder: '/opt/pal/migrations' });
    await db.pool.query('INSERT INTO tasks(id,title,goal) VALUES($1,$2,$3)', [
      task.id,
      'UI comparison',
      'Synthetic sign-in',
    ]);
    repository = new LoginRepository(db);
    const vault = {
      configured: true,
      matching: async () => structuredClone(items),
      cards: async () => [],
      save: async (origin, input) => {
        let item = items.find((i) => i.id === input.accountId);
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
        return item.id;
      },
    };
    service = new LoginService(
      runtime.browser,
      vault,
      repository,
      { publish() {} },
      runtime.tasks,
      { publish: async () => {} },
      android,
    );
    service.bindNotifier(async (_id, text) => notifications.push(text));
    class PrivateModule {}
    Module({
      controllers: [FirstPartyLoginController],
      providers: [{ provide: LoginService, useValue: service }],
    })(PrivateModule);
    app = await NestFactory.create(PrivateModule, { logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
  } else {
    service = runtime.login;
    repository = service.repository;
    originalNotify = service.notify;
    service.notify = async (id, text) =>
      id === task.id ? notifications.push(text) : originalNotify?.(id, text);
  }
  let humanWaitMs = 0;
  return {
    service,
    fills,
    get humanWaitMs() {
      return humanWaitMs;
    },
    async continue() {
      const rows = (await repository.active()).filter(
        (row) => row.taskId === task.id && row.status === 'pending',
      );
      if (!rows.length) return null;
      if (!synthetic) {
        const reason =
          rows[0].kind === 'code'
            ? 'verification-code'
            : rows[0].chooseAccount
              ? 'account-choice'
              : 'private-credentials';
        if (!assisted) return { needsHuman: true, reason };
        const row = rows[0],
          start = Date.now();
        emit('human.wait.start', { reason, requestId: row.id });
        let current;
        while (
          !signal?.aborted &&
          Date.now() - start < humanWaitSeconds * 1000
        ) {
          current = await repository.current(row.id);
          if (!['pending', 'updating'].includes(current.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        humanWaitMs += Date.now() - start;
        emit('human.wait.end', {
          ms: Date.now() - start,
          status: current?.status,
        });
        if (current?.status !== 'filled')
          return { needsHuman: true, reason: 'private-entry-unresolved' };
        const roles = row.kind === 'code' ? ['code'] : Object.keys(row.fields);
        fills.push(...roles);
        emit('private.fill', { roles, source: 'private-http-human' });
        return {
          message: `Secure entry request ${row.id} is filled. Continue the existing owned session, verify the current stage and complete the requested read-only check.`,
        };
      }
      if (rows.length !== 1) throw Error('Expected one private stage');
      const row = rows[0],
        roles = row.kind === 'code' ? ['code'] : Object.keys(row.fields);
      const body =
        row.kind === 'code'
          ? { code: comparisonSecrets.code }
          : {
              label: 'Synthetic comparison',
              ...Object.fromEntries(
                roles.map((role) => [role, comparisonSecrets[role]]),
              ),
            };
      const start = Date.now();
      const response = await fetch(
        (await app.getUrl()) +
          '/login/requests/' +
          row.id +
          (row.kind === 'code' ? '/code' : '/save'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const value = await response.json();
      if (!response.ok || value.status !== 'filled')
        throw Error('Private HTTP fill failed');
      fills.push(...roles);
      emit('private.fill', {
        roles,
        source: 'private-http',
        ms: Date.now() - start,
      });
      for (
        let attempt = 0;
        attempt < 30 &&
        !notifications.some(
          (text) => text.includes(row.id) && text.includes('is filled'),
        );
        attempt++
      ) {
        await service.flushNotifications();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const notification = notifications
        .splice(0)
        .find((text) => text.includes(row.id) && text.includes('is filled'));
      if (!notification) throw Error('Private continuation missing');
      return { message: notification };
    },
    async close() {
      try {
        for (const row of (await repository.active()).filter(
          (row) => row.taskId === task.id,
        ))
          await service.finish(row.id);
      } finally {
        if (!synthetic) service.notify = originalNotify;
        else {
          service.onModuleDestroy();
          try {
            await app?.close();
            await db.pool.query('DELETE FROM tasks WHERE id=$1', [task.id]);
          } finally {
            await db.onApplicationShutdown();
            items.length = 0;
          }
        }
      }
    },
  };
}
