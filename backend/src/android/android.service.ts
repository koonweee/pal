import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NativeSnapshot, NativeStatus } from './android-native.js';
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
    return this.withPhone(identity, () => this.native<T>(input), signal);
  }

  private async pause() {
    const result = await this.native<NativeStatus>({ action: 'pause' });
    if (result.status !== 'stopped')
      throw new Error('Android helper could not release control.');
    this.nativeGeneration++;
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
        if (action === 'android_inspect' || action === 'android_screenshot') {
          const snapshot = await this.native<NativeSnapshot | NativeStatus>({
            action: 'observe',
          });
          if (snapshot.status !== 'ready')
            throw new Error(
              'Android observation unavailable. Inspect after the screen settles.',
            );
          if (action === 'android_inspect')
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    packageName: snapshot.identity.packageName,
                    elements: snapshot.elements,
                  }),
                },
              ],
            };
          return {
            content: [
              {
                type: 'text' as const,
                text: `Masked Android screen. Device coordinates ${snapshot.width}x${snapshot.height}; image ${snapshot.imageWidth}x${snapshot.imageHeight}. Scale image coordinates to device coordinates for taps.`,
              },
              {
                type: 'image' as const,
                mimeType: 'image/png',
                data: snapshot.image,
              },
            ],
          };
        }
        const arguments_ = { ...args };
        if (
          (action === 'android_tap' || action === 'android_long_press') &&
          args.ref
        ) {
          const target = await this.native<{
            status?: string;
            x?: number;
            y?: number;
          }>({ action: 'resolve', ref: args.ref });
          if (typeof target.x !== 'number' || typeof target.y !== 'number')
            throw new Error('Android target changed. Inspect again.');
          delete arguments_.ref;
          arguments_.x = target.x;
          arguments_.y = target.y;
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
          if (result.isError)
            throw new AndroidActionError(
              'Android operation failed. Inspect before deciding whether to retry.',
            );
          if (action === 'android_apps' || action === 'android_foreground_app')
            return result;
          // UI state must come only from the native observation path.
          return {
            content: [
              { type: 'text' as const, text: '{"status":"completed"}' },
            ],
          };
        } catch (error) {
          if (error instanceof AndroidActionError) throw error;
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
class AndroidActionError extends Error {}
