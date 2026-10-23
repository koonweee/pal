import { LoginService } from '../dist/login/login.service.js';
import {
  ExecutionService,
  ExecutionFileError,
} from '../dist/execution/execution.service.js';
import { LocalFilesystem, LocalSandbox } from '@mastra/core/workspace';
import { DestinationService } from '../dist/delivery/destination.service.js';
import { InstanceSettingsService } from '../dist/instance-settings/instance-settings.service.js';
import 'reflect-metadata';
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DatabaseService } from '../dist/database/database.service.js';
import { configureApp } from '../dist/config/configure-app.js';
import { TasksService } from '../dist/tasks/tasks.service.js';
import type { AgentRuntime } from '../dist/agent/agent-runtime.js';
import { AGENT_RUNTIME } from '../dist/agent/agent-runtime.js';
import { FilesService } from '../dist/files/files.service.js';
import { PreferencesService } from '../dist/preferences/preferences.service.js';
import { ChatService } from '../dist/chat/chat.service.js';
import { AgentActivityService } from '../dist/agent/agent-activity.service.js';
import { BrowserService } from '../dist/browser/browser.service.js';
import { McpService } from '../dist/mcp/mcp.service.js';
import { AgentAdmissionService } from '../dist/mcp/agent-admission.service.js';
import type { UserVisibleMessage } from '../dist/chat/chat.types.js';
import type { PalEvent } from '../dist/events/events.types.js';

interface TestRuntimeDependencies {
  chat: ChatService;
  activity: AgentActivityService;
  tasks: TasksService;
  config: Record<string, unknown>;
  mcp: McpService;
  admission: AgentAdmissionService;
  browser: BrowserService;
  login: LoginService;
  files: FilesService;
  preferences: PreferencesService;
  destinations: DestinationService;
  instanceSettings: InstanceSettingsService;
  execution: ExecutionService;
}

export async function startTestApp(
  options: {
    runtimeFactory?: (dependencies: TestRuntimeDependencies) => AgentRuntime;
    config?: Record<string, unknown>;
  } = {},
) {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://pal:pal@localhost:5433/pal_test';
  if (!new URL(url).pathname.endsWith('_test'))
    throw new Error('Test database name must end in _test');
  const pendingReplies = new Set<Promise<void>>();
  const uploads = await mkdtemp(join(tmpdir(), 'pal-test-'));
  process.env.DATABASE_URL = url;
  process.env.PAL_UPLOAD_DIR = uploads;
  const sandbox = new LocalSandbox({
    workingDirectory: uploads,
    isolation: 'none',
  });
  const execution = {
    home: uploads,
    filesystem: new LocalFilesystem({ basePath: uploads, contained: true }),
    sandbox: Object.assign(sandbox, {
      async writeFiles(files: { path: string; content: string | Buffer }[]) {
        for (const file of files) {
          await mkdir(join(file.path, '..'), { recursive: true });
          await writeFile(file.path, file.content);
        }
      },
    }),
    async readFile(path: string, limit: number) {
      if (!(await stat(path)).isFile())
        throw new ExecutionFileError('not_file');
      const data = await readFile(path);
      if (data.length > limit) throw new ExecutionFileError('too_large');
      return data;
    },
  } as unknown as ExecutionService;
  const { AppModule } = await import('../dist/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ExecutionService)
    .useValue(execution)
    .overrideProvider(ConfigService)
    .useValue(
      new ConfigService({
        DATABASE_URL: url,
        PAL_UPLOAD_DIR: uploads,
        PORT: 3000,
        HOST: '127.0.0.1',
        PAL_RELEASE_ID: 'development',
        PAL_TELEGRAM_BOT_TOKEN: '',
        PAL_TELEGRAM_OWNER_ID: '',
        PAL_NOTIFICATION_DESTINATIONS: [],
        ...options.config,
      }),
    )
    .overrideProvider(AGENT_RUNTIME)
    .useFactory({
      inject: [
        ChatService,
        AgentActivityService,
        TasksService,
        McpService,
        AgentAdmissionService,
        BrowserService,
        LoginService,
        FilesService,
        PreferencesService,
        DestinationService,
        InstanceSettingsService,
      ],
      factory: (
        chat: ChatService,
        activity: AgentActivityService,
        tasks: TasksService,
        mcp: McpService,
        admission: AgentAdmissionService,
        browser: BrowserService,
        login: LoginService,
        files: FilesService,
        preferences: PreferencesService,
        destinations: DestinationService,
        instanceSettings: InstanceSettingsService,
      ) =>
        options.runtimeFactory
          ? options.runtimeFactory({
              chat,
              activity,
              tasks,
              config: {
                DATABASE_URL: url,
                PAL_UPLOAD_DIR: uploads,
              },
              mcp,
              admission,
              browser,
              login,
              files,
              preferences,
              destinations,
              instanceSettings,
              execution,
            })
          : {
              async submit(message: UserVisibleMessage) {
                activity.setWorking(true);
                const reply = setTimeout(30)
                  .then(async () => {
                    await chat.publish({
                      role: 'assistant',
                      text: `Test reply: ${message.text}`,
                      taskId: message.taskId ?? undefined,
                      phase: 'final_answer',
                    });
                    activity.setWorking(false);
                  })
                  .finally(() => pendingReplies.delete(reply));
                pendingReplies.add(reply);
              },
            },
    })
    .compile();
  const database = module.get(DatabaseService);
  await migrate(database.db, { migrationsFolder: './migrations' });
  const reset = async () => {
    // Detached fake replies must settle before truncation or connection shutdown.
    await Promise.all(pendingReplies);
    module.get(AgentActivityService).reset();
    await database.pool.query(
      'TRUNCATE login_sites, web_push_installations, instance_settings, native_installations, notification_intents, preference_revisions, preferences, message_attachments, messages, tasks, attachments, idempotency, mcp_servers RESTART IDENTITY CASCADE',
    );
  };
  await reset();
  const app = module.createNestApplication({ forceCloseConnections: true });
  app.useLogger(false);
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return {
    app,
    database,
    uploads,
    reset,
    url: await app.getUrl(),
    close: async () => {
      await Promise.all(pendingReplies);
      await app.close();
      await rm(uploads, { recursive: true, force: true });
    },
  };
}
export async function until(
  predicate: () => boolean | Promise<boolean>,
  timeout = 3000,
) {
  const end = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error('Timed out waiting for condition');
    await setTimeout(10);
  }
}
export async function openStream(url: string) {
  const controller = new AbortController();
  const response = await fetch(url + '/stream', { signal: controller.signal });
  if (!response.ok || !response.body) throw new Error('SSE connection failed');
  const events: PalEvent[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const reading = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        pending += decoder.decode(value, { stream: true });
        const blocks = pending.split('\n\n');
        pending = blocks.pop() ?? '';
        for (const block of blocks) {
          const data = block
            .split('\n')
            .find((line) => line.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)) as PalEvent);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();
  return {
    events,
    close: async () => {
      controller.abort();
      await reading;
    },
  };
}
