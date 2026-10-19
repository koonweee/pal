import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const connectionString =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pal:pal@localhost:5433/pal_test';
if (!new URL(connectionString).pathname.endsWith('_test'))
  throw new Error('Preference smoke database name must end in _test');

const directory = await mkdtemp(join(tmpdir(), 'pal-preference-smoke-'));
const uploads = join(directory, 'uploads');
const workspace = join(directory, 'workspace');
await Promise.all([mkdir(uploads), mkdir(workspace)]);
Object.assign(process.env, {
  DATABASE_URL: connectionString,
  PAL_UPLOAD_DIR: uploads,
  PAL_AGENT_WORKING_DIR: workspace,
  PAL_DESKTOP_ENABLED: 'false',
});

async function resetDatabase() {
  const pool = new Pool({ connectionString });
  try {
    await pool.query(
      'TRUNCATE preference_revisions, preferences, message_attachments, messages, tasks, attachments, idempotency, mcp_servers RESTART IDENTITY CASCADE',
    );
    await pool.query('DROP SCHEMA IF EXISTS mastra CASCADE');
  } finally {
    await pool.end();
  }
}

const migrationPool = new Pool({ connectionString });
try {
  await migrate(drizzle(migrationPool), { migrationsFolder: './migrations' });
} finally {
  await migrationPool.end();
}
await resetDatabase();

const [
  { AppModule },
  { AgentActivityService },
  { ChatCoordinatorService },
  { ChatService },
  { PreferencesService },
  { TasksService },
] = await Promise.all([
  import('../dist/app.module.js'),
  import('../dist/agent/agent-activity.service.js'),
  import('../dist/application/chat-coordinator.service.js'),
  import('../dist/chat/chat.service.js'),
  import('../dist/preferences/preferences.service.js'),
  import('../dist/tasks/tasks.service.js'),
]);

let application;
const deadline = globalThis.setTimeout(() => {
  console.error('Preference smoke timed out after 600 seconds');
  process.exit(1);
}, 600_000);

async function waitFor(check, timeout = 180_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await setTimeout(100);
  }
  throw new Error('Timed out waiting for the agent response');
}

try {
  application = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const activity = application.get(AgentActivityService);
  const coordinator = application.get(ChatCoordinatorService);
  const chat = application.get(ChatService);
  const preferences = application.get(PreferencesService);
  const tasks = application.get(TasksService);

  async function send(text, taskId) {
    const { messageId } = await coordinator.send({
      text,
      taskId,
      idempotencyKey: randomUUID(),
      attachmentIds: [],
    });
    const input = await chat.get(messageId);
    let observed = [];
    let response;
    try {
      response = await waitFor(async () => {
        const history = await chat.history({ taskId, limit: 20 });
        observed = history.messages.filter(
          (message) => message.sequence > input.sequence,
        );
        return observed.find(
          (message) =>
            message.role === 'assistant' && message.phase === 'final_answer',
        );
      });
    } catch {
      throw new Error(
        `Timed out waiting for the agent response; activity=${activity.current().status}; messages=${JSON.stringify(
          observed.map(({ role, phase, text }) => ({ role, phase, text })),
        )}`,
      );
    }
    return { input, response };
  }

  const suffix = randomUUID().slice(0, 8);
  console.log(
    'Declared real-runtime attempts: Main learning, current Task lookup, and one-off exception. One attempt each.',
  );

  const learned = await send(
    `I always prefer aisle seats for personal flights. Remember this durable preference. Fixture ${suffix}.`,
  );
  const flight = (await preferences.search({ limit: 20 })).preferences.find(
    (preference) => preference.sourceMessageIds.includes(learned.input.id),
  );
  assert(flight, 'Main did not persist the source-backed preference');
  console.log('PASS: Main saved a preference through MastraAgentRuntime');

  const corrected = await preferences.update(
    flight.id,
    {
      expectedVersion: flight.version,
      statement: 'Prefers window seats for personal flights.',
      reason: 'Corrected through the human management path.',
    },
    { actor: 'human' },
  );
  const task = await tasks.create({
    title: `Preference smoke ${suffix}`,
    goal: 'Choose the preferred flight seat',
  });
  const selected = await send(
    `Choose an aisle or window seat for my next personal flight using my current saved preference. Fixture ${suffix}. Give only the choice and a short reason.`,
    task.id,
  );
  assert.match(selected.response.text, /window/i);
  console.log('PASS: Task used the current shared preference');

  const exception = await send(
    `For this trip only, choose an aisle seat even though my durable default is different. Fixture ${suffix}. Do not change the durable preference.`,
    task.id,
  );
  assert.match(exception.response.text, /aisle/i);
  assert.equal(
    (await preferences.get(corrected.id)).statement,
    'Prefers window seats for personal flights.',
  );
  console.log('PASS: one-off exception left the durable preference unchanged');
} catch (error) {
  console.error(
    'Preference smoke failed:',
    error instanceof Error ? `${error.name}: ${error.message}` : error,
  );
  process.exitCode = 1;
} finally {
  await application?.close().catch(() => {});
  await resetDatabase().catch(() => {});
  await rm(directory, { recursive: true, force: true });
  globalThis.clearTimeout(deadline);
}
