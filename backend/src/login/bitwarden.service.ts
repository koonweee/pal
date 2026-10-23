import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ApplicationError } from '../application/contracts/errors.js';

const run = promisify(execFile);
export interface VaultItem {
  id: string;
  name: string;
  type: number;
  notes?: string | null;
  login?: {
    username?: string;
    password?: string;
    uris?: { uri: string; match: number | null }[];
  };
}
export interface CredentialInput {
  username: string;
  password: string;
  label: string;
  accountId?: string;
}

/** All secret-bearing responses remain in trusted service code. */
@Injectable()
export class BitwardenService implements OnModuleDestroy {
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private ready = false;
  private closing = false;
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}
  get configured() {
    return [
      'PAL_BITWARDEN_CLIENT_ID',
      'PAL_BITWARDEN_CLIENT_SECRET',
      'PAL_BITWARDEN_MASTER_PASSWORD',
    ].every((key) => !!this.config.get<string>(key));
  }
  protected get endpoint() {
    return 'http://127.0.0.1:8087';
  }
  protected async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    timeout = 30_000,
  ): Promise<T> {
    try {
      const response = await fetch(this.endpoint + path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'GET' || body === undefined
          ? {}
          : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as { success: boolean; data: T };
      if (!result.success) throw new Error();
      return result.data;
    } catch {
      throw new ApplicationError(
        'unavailable',
        'Password vault is unavailable',
      );
    }
  }
  protected async ensureReady() {
    if (!this.configured || this.closing)
      throw new ApplicationError(
        'unavailable',
        'Password vault needs configuration',
      );
    if (this.starting) return this.starting;
    this.starting = (async () => {
      if (!this.ready) {
        const root = join(
          dirname(this.config.getOrThrow<string>('PAL_UPLOAD_DIR')),
          'bitwarden',
        );
        await mkdir(join(root, 'tmp'), { recursive: true, mode: 0o700 });
        const env = {
          PATH: process.env.PATH,
          HOME: root,
          TMPDIR: join(root, 'tmp'),
          BITWARDENCLI_APPDATA_DIR: root,
          BW_NOINTERACTION: 'true',
          BW_CLIENTID: this.config.get<string>('PAL_BITWARDEN_CLIENT_ID'),
          BW_CLIENTSECRET: this.config.get<string>(
            'PAL_BITWARDEN_CLIENT_SECRET',
          ),
          PAL_VAULT_PASSWORD: this.config.get<string>(
            'PAL_BITWARDEN_MASTER_PASSWORD',
          ),
        };
        const binary =
          this.config.get<string>('PAL_BITWARDEN_CLI') ??
          '/opt/bitwarden/node_modules/.bin/bw';
        const options = { env, timeout: 60_000, maxBuffer: 1_000_000 };
        const status = JSON.parse(
          (await run(binary, ['status'], options)).stdout,
        ) as { status: string };
        if (status.status === 'unauthenticated')
          await run(binary, ['login', '--apikey'], options);
        const session = (
          await run(
            binary,
            ['unlock', '--passwordenv', 'PAL_VAULT_PASSWORD', '--raw'],
            options,
          )
        ).stdout.trim();
        if (!session) throw new Error();
        const child = spawn(
          binary,
          ['serve', '--hostname', '127.0.0.1', '--port', '8087'],
          {
            env: { ...env, PAL_VAULT_PASSWORD: undefined, BW_SESSION: session },
            stdio: 'ignore',
          },
        );
        this.child = child;
        child.on('error', () => {
          if (this.child === child) this.ready = false;
        });
        child.on('exit', () => {
          if (this.child === child) {
            this.ready = false;
            this.child = undefined;
          }
        });
        for (let i = 0; i < 40; i++) {
          if (this.child?.exitCode !== null) throw new Error();
          try {
            await this.request('/status', 'GET', undefined, 500);
            this.ready = true;
            break;
          } catch {
            await delay(200);
          }
        }
        if (!this.ready) throw new Error();
      }
      const status = await this.request<{ template: { status: string } }>(
        '/status',
      );
      if (status.template.status === 'locked') {
        await this.request('/unlock', 'POST', {
          password: this.config.get<string>('PAL_BITWARDEN_MASTER_PASSWORD'),
        });
      } else if (status.template.status !== 'unlocked') throw new Error();
    })()
      .catch(() => {
        this.child?.kill();
        this.ready = false;
        throw new ApplicationError(
          'unavailable',
          'Password vault could not be unlocked',
        );
      })
      .finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }
  async matching(url: string) {
    if (new URL(url).protocol !== 'https:') return [];
    await this.ensureReady();
    await this.request('/sync', 'POST');
    const result = await this.request<{ data: VaultItem[] }>(
      '/list/object/items?url=' + encodeURIComponent(url),
    );
    return result.data.filter((item) => item.type === 1 && !!item.login);
  }
  async save(origin: string, input: CredentialInput, requestId: string) {
    const matches = await this.matching(origin);
    const marker = 'pal-login-request:' + requestId;
    const previous = matches.find((item) =>
      item.notes?.split('\n').includes(marker),
    );
    if (previous) return previous.id;
    const selected = input.accountId
      ? matches.find((item) => item.id === input.accountId)
      : undefined;
    if (input.accountId && !selected)
      throw new ApplicationError(
        'invalid_input',
        'Account does not match this website',
      );
    const item = {
      ...selected,
      type: 1,
      name: input.label,
      notes: [selected?.notes, marker].filter(Boolean).join('\n'),
      login: {
        ...selected?.login,
        username: input.username,
        password: input.password,
        uris: selected?.login?.uris ?? [{ uri: origin, match: 1 }],
      },
    };
    const saved = await this.request<VaultItem>(
      selected
        ? '/object/item/' + encodeURIComponent(selected.id)
        : '/object/item',
      selected ? 'PUT' : 'POST',
      item,
    );
    return saved.id;
  }
  onModuleDestroy() {
    this.closing = true;
    this.child?.kill();
  }
}
