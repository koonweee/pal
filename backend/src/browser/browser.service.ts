import { ExecutionService } from '../execution/execution.service.js';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, type Browser } from 'playwright-core';
import { extensionRequest } from './browser-extension.js';
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
    @Inject(ExecutionService) private readonly execution: ExecutionService,
  ) {}

  get enabled() {
    return this.config.get<boolean>('PAL_DESKTOP_ENABLED') === true;
  }
  private get endpoint() {
    return (
      this.config.get<string>('PAL_BROWSER_ENDPOINT') ?? 'http://execution:9223'
    );
  }
  private async version(timeout = 1000) {
    const response = await fetch(this.endpoint + '/json/version', {
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok)
      throw new Error('Browser debugging endpoint is unavailable');
    return response.json() as Promise<{ webSocketDebuggerUrl: string }>;
  }

  private async cdpEndpoint() {
    const version = await this.version();
    const url = new URL(this.endpoint);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = new URL(version.webSocketDebuggerUrl).pathname;
    return url.href;
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
        await this.version();
      } catch {
        await this.execution.output('sh', [
          '-c',
          'nohup /opt/pal/desktop/browser.sh about:blank </dev/null >/home/pal/tmp/browser.log 2>&1 &',
        ]);
      }

      const deadline = Date.now() + 15_000;
      while (true) {
        try {
          const browser = await chromium.connectOverCDP(
            await this.cdpEndpoint(),
            { timeout: 1000, noDefaults: true },
          );
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

  private async groupRequest<T>(request: GroupRequest): Promise<T> {
    if (!this.enabled || this.closing)
      throw new Error('Browser control is unavailable');
    let endpoint: string;
    try {
      endpoint = await this.cdpEndpoint();
    } catch {
      await this.connect();
      endpoint = await this.cdpEndpoint();
    }
    return extensionRequest<T>(endpoint, request);
  }

  private async existingBrowser() {
    if (!this.enabled || this.closing) return false;
    try {
      await this.version(500);
      return true;
    } catch {
      return false;
    }
  }

  async groups() {
    return this.groupRequest<BrowserGroup[]>({ action: 'list' });
  }

  private async cli(
    taskId: string,
    args: string[],
    signal?: AbortSignal,
  ): Promise<CliResult> {
    const result = await this.execution.run(
      '/opt/pal/node_modules/.bin/agent-browser',
      [
        '--session',
        this.session(taskId),
        ...(args[0] === 'close'
          ? []
          : [
              '--cdp',
              'http://127.0.0.1:9222',
              '--pin-tab',
              '--idle-timeout',
              '30m',
            ]),
        '--json',
        ...args,
      ],
      { signal, timeout: 30_000 },
    );
    try {
      const parsed = JSON.parse(result.stdout) as CliResult;
      if (typeof parsed.success !== 'boolean')
        throw new Error('Invalid browser response');
      return parsed;
    } catch {
      if (result.success && args.includes('--help'))
        return { success: true, data: { help: result.stdout }, error: null };
      if (result.timedOut) throw new Error('Browser command timed out');
      if (!result.success)
        throw new Error(
          'Browser command failed with exit code ' + result.exitCode,
        );
      throw new Error('Browser command returned invalid JSON');
    }
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

  /** Resolve the CLI session's pinned target, then enforce group/session ownership. */
  async selectedPage(taskId: string, workerId?: string) {
    const result = await this.command(
      taskId,
      ['tab', 'list'],
      undefined,
      workerId,
    );
    if (!result.success || !Array.isArray(result.data.tabs))
      throw new Error('Browser tab is unavailable');
    const active = result.data.tabs.find(
      (tab: { active?: boolean }) => tab.active,
    ) as { targetId?: string } | undefined;
    const group = (await this.groups()).find(
      (group) => group.taskId === taskId,
    );
    if (
      !active?.targetId ||
      !group?.tabs?.some(
        (tab) =>
          tab.targetId === active.targetId &&
          tab.sessionId === this.identity(taskId, workerId),
      )
    )
      throw new Error('Browser tab is not owned by this session');
    const browser = await this.connect();
    for (const page of browser.contexts()[0].pages()) {
      const session = await page.context().newCDPSession(page);
      try {
        const { targetInfo } = await session.send('Target.getTargetInfo');
        if (targetInfo.targetId === active.targetId) return page;
      } finally {
        await session.detach();
      }
    }
    throw new Error('Browser tab is unavailable');
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
        data: (await this.execution.readFile(path, 25_000_000)).toString(
          'base64',
        ),
        mediaType: 'image/png',
      };
    } finally {
      await this.execution.output('rm', ['-f', '--', path]);
    }
  }

  async closeSession(taskId: string, workerId: string) {
    if (!(await this.existingBrowser())) return;
    const sessionId = this.identity(taskId, workerId);
    const group = await this.groupRequest<BrowserGroup | null>({
      action: 'get',
      taskId,
    });
    if (!group?.sessions?.includes(sessionId)) return;
    await this.groupRequest({ action: 'close_session', taskId, sessionId });
    await this.cli(sessionId, ['close']);
  }

  async closeGroup(taskId: string, idleBefore?: number) {
    if (!(await this.existingBrowser())) return;
    const group = await this.groupRequest<BrowserGroup | null>({
      action: 'get',
      taskId,
    });
    if (!group || (idleBefore !== undefined && group.lastActivity > idleBefore))
      return;
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
    if (!(await this.existingBrowser())) return;
    const active = new Set(this.activeTasks());
    const idleBefore = now - 15 * 60_000;
    for (const group of await this.groups()) {
      // A stalled run or operation cannot retain an idle renderer indefinitely.
      if (group.lastActivity <= idleBefore) {
        await this.closeGroup(group.taskId, idleBefore);
        continue;
      }
      if (active.has(group.taskId) || this.operations.has(group.taskId))
        continue;
      const task = await this.tasks.details(group.taskId);
      if (task.status === 'completed' || task.archived || !group.tabs?.length) {
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
    if (await this.existingBrowser()) {
      for (const group of await this.groups())
        await this.closeGroup(group.taskId);
      // For a CDP connection, close disconnects this client; Chromium stays open.
      await this.browser?.close();
    }
    this.closing = true;
  }
}
