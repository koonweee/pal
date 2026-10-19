import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ApplicationError } from '../application/contracts/errors.js';
import { ConfigService } from '@nestjs/config';
import {
  MCPClient,
  MCPOAuthClientProvider,
  auth,
  type MastraMCPServerDefinition,
} from '@mastra/mcp';
import { noopLogger } from '@mastra/core/logger';
import {
  createCodeModeInstructions,
  generateStubs,
  type Tool,
} from '@mastra/core/tools';
import { McpRepository } from './mcp.repository.js';
import { AgentAdmissionService } from './agent-admission.service.js';
import type { McpAuthInput, SaveMcpServerInput } from './mcp.types.js';
import type { McpAuth, McpStatus } from './mcp.types.js';
import { catalogDiagnostics } from './catalog-diagnostics.js';
import { toolsOnlyFetch } from './tools-only-fetch.js';
import { singleFlightOAuthProvider } from './single-flight-oauth-provider.js';

type Server = NonNullable<Awaited<ReturnType<McpRepository['get']>>>;
type PendingLogin = {
  server: Server;
  provider: MCPOAuthClientProvider;
  expires: number;
  timer: ReturnType<typeof setTimeout>;
};
type DiscoveryCandidate = {
  client: MCPClient;
  tools: Record<string, Tool>;
  catalog: string;
  statuses: Map<string, McpStatus>;
  applied: Map<string, number>;
  retryableServers: string[];
};

const STARTUP_DISCOVERY_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

@Injectable()
export class McpService implements OnApplicationShutdown {
  private readonly logger = new Logger(McpService.name);
  private client?: MCPClient;
  private applied = new Map<string, number>();
  private statuses = new Map<string, McpStatus>();
  private pending = new Map<string, PendingLogin>();
  private taskTools: Record<string, Tool> = {};
  private catalog = '';
  private loginErrors = new Map<string, string>();

  constructor(
    @Inject(McpRepository) private readonly repository: McpRepository,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AgentAdmissionService)
    private readonly admission: AgentAdmissionService,
  ) {}

  tools() {
    return this.taskTools;
  }
  instructions() {
    return this.catalog;
  }

  private async server(id: string) {
    const row = await this.repository.get(id);
    if (!row) throw new ApplicationError('not_found', 'MCP server not found');
    return row;
  }
  private httpUrl(value: string, httpsOnly = false) {
    try {
      const url = new URL(value);
      if (
        !(httpsOnly ? ['https:'] : ['https:', 'http:']).includes(
          url.protocol,
        ) ||
        url.username ||
        url.password ||
        url.hash
      )
        throw new Error();
      return url.toString();
    } catch {
      throw new ApplicationError(
        'invalid_input',
        'Use an HTTP(S) URL without credentials or a fragment',
      );
    }
  }
  private authConfig(
    input: McpAuthInput | undefined,
    previous: McpAuth = { type: 'none' },
  ): McpAuth {
    if (!input) return previous;
    if (input.type === 'none') return { type: 'none' };
    if (input.type === 'headers') {
      const headers =
        input.headers === undefined && previous.type === 'headers'
          ? previous.headers
          : (input.headers ?? {});
      for (const [key, value] of Object.entries(headers)) {
        if (
          typeof value !== 'string' ||
          key.length > 100 ||
          value.length > 10000 ||
          /[\r\n]/.test(value)
        )
          throw new ApplicationError('invalid_input', 'Invalid MCP header');
        try {
          new Headers({ [key]: value });
        } catch {
          throw new ApplicationError('invalid_input', 'Invalid MCP header');
        }
      }
      return { type: 'headers', headers };
    }
    const old = previous.type === 'oauth' ? previous : undefined;
    const clientId = input.clientId ?? old?.clientId;
    const clientMetadataUrl =
      input.clientMetadataUrl === undefined
        ? old?.clientMetadataUrl
        : input.clientMetadataUrl;
    if (!!clientId === !!clientMetadataUrl)
      throw new ApplicationError(
        'invalid_input',
        'OAuth requires exactly one of clientId or clientMetadataUrl',
      );
    if (clientMetadataUrl) this.httpUrl(clientMetadataUrl, true);
    if (clientMetadataUrl && new URL(clientMetadataUrl).pathname === '/')
      throw new ApplicationError(
        'invalid_input',
        'Client metadata URL requires a document path',
      );
    return {
      type: 'oauth',
      clientId,
      clientMetadataUrl,
      clientSecret:
        input.clientSecret === undefined
          ? old?.clientSecret
          : (input.clientSecret ?? undefined),
      scope: input.scope ?? old?.scope ?? '',
    };
  }
  async save(input: SaveMcpServerInput, id?: string) {
    const old = id ? await this.server(id) : undefined;
    const name = input.name ?? old?.name;
    const url = input.url ?? old?.url;
    if (!name || !url)
      throw new ApplicationError(
        'invalid_input',
        'Server name and URL are required',
      );
    const definition = {
      name,
      url: this.httpUrl(url),
      enabled: input.enabled ?? old?.enabled ?? true,
      auth: this.authConfig(input.auth, old?.auth),
    };
    try {
      if (old) {
        const resetAuth =
          old.url !== definition.url ||
          JSON.stringify(old.auth) !== JSON.stringify(definition.auth);
        if (resetAuth) this.cancelLogin(old.id);
        await this.repository.update(old.id, definition, resetAuth);
        return { id: old.id };
      }
      const row = await this.repository.create(definition);
      return { id: row.id };
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === '23505')
        throw new ApplicationError('conflict', 'Server name already exists');
      // Drizzle errors can embed write parameters, including secret fields.
      this.logger.error('MCP configuration persistence failed');
      throw new ApplicationError(
        'unavailable',
        'Could not save MCP configuration',
      );
    }
  }
  async remove(id: string) {
    await this.server(id);
    this.cancelLogin(id);
    await this.repository.remove(id);
  }
  async forget(id: string) {
    await this.server(id);
    this.cancelLogin(id);
    await this.repository.forget(id);
    this.loginErrors.delete(id);
  }

  async list() {
    const rows = await this.repository.list();
    const applyNeeded =
      rows.length !== this.applied.size ||
      rows.some((row) => this.applied.get(row.id) !== row.version);
    return {
      applyNeeded,
      servers: rows.map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        enabled: row.enabled,
        auth:
          row.auth.type === 'oauth'
            ? {
                type: 'oauth',
                clientId: row.auth.clientId,
                clientMetadataUrl: row.auth.clientMetadataUrl,
                scope: row.auth.scope,
                hasClientSecret: !!row.auth.clientSecret,
              }
            : row.auth.type === 'headers'
              ? { type: 'headers', headerNames: Object.keys(row.auth.headers) }
              : { type: 'none' },
        hasLogin: Object.keys(row.oauth).some(
          (key) =>
            key.startsWith('tokens') &&
            row.oauth[key]?.includes('access_token'),
        ),
        loginPending: [...this.pending.values()].some(
          (entry) => entry.server.id === row.id,
        ),
        loginError: this.loginErrors.get(row.id),
        applyNeeded: this.applied.get(row.id) !== row.version,
        status: this.statuses.get(row.id) ?? {
          state: row.enabled ? 'not-applied' : 'disabled',
          toolCount: 0,
        },
      })),
    };
  }

  private provider(
    server: Server,
    onRedirect: (url: URL) => void | Promise<void>,
  ) {
    if (server.auth.type !== 'oauth')
      throw new ApplicationError(
        'invalid_input',
        'This server does not use OAuth',
      );
    const redirectUrl = new URL(
      'mcp/oauth/callback',
      this.config.get<string>('PAL_PUBLIC_URL') ?? 'http://localhost:3000/',
    ).toString();
    const durable = this.repository.storage(server.id, server.authEpoch);
    const temporary = new Map<string, string>();
    const loadedCredentials = new Map(Object.entries(server.oauth));
    const ephemeral = (key: string) =>
      key === 'code_verifier' || key === 'discovery_state';
    return new MCPOAuthClientProvider({
      redirectUrl,
      clientMetadata: {
        client_name: 'Pal',
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: server.auth.scope,
        token_endpoint_auth_method: server.auth.clientSecret
          ? 'client_secret_post'
          : 'none',
      },
      ...(server.auth.clientMetadataUrl
        ? { clientMetadataUrl: server.auth.clientMetadataUrl }
        : {
            clientInformation: {
              client_id: server.auth.clientId!,
              client_secret: server.auth.clientSecret,
            },
          }),
      storage: {
        get: async (key) => {
          if (ephemeral(key)) return temporary.get(key);
          const current = await this.repository.get(server.id);
          // Saved edits/forget take effect on loaded connections at Apply. Their
          // refreshes may finish, but the repository rejects stale credential writes.
          if (!current || current.authEpoch !== server.authEpoch)
            return loadedCredentials.get(key);
          const value = current.oauth[key];
          if (value === undefined) loadedCredentials.delete(key);
          else loadedCredentials.set(key, value);
          return value;
        },
        set: (key, value) => {
          if (ephemeral(key)) temporary.set(key, value);
          else {
            loadedCredentials.set(key, value);
            return durable.set(key, value);
          }
        },
        delete: (key) => {
          if (ephemeral(key)) temporary.delete(key);
          else {
            loadedCredentials.delete(key);
            return durable.delete(key);
          }
        },
      },
      onRedirectToAuthorization: onRedirect,
    });
  }
  private cancelLogin(id: string) {
    for (const [state, entry] of this.pending)
      if (entry.server.id === id) {
        clearTimeout(entry.timer);
        entry.provider.endAuthorizationSession();
        this.pending.delete(state);
      }
  }
  async login(id: string) {
    const server = await this.server(id);
    if ([...this.pending.values()].some((entry) => entry.server.id === id))
      throw new ApplicationError(
        'conflict',
        'Login already pending. Complete it or wait for it to expire.',
      );
    this.loginErrors.delete(id);
    let authorizationUrl: string | undefined;
    const provider = this.provider(server, (url) => {
      authorizationUrl = url.toString();
    });
    const state = await provider.beginAuthorizationSession();
    const timer = setTimeout(() => this.cancelLogin(id), 300000);
    timer.unref();
    this.pending.set(state, {
      server,
      provider,
      expires: Date.now() + 300000,
      timer,
    });
    const signal = AbortSignal.timeout(15000);
    try {
      const result = await auth(provider, {
        serverUrl: server.url,
        scope: server.auth.type === 'oauth' ? server.auth.scope : undefined,
        forceReauthorization: true,
        fetchFn: (url, init) => fetch(url, { ...init, signal }),
      });
      if (result !== 'REDIRECT' || !authorizationUrl)
        throw new Error('No authorization URL');
      return { authorizationUrl };
    } catch {
      this.cancelLogin(id);
      this.loginErrors.set(
        id,
        'Could not start OAuth. Check the endpoint and client registration.',
      );
      throw new ApplicationError('unavailable', this.loginErrors.get(id)!);
    }
  }
  async callback(query: {
    state?: string;
    code?: string;
    error?: string;
    iss?: string;
  }) {
    const entry = query.state ? this.pending.get(query.state) : undefined;
    if (!entry || entry.expires < Date.now())
      throw new ApplicationError(
        'invalid_input',
        'Login expired or state is invalid. Start login again in settings.',
      );
    const { server, provider } = entry;
    this.pending.delete(query.state!);
    clearTimeout(entry.timer);
    const signal = AbortSignal.timeout(15000);
    try {
      const current = await this.server(server.id);
      if (current.authEpoch !== server.authEpoch || query.error || !query.code)
        throw new Error('Login cancelled');
      const result = await auth(provider, {
        serverUrl: server.url,
        authorizationCode: query.code,
        iss: query.iss,
        fetchFn: (url, init) => fetch(url, { ...init, signal }),
      });
      if (result !== 'AUTHORIZED') throw new Error('Login incomplete');
      await provider.invalidateCredentials('verifier');
      await this.repository.loginChanged(server.id, server.authEpoch);
      this.loginErrors.delete(server.id);
    } catch {
      this.loginErrors.set(
        server.id,
        'OAuth was not completed. Check client registration and try login again.',
      );
      throw new ApplicationError(
        'invalid_input',
        this.loginErrors.get(server.id)!,
      );
    } finally {
      provider.endAuthorizationSession();
    }
  }

  apply() {
    return this.admission.apply(() => this.load());
  }
  async load() {
    const rows = await this.repository.list();
    return this.install(await this.discover(rows));
  }
  async loadAtStartup(
    retryDelaysMs: readonly number[] = STARTUP_DISCOVERY_RETRY_DELAYS_MS,
  ) {
    const rows = await this.repository.list();
    for (let attempt = 0; ; attempt++) {
      const candidate = await this.discover(rows);
      const retryInMs = retryDelaysMs[attempt];
      if (!candidate.retryableServers.length || retryInMs === undefined)
        return this.install(candidate);
      this.logger.warn({
        scope: 'MCP startup discovery',
        attempt: attempt + 1,
        maxAttempts: retryDelaysMs.length + 1,
        retryInMs,
        failedServers: candidate.retryableServers,
      });
      await candidate.client
        .disconnect()
        .catch(() => this.logger.warn('MCP retry cleanup failed'));
      await delay(retryInMs);
    }
  }
  private async discover(rows: Server[]): Promise<DiscoveryCandidate> {
    const servers: Record<string, MastraMCPServerDefinition> = {};
    for (const row of rows.filter((entry) => entry.enabled)) {
      servers[row.name] = {
        url: new URL(row.url),
        fetch: toolsOnlyFetch,
        enableServerLogs: false,
        connectTimeout: 5000,
        ...(row.auth.type === 'headers'
          ? { requestInit: { headers: row.auth.headers } }
          : {}),
        ...(row.auth.type === 'oauth'
          ? {
              authProvider: singleFlightOAuthProvider(
                this.provider(row, () => {}),
              ),
            }
          : {}),
        onToolError: 'return',
      };
    }
    // Tools-only host: MCP Apps UI resources, prompts, and resource rendering are unsupported.
    const client = new MCPClient({
      id: `pal-mcp-${randomUUID()}`,
      servers,
      timeout: 30000,
    });
    client.__setLogger(noopLogger);
    try {
      const discovery = await client.listToolsetsWithErrors({
        perServerTimeoutMs: 10000,
      });
      const tools: Record<string, Tool> = {};
      const catalogErrors = new Map<string, string>();
      const toolCounts = new Map<string, number>();
      for (const row of rows) {
        const toolset = discovery.toolsets[row.name];
        if (!toolset) continue;
        const candidates = Object.fromEntries(
          Object.entries(toolset).map(([name, tool]) => [
            `${row.name}_${name}`,
            tool,
          ]),
        );
        try {
          if (Object.keys(candidates).some((name) => name in tools))
            throw new Error('Duplicate namespaced tool');
          // Native stub generation rejects identifiers that collapse to the same
          // JavaScript name. Isolate that server rather than breaking startup.
          generateStubs({ ...tools, ...candidates });
          Object.assign(tools, candidates);
          toolCounts.set(row.name, Object.keys(candidates).length);
        } catch {
          catalogErrors.set(
            row.name,
            'Tool catalog cannot be represented safely in code mode. Check the server tool names and schemas.',
          );
        }
      }
      const instructions = client.getServerInstructions();
      const statuses = new Map<string, McpStatus>();
      for (const row of rows) {
        const detail = discovery.errorDetails[row.name];
        const state = !row.enabled
          ? 'disabled'
          : discovery.errors[row.name] || catalogErrors.has(row.name)
            ? client.getServerAuthState(row.name) === 'needs-auth' ||
              detail?.httpStatus === 401
              ? 'needs-auth'
              : 'error'
            : 'connected';
        statuses.set(row.id, {
          state,
          toolCount: toolCounts.get(row.name) ?? 0,
          ...(state === 'needs-auth'
            ? { error: 'Login required. Open MCP settings, login, then Apply.' }
            : state === 'error'
              ? {
                  error:
                    catalogErrors.get(row.name) ??
                    `Connection or discovery failed${detail?.httpStatus ? ` (HTTP ${detail.httpStatus})` : ''}. Check the server and retry Apply.`,
                }
              : {}),
        });
      }
      const unavailable = rows
        .filter((row) =>
          ['needs-auth', 'error'].includes(statuses.get(row.id)!.state),
        )
        .map((row) => `${row.name}: ${statuses.get(row.id)!.error}`);
      const catalog = [
        ...Object.entries(instructions)
          .filter(
            ([name, value]) =>
              value && !discovery.errors[name] && !catalogErrors.has(name),
          )
          .map(([name, value]) => `MCP server ${name} instructions:\n${value}`),
        unavailable.length
          ? `Unavailable MCP services:\n${unavailable.join('\n')}`
          : '',
        Object.keys(servers).length
          ? "Use MCP tools for connected services. Follow the user's requested or standing authorization for writes. If login is required, direct the user to MCP settings."
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      return {
        client,
        tools,
        catalog,
        statuses,
        applied: new Map(rows.map((row) => [row.id, row.version])),
        retryableServers: rows
          .filter(
            (row) =>
              row.enabled &&
              !!discovery.errors[row.name] &&
              statuses.get(row.id)?.state === 'error',
          )
          .map((row) => row.name),
      };
    } catch (error) {
      await client.disconnect();
      throw error;
    }
  }
  private async install(candidate: DiscoveryCandidate) {
    const previous = this.client;
    this.client = candidate.client;
    this.taskTools = candidate.tools;
    this.catalog = candidate.catalog;
    this.statuses = candidate.statuses;
    this.applied = candidate.applied;
    const diagnostic = catalogDiagnostics(
      createCodeModeInstructions({ tools: candidate.tools }) +
        '\n' +
        candidate.catalog,
      this.config.get<string>('PAL_AGENT_MODEL') ?? 'unknown',
      Object.keys(candidate.tools).length,
      this.config.get<number>('PAL_AGENT_CONTEXT_WINDOW_TOKENS'),
      this.config.get<number>('PAL_MCP_CATALOG_WARN_PERCENT') ?? 10,
    );
    const availableCatalog = {
      scope: 'available MCP catalog',
      ...diagnostic,
    };
    if (diagnostic.warning) this.logger.warn(availableCatalog);
    else this.logger.log(availableCatalog);
    await previous
      ?.disconnect()
      .catch(() => this.logger.warn('Previous MCP connection cleanup failed'));
    return this.list();
  }
  async onApplicationShutdown() {
    for (const entry of this.pending.values())
      this.cancelLogin(entry.server.id);
    await this.client?.disconnect();
  }
}
