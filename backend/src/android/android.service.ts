import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InteractionCoordinator } from '../interaction/interaction-coordinator.js';
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

@Injectable()
export class AndroidService implements OnApplicationShutdown {
  private readonly logger = new Logger(AndroidService.name);
  private client?: Client;
  private connecting?: Promise<Client>;
  private closing = false;
  private nativeGeneration = 0;
  // Clear an orphaned private session once, then switch only at private boundaries.
  private nativeActive = true;
  readonly endpoint?: string;
  private readonly token?: string;
  private readonly device?: string;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(InteractionCoordinator)
    private readonly coordinator: InteractionCoordinator,
  ) {
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
          { timeout: 3000 },
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
    let client: Client | undefined;
    try {
      client = await this.connection();
      return (await client.listTools(undefined, { timeout: 3000 })).tools;
    } catch {
      if (this.client === client) this.client = undefined;
      await client?.close().catch(() => {});
      this.logger.warn(
        'Android discovery unavailable; continuing without Android tools. A later worker run will retry.',
      );
      return undefined;
    }
  }

  get generation() {
    return this.nativeGeneration;
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
    return this.coordinator.forSession('android', identity, work, signal);
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
              // Batch arguments are an untyped record, so model-produced nulls
              // bypass the ordinary tool schema's optional-value handling.
              arguments: {
                ...Object.fromEntries(
                  Object.entries(step.arguments).filter(
                    ([, value]) => value != null,
                  ),
                ),
                device: this.device,
              },
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
          if (this.client === client) this.client = undefined;
          await client.close().catch(() => {});
          throw new Error(
            'Android connection failed. Inspect current state before deciding the next step; do not assume the action failed.',
          );
        }
      },
      signal,
    );
  }

  async onApplicationShutdown() {
    this.closing = true;
    const client =
      this.client ?? (await this.connecting?.catch(() => undefined));
    await client?.close();
  }
}
