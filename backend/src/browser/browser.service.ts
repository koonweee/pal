import { execFile, spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, type Browser, type Worker } from 'playwright-core';
import type { Subscription } from 'rxjs';
import { EventsService } from '../events/events.service.js';
import { TasksService } from '../tasks/tasks.service.js';

export interface BrowserGroup {
  taskId: string;
  groupId: number;
  lastActivity: number;
  sessions?: string[];
  tabs?: {
    id: number;
    targetId?: string;
    url?: string;
    title?: string;
    sessionId?: string;
  }[];
}
type CliResult =
  | { success: true; data: Record<string, unknown>; error: null }
  | { success: false; data: Record<string, unknown> | null; error: string };
interface GroupRequest {
  action: 'get' | 'list' | 'group' | 'touch' | 'close' | 'close_session';
  taskId?: string;
  title?: string;
  targetId?: string;
  sessionId?: string;
}

@Injectable()
export class BrowserService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserService.name);
  private browser?: Browser;
  private connecting?: Promise<Browser>;
  private timer?: ReturnType<typeof setInterval>;
  private subscription?: Subscription;
  private readonly operations = new Map<string, number>();
  private activeTasks: () => string[] = () => [];
  private closing = false;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  get enabled() {
    return this.config.get<boolean>('PAL_DESKTOP_ENABLED') === true;
  }
  private get endpoint() {
    return `http://127.0.0.1:${this.config.get<number>('PAL_BROWSER_PORT') ?? 9222}`;
  }
  private identity(taskId: string, workerId?: string) {
    // Unix socket paths are limited; the worker UUID is globally unique.
    return workerId ? 'worker-' + workerId : taskId;
  }
  private session(taskId: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(taskId))
      throw new Error('A valid task browser identity is required');
    return 'pal-task-' + taskId;
  }

  bindActiveTasks(read: () => string[]) {
    this.activeTasks = read;
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.subscription = this.events.changes.subscribe((event) => {
      if (event.event === 'task.updated')
        void this.sweep().catch((error: unknown) => this.logger.warn(error));
    });
    this.timer = setInterval(() => {
      void this.sweep().catch((error: unknown) => this.logger.warn(error));
    }, 60_000);
    this.timer.unref();
  }

  private async connect(): Promise<Browser> {
    if (!this.enabled || this.closing)
      throw new Error('Browser control is unavailable');
    if (this.browser?.isConnected()) return this.browser;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        await fetch(this.endpoint + '/json/version', {
          signal: AbortSignal.timeout(1000),
        });
      } catch {
        const launcher = fileURLToPath(
          new URL('../../desktop/browser.sh', import.meta.url),
        );
        const child = spawn(launcher, ['about:blank'], {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            PAL_BROWSER_PORT: String(
              this.config.get<number>('PAL_BROWSER_PORT') ?? 9222,
            ),
            ...(this.config.get<string>('PAL_BROWSER_PROFILE')
              ? {
                  PAL_BROWSER_PROFILE: this.config.get<string>(
                    'PAL_BROWSER_PROFILE',
                  ),
                }
              : {}),
          },
        });
        child.on('error', (error) => this.logger.warn(error.message));
        child.unref();
      }
      const deadline = Date.now() + 15_000;
      while (true) {
        try {
          let browser = await chromium.connectOverCDP(this.endpoint, {
            timeout: 1000,
            noDefaults: true,
          });
          try {
            const scriptURL = await this.wakeWorker(browser);
            if (
              !browser
                .contexts()[0]
                .serviceWorkers()
                .some((worker) => worker.url() === scriptURL)
            ) {
              // A stopped MV3 target can be absent from a new CDP client's
              // auto-attach inventory. Reattach once after waking it.
              await browser.close();
              browser = await chromium.connectOverCDP(this.endpoint, {
                timeout: 1000,
                noDefaults: true,
              });
            }
          } catch (error) {
            await browser.close();
            throw error;
          }
          this.browser = browser;
          return browser;
        } catch (error) {
          if (Date.now() >= deadline)
            throw new Error(
              'Chromium did not become ready; check the desktop and browser launcher',
              { cause: error },
            );
          await delay(200);
        }
      }
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async wakeWorker(browser: Browser): Promise<string> {
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    if (!page) throw new Error('Chromium has no open window');
    const session = await context.newCDPSession(page);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // MV3 workers can be stopped when this API attaches. Chrome keeps the
      // registered script URL, so wake our worker through the supported CDP API.
      const registered = new Promise<string>((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Pal browser extension is unavailable')),
          5000,
        );
        session.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
          const version = versions.find(
            (entry) =>
              entry.scriptURL.startsWith('chrome-extension://') &&
              entry.scriptURL.endsWith('/pal-task-groups.js'),
          );
          if (version) resolve(version.scriptURL);
        });
      });
      await session.send('ServiceWorker.enable');
      const scriptURL = await registered;
      await session.send('ServiceWorker.startWorker', {
        scopeURL: new URL('.', scriptURL).href,
      });
      return scriptURL;
    } finally {
      if (timer) clearTimeout(timer);
      await session.detach();
    }
  }

  private async worker(): Promise<Worker> {
    const browser = await this.connect();
    const scriptURL = await this.wakeWorker(browser);
    const context = browser.contexts()[0];
    const worker = context
      .serviceWorkers()
      .find((entry) => entry.url() === scriptURL);
    if (worker) return worker;
    return context.waitForEvent('serviceworker', {
      timeout: 5000,
      predicate: (entry) => entry.url() === scriptURL,
    });
  }

  private async groupRequest<T>(request: GroupRequest): Promise<T> {
    const worker = await this.worker();
    return worker.evaluate((input) => {
      const api = (
        globalThis as unknown as {
          palBrowser: (input: GroupRequest) => Promise<T>;
        }
      ).palBrowser;
      return api(input);
    }, request);
  }

  async groups() {
    return this.groupRequest<BrowserGroup[]>({ action: 'list' });
  }

  private async cli(
    taskId: string,
    args: string[],
    signal?: AbortSignal,
  ): Promise<CliResult> {
    const executable = fileURLToPath(
      // Pal's Debian runtime uses the packaged native executable directly so
      // timeout/abort kills the CLI process, without an orphaned Node-wrapper child.
      new URL(
        process.platform === 'linux'
          ? `../../node_modules/agent-browser/bin/agent-browser-linux-${process.arch}`
          : '../../node_modules/.bin/agent-browser',
        import.meta.url,
      ),
    );
    return new Promise((resolve, reject) => {
      execFile(
        executable,
        [
          '--session',
          this.session(taskId),
          ...(args[0] === 'close'
            ? []
            : ['--cdp', this.endpoint, '--pin-tab', '--idle-timeout', '30m']),
          '--json',
          ...args,
        ],
        { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, signal },
        (error, stdout) => {
          // The CLI returns structured operation errors with a nonzero exit code.
          try {
            const result = JSON.parse(stdout) as CliResult;
            if (typeof result.success !== 'boolean')
              throw new Error('Invalid browser response');
            resolve(result);
          } catch {
            if (!error && args.includes('--help')) {
              resolve({ success: true, data: { help: stdout }, error: null });
              return;
            }
            reject(error ?? new Error('Browser command returned invalid JSON'));
          }
        },
      );
    });
  }

  private async workspace(
    taskId: string,
    signal?: AbortSignal,
    workerId?: string,
  ) {
    const sessionId = this.identity(taskId, workerId);
    await this.connect();
    const existing = await this.groupRequest<BrowserGroup | null>({
      action: 'get',
      taskId,
    });
    if (existing?.sessions?.includes(sessionId)) return existing;
    const task = await this.tasks.details(taskId);
    let opened = await this.cli(sessionId, ['open', 'about:blank'], signal);
    // A previous group or browser session may have closed this saved binding.
    // Only a fresh workspace uses the CLI's explicit new-tab recovery.
    if (!opened.success && opened.error?.startsWith('tab_gone:'))
      opened = await this.cli(sessionId, ['tab', 'new', 'about:blank'], signal);
    if (!opened.success)
      throw new Error(opened.error ?? 'Could not create a task tab');
    const targetId = opened.data.targetId;
    if (typeof targetId !== 'string')
      throw new Error('Browser command did not identify its tab');
    return this.groupRequest<BrowserGroup>({
      action: 'group',
      taskId,
      title: task.title,
      targetId,
      sessionId,
    });
  }

  async command(
    taskId: string,
    args: string[],
    signal?: AbortSignal,
    workerId?: string,
  ): Promise<CliResult> {
    signal?.throwIfAborted();
    if (!args.length) throw new Error('Supply an agent-browser command');
    if (
      args.some((arg) =>
        /^(--session|--cdp|--auto-connect|--profile|--no-pin-tab|--json)(=|$)/.test(
          arg,
        ),
      )
    ) {
      throw new Error(
        'Pal supplies browser connection and task session options',
      );
    }
    if (args.includes('--help'))
      return this.cli(this.identity(taskId, workerId), args, signal);
    if (args[0] === 'close') {
      if (workerId) await this.closeSession(taskId, workerId);
      else await this.closeGroup(taskId);
      return { success: true, data: { closed: true }, error: null };
    }
    if (args[0] === 'window' || args[0] === 'batch')
      throw new Error(
        'Use individual commands and tab new for task-managed tabs',
      );
    this.operations.set(taskId, (this.operations.get(taskId) ?? 0) + 1);
    try {
      await this.workspace(taskId, signal, workerId);
      await this.groupRequest({ action: 'touch', taskId });
      const result = await this.cli(
        this.identity(taskId, workerId),
        args,
        signal,
      );
      if (args[0] === 'tab' && args[1] === 'new' && result.success) {
        const targetId = result.data.targetId;
        if (typeof targetId !== 'string')
          throw new Error('New browser tab did not return its target');
        const task = await this.tasks.details(taskId);
        await this.groupRequest({
          action: 'group',
          taskId,
          title: task.title,
          targetId,
          sessionId: this.identity(taskId, workerId),
        });
      }
      return result;
    } finally {
      this.operations.set(taskId, (this.operations.get(taskId) ?? 1) - 1);
      if (!this.operations.get(taskId)) this.operations.delete(taskId);
    }
  }

  async screenshot(
    taskId: string,
    fullPage: boolean,
    signal?: AbortSignal,
    workerId?: string,
  ) {
    const result = await this.command(
      taskId,
      [
        'screenshot',
        '--screenshot-format',
        'png',
        ...(fullPage ? ['--full'] : []),
      ],
      signal,
      workerId,
    );
    if (!result.success)
      throw new Error(result.error ?? 'Browser screenshot failed');
    const path = result.data.path;
    if (typeof path !== 'string')
      throw new Error('Browser screenshot did not return a file');
    try {
      return {
        text: 'Task browser screenshot',
        data: (await readFile(path)).toString('base64'),
        mediaType: 'image/png',
      };
    } finally {
      await rm(path, { force: true });
    }
  }

  async closeSession(taskId: string, workerId: string) {
    if (!this.enabled || this.closing || !this.browser?.isConnected()) return;
    const sessionId = this.identity(taskId, workerId);
    const group = await this.groupRequest<BrowserGroup | null>({
      action: 'get',
      taskId,
    });
    if (!group?.sessions?.includes(sessionId)) return;
    await this.groupRequest({ action: 'close_session', taskId, sessionId });
    await this.cli(sessionId, ['close']);
  }

  async closeGroup(taskId: string) {
    if (!this.enabled || this.closing) return;
    if (!this.browser?.isConnected()) {
      try {
        await fetch(this.endpoint + '/json/version', {
          signal: AbortSignal.timeout(500),
        });
      } catch {
        return;
      }
      await this.connect();
    }
    const group = await this.groupRequest<BrowserGroup | null>({
      action: 'get',
      taskId,
    });
    if (!group) return;
    await this.groupRequest({ action: 'close', taskId });
    await Promise.all(
      (group.sessions ?? [taskId]).map((sessionId) =>
        this.cli(sessionId, ['close']),
      ),
    );
  }

  async sweep(now = Date.now()) {
    // Cleanup never starts the browser. Session storage also recovers groups
    // after API reconnect without introducing a database or ownership history.
    if (!this.enabled || this.closing) return;
    if (!this.browser?.isConnected()) {
      try {
        await fetch(this.endpoint + '/json/version', {
          signal: AbortSignal.timeout(500),
        });
      } catch {
        return;
      }
      await this.connect();
    }
    const active = new Set(this.activeTasks());
    for (const group of await this.groups()) {
      if (active.has(group.taskId) || this.operations.has(group.taskId))
        continue;
      const task = await this.tasks.details(group.taskId);
      if (
        task.status === 'completed' ||
        task.archived ||
        now - group.lastActivity >= 30 * 60_000 ||
        !group.tabs?.length
      ) {
        if (
          !this.activeTasks().includes(group.taskId) &&
          !this.operations.has(group.taskId)
        )
          await this.closeGroup(group.taskId);
      }
    }
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    if (this.timer) clearInterval(this.timer);
  }

  async shutdown() {
    this.onModuleDestroy();
    if (this.browser?.isConnected()) {
      for (const group of await this.groups())
        await this.closeGroup(group.taskId);
      // For a CDP connection, close disconnects this client; Chromium stays open.
      await this.browser.close();
    }
    this.closing = true;
  }
}
