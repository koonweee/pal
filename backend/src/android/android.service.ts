import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
type Owner = AndroidOwner & { pending: Promise<void>; closing: boolean };

@Injectable()
export class AndroidService implements OnApplicationShutdown {
  private client?: Client;
  private connecting?: Promise<Client>;
  private owner?: Owner;
  private closing = false;
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

  async call(
    identity: AndroidOwner,
    action: AndroidAction,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    if (!this.enabled || this.closing)
      throw new Error('Android control is unavailable.');
    if (!identity.taskId || !identity.workerId)
      throw new Error('Android tools require an interaction worker.');
    if (!Object.hasOwn(androidActions, action))
      throw new Error('Unsupported Android action.');
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
    const operation = owner.pending.then(async () => {
      signal?.throwIfAborted();
      const client = await this.connection();
      signal?.throwIfAborted();
      try {
        // Once dispatched, await the response even if the worker is cancelled.
        // Cleanup retains ownership until this request settles; actions are never retried.
        const result = await client.callTool(
          {
            name: androidActions[action],
            arguments: {
              ...args,
              ...(action === 'android_screenshot' ? { maxSize: 1280 } : {}),
              device: this.device,
            },
          },
          { timeout: 60000 },
        );
        if (result.isError)
          throw new AndroidActionError(
            result.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('\n') || 'Android operation failed.',
          );
        return result;
      } catch (error) {
        if (error instanceof AndroidActionError) throw error;
        this.client = undefined;
        await client.close().catch(() => {});
        throw new Error(
          'Android connection failed. Reconnect and inspect the screen before retrying an action.',
        );
      }
    });
    owner.pending = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  async release(taskId: string, workerId: string) {
    const owner = this.owner;
    if (!owner || owner.taskId !== taskId || owner.workerId !== workerId)
      return;
    owner.closing = true;
    await owner.pending;
    if (this.owner === owner) this.owner = undefined;
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
