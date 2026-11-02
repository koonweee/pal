import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DatabaseService } from '../dist/database/database.service.js';
import { EventsService } from '../dist/events/events.service.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import { TasksRepository } from '../dist/tasks/tasks.repository.js';
import { LoginRepository } from '../dist/login/login.repository.js';
import { LoginService } from '../dist/login/login.service.js';
import { BitwardenService } from '../dist/login/bitwarden.service.js';
import { AndroidService } from '../dist/android/android.service.js';
import { InteractionCoordinator } from '../dist/interaction/interaction-coordinator.js';
import { SharedBrowserService } from '../dist/browser/shared-browser.service.js';
import { ExecutionService } from '../dist/execution/execution.service.js';
import { interactionSession } from '../dist/agent/interaction-session.js';
import { createMainSession } from '../dist/agent/main-session.js';
import { chatgptModel } from '../dist/agent/chatgpt-model.js';
import { loadAgentInstructions } from '../dist/agent/agent-instructions.js';
import { validateEnvironment } from '../dist/config/configuration.js';

// scripts/dev-local owns the exclusive window. Never run beside the backend.
export async function interactionSmokeFixture(makeVault) {
  assert.equal(process.env.PAL_INTERACTION_SMOKE_EXCLUSIVE, '1');
  assert.equal(process.env.PAL_EXECUTION_ID, 'pal-dev-split-execution');
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(new URL(connectionString).pathname.endsWith('_test'));
  const config = new ConfigService({
    ...validateEnvironment(process.env),
    DATABASE_URL: connectionString,
  });
  const db = new DatabaseService(config);
  await migrate(db.db, { migrationsFolder: './migrations' });
  const events = new EventsService();
  const tasks = new TasksService(db, new TasksRepository(db), events);
  const coordinator = new InteractionCoordinator();
  const execution = new ExecutionService(config);
  const browser = new SharedBrowserService(config, execution);
  const android = new AndroidService(config, coordinator);
  // Ordinary acceptance never connects to the user's vault.
  const vault = makeVault
    ? makeVault(config)
    : new BitwardenService(
        new ConfigService({
          PAL_BITWARDEN_CLIENT_ID: '',
          PAL_BITWARDEN_CLIENT_SECRET: '',
          PAL_BITWARDEN_MASTER_PASSWORD: '',
        }),
      );
  const repository = new LoginRepository(db);
  const login = new LoginService(
    browser,
    vault,
    repository,
    events,
    tasks,
    { publish: async () => {} },
    android,
    coordinator,
  );
  const { worker, ...workspace } = await interactionSession(
    config,
    execution,
    browser,
    android,
    login,
    coordinator,
  );
  let session;
  return {
    db,
    tasks,
    coordinator,
    browser,
    android,
    login,
    repository,
    worker,
    async createSession(publish) {
      assert.ok(!session, 'One session per acceptance fixture');
      session = await createMainSession({
        ...workspace,
        connectionString,
        model: chatgptModel(
          config.getOrThrow('PAL_AGENT_MODEL'),
          config.getOrThrow('PAL_AGENT_AUTH_PATH'),
          config.getOrThrow('PAL_AGENT_THINKING_EFFORT'),
        ),
        onEvent: () => {},
        task: {
          instructions:
            (await loadAgentInstructions('task')) + '\n' + android.instructions,
          tools: {},
          publish,
          worker,
        },
      });
      return session;
    },
    async close() {
      login.onModuleDestroy();
      await session?.close();
      coordinator.shutdown();
      await android.onApplicationShutdown();
      await browser.shutdown();
      await execution.sandbox._stop();
      vault.onModuleDestroy();
      await db.onApplicationShutdown();
    },
  };
}
