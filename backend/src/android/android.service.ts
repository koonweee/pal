import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NativeStatus } from './android-native.js';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

export const androidActions = {
  android_apps: 'mobile_list_apps',
  android_foreground_app: 'mobile_get_foreground_app',
  android_launch_app: 'mobile_launch_app',
  android_inspect: 'mobile_list_elements_on_screen',
  android_screenshot: 'mobile_take_screenshot',
  android_tap: 'mobile_click_on_screen_at_coordinates',
  android_long_press: 'mobile_long_press_on_screen_at_coordinates',
  android_swipe: 'mobile_swipe_on_screen',
  android_type: 'mobile_type_keys',
  android_press_button: 'mobile_press_button',
  android_open_url: 'mobile_open_url',
  android_clipboard: 'mobile_clipboard',
  android_batch: 'mobile_batch_commands',
} as const;
export type AndroidAction = keyof typeof androidActions;
export type AndroidOwner = { taskId: string; workerId: string };
type Owner = AndroidOwner & {
  pending: Promise<void>;
  closing: boolean;
  expiry?: ReturnType<typeof setTimeout>;
  releasing?: Promise<void>;
};

@Injectable()
export class AndroidService implements OnApplicationShutdown {
  private client?: Client;
  private connecting?: Promise<Client>;
  private owner?: Owner;
  private closing = false;
  private nativeGeneration = 0;
  // Clear an orphaned private session once, then switch only at private boundaries.
  private nativeActive = true;
  readonly endpoint?: string;
  private readonly token?: string;
  private readonly device?: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.endpoint = config.get<string>('PAL_ANDROID_MCP_URL') || undefined;
    this.token = config.get<string>('PAL_ANDROID_MCP_TOKEN');
    this.device = config.get<string>('PAL_ANDROID_DEVICE_ID');
  }

  get enabled() {
    return !!this.endpoint;
  }
  get instructions() {
    return this.enabled
      ? 'Android phone control is configured for interaction workers. Tool results establish current device readiness.'
      : '';
  }

  private async connection(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = new Client({ name: 'pal-android', version: '1.0.0' });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(this.endpoint!), {
            requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
          }),
          { timeout: 10000 },
        );
        this.client = client;
        return client;
      } catch {
        await client.close().catch(() => {});
        throw new Error(
          'Android MCP is unavailable. Check the Android sidecar and connection configuration.',
        );
      }
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async toolDefinitions() {
    return (await (await this.connection()).listTools()).tools;
  }

  get generation() {
    return this.nativeGeneration;
  }

  owns(taskId: string, workerId: string) {
    return (
      !!this.owner &&
      !this.owner.closing &&
      this.owner.taskId === taskId &&
      this.owner.workerId === workerId
    );
  }

  private async withPhone<T>(
    identity: AndroidOwner,
    work: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.enabled || this.closing)
      throw new Error('Android control is unavailable.');
    if (!identity.taskId || !identity.workerId)
      throw new Error('Android tools require an interaction worker.');
    signal?.throwIfAborted();
    if (
      this.owner &&
      (this.owner.workerId !== identity.workerId ||
        this.owner.taskId !== identity.taskId ||
        this.owner.closing)
    )
      throw new Error(
        'The Android phone is busy with another workflow. Wait for that worker to finish.',
      );
    const owner = (this.owner ??= {
      ...identity,
      pending: Promise.resolve(),
      closing: false,
    });
    if (owner.expiry) this.retain(owner);
    const operation = owner.pending.then(async () => {
      signal?.throwIfAborted();
      // Once dispatched, settle before cleanup; mutations are never retried.
      return work();
    });
    owner.pending = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  private async native<T>(input: object): Promise<T> {
    try {
      const endpoint = new URL(this.endpoint!);
      endpoint.pathname = '/secure';
      endpoint.search = '';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...input, device: this.device }),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error();
      return (await response.json()) as T;
    } catch {
      this.nativeGeneration++;
      throw new Error(
        'Android private operation unavailable or uncertain. Inspect again; do not replay a fill.',
      );
    }
  }

  secure<T>(identity: AndroidOwner, input: object, signal?: AbortSignal) {
    return this.withPhone(
      identity,
      () => {
        this.nativeActive = true;
        return this.native<T>(input);
      },
      signal,
    );
  }

  private async pause() {
    if (!this.nativeActive) return;
    const result = await this.native<NativeStatus>({ action: 'pause' });
    if (result.status !== 'stopped')
      throw new Error('Android helper could not release control.');
    this.nativeGeneration++;
    this.nativeActive = false;
  }

  async call(
    identity: AndroidOwner,
    action: AndroidAction,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    if (!Object.hasOwn(androidActions, action))
      throw new Error('Unsupported Android action.');
    return this.withPhone(
      identity,
      async () => {
        const arguments_ = { ...args };
        if (action === 'android_batch') {
          const steps = args.steps as {
            name: AndroidAction;
            arguments: Record<string, unknown>;
          }[];
          arguments_.steps = steps.map((step) => {
            if (
              !Object.hasOwn(androidActions, step.name) ||
              step.name === 'android_batch' ||
              step.name === 'android_screenshot'
            )
              throw new Error('Unsupported Android batch step.');
            return {
              name: androidActions[step.name],
              arguments: { ...step.arguments, device: this.device },
            };
          });
        }
        await this.pause();
        const client = await this.connection();
        signal?.throwIfAborted();
        try {
          const result = await client.callTool(
            {
              name: androidActions[action],
              arguments: { ...arguments_, device: this.device },
            },
            { timeout: 60000 },
          );
          return result;
        } catch {
          this.client = undefined;
          await client.close().catch(() => {});
          throw new Error(
            'Android connection failed. Reconnect and inspect the screen before retrying an action.',
          );
        }
      },
      signal,
    );
  }

  private retain(owner: Owner) {
    if (owner.expiry) clearTimeout(owner.expiry);
    owner.expiry = setTimeout(() => {
      void this.release(owner.taskId, owner.workerId).catch(() => {});
    }, 10 * 60_000);
    owner.expiry.unref();
  }

  async release(taskId: string, workerId: string, retain = false) {
    const owner = this.owner;
    if (!owner || owner.taskId !== taskId || owner.workerId !== workerId)
      return;
    if (owner.releasing) return owner.releasing;
    if (retain && !owner.closing) {
      await owner.pending;
      this.retain(owner);
      return;
    }
    if (owner.expiry) clearTimeout(owner.expiry);
    owner.closing = true;
    const releasing = owner.pending.then(async () => {
      await this.pause();
      if (this.owner === owner) this.owner = undefined;
    });
    owner.releasing = releasing;
    try {
      await releasing;
    } finally {
      owner.releasing = undefined;
    }
  }

  async onApplicationShutdown() {
    this.closing = true;
    if (this.owner) await this.release(this.owner.taskId, this.owner.workerId);
    const client =
      this.client ?? (await this.connecting?.catch(() => undefined));
    await client?.close();
  }
}
