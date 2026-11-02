import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Page } from 'playwright-core';
import { ExecutionService } from '../execution/execution.service.js';
import { extensionRequest } from './browser-extension.js';

/** Shared Chromium connection and private-entry targets; admission is separate. */
@Injectable()
export class SharedBrowserService {
  private browser?: Browser;
  private connecting?: Promise<Browser>;
  private readonly targets = new Map<string, Page>();
  private closing = false;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ExecutionService) private readonly execution: ExecutionService,
  ) {}

  get enabled() {
    return this.config.get<boolean>('PAL_DESKTOP_ENABLED') === true;
  }

  private async endpoint() {
    const endpoint =
      this.config.get<string>('PAL_BROWSER_ENDPOINT') ??
      'http://execution:9223';
    const response = await fetch(endpoint + '/json/version', {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok)
      throw new Error('Browser debugging endpoint is unavailable');
    const version = (await response.json()) as { webSocketDebuggerUrl: string };
    const url = new URL(endpoint);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = new URL(version.webSocketDebuggerUrl).pathname;
    return url.href;
  }

  private async connect(): Promise<Browser> {
    if (!this.enabled || this.closing)
      throw new Error('Browser control is unavailable');
    if (this.browser?.isConnected()) return this.browser;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        await this.endpoint();
      } catch {
        await this.execution.output('sh', [
          '-c',
          'nohup /opt/pal/desktop/browser.sh about:blank </dev/null >/home/pal/tmp/browser.log 2>&1 &',
        ]);
      }
      const deadline = Date.now() + 15_000;
      while (true) {
        try {
          this.browser = await chromium.connectOverCDP(await this.endpoint(), {
            timeout: 1000,
            noDefaults: true,
          });
          return this.browser;
        } catch (error) {
          if (Date.now() >= deadline)
            throw new Error('Chromium did not become ready', { cause: error });
          await delay(200);
        }
      }
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  releaseTarget(taskId: string, workerId: string) {
    this.targets.delete(taskId + ':' + workerId);
  }

  async selectedPage(
    taskId: string,
    workerId?: string,
    fresh = false,
  ): Promise<Page> {
    const key = taskId + ':' + (workerId ?? 'task');
    const previous = this.targets.get(key);
    if (!fresh) {
      if (!previous)
        throw new Error(
          'Private-entry browser target is unavailable; inspect again',
        );
      if (previous.isClosed())
        throw new Error('Private-entry browser tab was closed; inspect again');
      return previous;
    }
    const browser = await this.connect();
    const active = await extensionRequest<{ targetId: string }>(
      await this.endpoint(),
      { action: 'active' },
    );
    const deadline = Date.now() + 10_000;
    do {
      for (const page of browser.contexts()[0].pages()) {
        const session = await page.context().newCDPSession(page);
        try {
          const { targetInfo } = await session.send('Target.getTargetInfo');
          if (targetInfo.targetId === active.targetId) {
            this.targets.set(key, page);
            return page;
          }
        } finally {
          await session.detach();
        }
      }
      await delay(100);
    } while (Date.now() < deadline);
    throw new Error('Active browser tab is unavailable');
  }

  async shutdown() {
    this.closing = true;
    await this.connecting?.catch(() => {});
    // A CDP close disconnects this client; Chromium and its tabs remain open.
    await this.browser?.close();
    this.targets.clear();
  }
}
