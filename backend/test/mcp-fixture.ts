import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

export async function startMcpFixture() {
  let origin = '';
  let challenge = '';
  let refreshes = 0;
  let refreshAttempts = 0;
  let toolCalls = 0;
  let catalogVersion = 1;
  let currentAccess = 'fixture-access';
  let currentRefresh = 'fixture-refresh';
  let rotatingRefreshTokens = false;
  let advertisedApps = false;
  let unavailableConnections = 0;
  let failedConnections = 0;
  const json = (
    response: import('node:http').ServerResponse,
    status: number,
    data: unknown,
  ) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(data));
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', origin);
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp')
      return json(response, 200, {
        resource: origin + '/mcp',
        authorization_servers: [origin + '/'],
        scopes_supported: ['service:read', 'service:write', 'offline_access'],
      });
    if (url.pathname === '/.well-known/oauth-authorization-server')
      return json(response, 200, {
        issuer: origin + '/',
        authorization_endpoint: origin + '/authorize',
        token_endpoint: origin + '/token',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        authorization_response_iss_parameter_supported: true,
      });
    if (url.pathname === '/authorize') {
      challenge = url.searchParams.get('code_challenge')!;
      const redirect = new URL(url.searchParams.get('redirect_uri')!);
      redirect.searchParams.set('code', 'fixture-code');
      redirect.searchParams.set('state', url.searchParams.get('state')!);
      redirect.searchParams.set('iss', origin + '/');
      response.writeHead(302, { Location: redirect.toString() });
      response.end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    if (url.pathname === '/flaky' && unavailableConnections > 0) {
      unavailableConnections--;
      failedConnections++;
      return json(response, 404, {});
    }
    if (url.pathname === '/token') {
      const params = new URLSearchParams(body);
      if (
        params.get('client_id') !== 'fixture-client' ||
        params.get('client_secret') !== 'fixture-secret'
      )
        return json(response, 400, { error: 'invalid_client' });
      if (params.get('grant_type') === 'refresh_token') {
        refreshAttempts++;
        if (params.get('refresh_token') !== currentRefresh) {
          if (rotatingRefreshTokens)
            await new Promise((resolve) => setTimeout(resolve, 75));
          return json(response, 400, { error: 'invalid_grant' });
        }
        refreshes++;
        if (rotatingRefreshTokens) {
          currentRefresh = `fixture-refresh-${refreshes}`;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      } else if (
        params.get('code') !== 'fixture-code' ||
        createHash('sha256')
          .update(params.get('code_verifier') ?? '')
          .digest('base64url') !== challenge
      ) {
        return json(response, 400, { error: 'invalid_grant' });
      }
      return json(response, 200, {
        access_token: currentAccess,
        refresh_token: currentRefresh,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'service:read service:write offline_access',
      });
    }
    if (
      url.pathname !== '/mcp' &&
      url.pathname !== '/public' &&
      url.pathname !== '/flaky' &&
      url.pathname !== '/collision'
    )
      return json(response, 404, {});
    if (
      url.pathname === '/mcp' &&
      request.headers.authorization !== `Bearer ${currentAccess}`
    ) {
      response.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      );
      return json(response, 401, { error: 'unauthorized' });
    }
    if (request.method !== 'POST') {
      response.writeHead(405);
      response.end();
      return;
    }
    const rpc = JSON.parse(body) as {
      id?: number;
      method: string;
      params?: {
        name?: string;
        arguments?: { value?: number };
        capabilities?: { extensions?: Record<string, unknown> };
        _meta?: Record<string, { extensions?: Record<string, unknown> }>;
      };
    };
    if (
      rpc.params?.capabilities?.extensions?.['io.modelcontextprotocol/ui'] ||
      rpc.params?._meta?.['io.modelcontextprotocol/clientCapabilities']
        ?.extensions?.['io.modelcontextprotocol/ui']
    )
      advertisedApps = true;
    if (rpc.id === undefined) {
      response.writeHead(202);
      response.end();
      return;
    }
    let result: unknown;
    if (rpc.method === 'initialize')
      result = {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1' },
        instructions: 'Fixture service. Writes require user authorization.',
      };
    else if (rpc.method === 'tools/list' && url.pathname === '/collision')
      result = {
        tools: ['foo-bar', 'foo_bar'].map((name) => ({
          name,
          description: 'Collision fixture',
          inputSchema: { type: 'object', properties: {} },
        })),
      };
    else if (rpc.method === 'tools/list')
      result = {
        tools: [
          {
            name: catalogVersion === 1 ? 'lookup' : 'lookup_new',
            description: 'Read a fixture balance',
            inputSchema: { type: 'object', properties: {} },
            outputSchema: {
              type: 'object',
              properties: { balance: { type: 'number' } },
              required: ['balance'],
            },
          },
          {
            name: 'text',
            description: 'Read ordinary text',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'write',
            description: 'Write fixture value',
            inputSchema: {
              type: 'object',
              properties: { value: { type: 'number' } },
              required: ['value'],
            },
          },
          {
            name: 'fails',
            description: 'An in-band tool failure',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      };
    else if (rpc.method === 'tools/call') {
      toolCalls++;
      if (rpc.params?.name?.startsWith('lookup'))
        result = {
          content: [{ type: 'text', text: '{"balance":42}' }],
          structuredContent: { balance: 42 },
        };
      else if (rpc.params?.name === 'fails')
        result = {
          isError: true,
          content: [{ type: 'text', text: 'Fixture tool failed' }],
        };
      else
        result = {
          content: [
            {
              type: 'text',
              text:
                rpc.params?.name === 'write'
                  ? `saved ${rpc.params.arguments?.value}`
                  : 'ordinary text',
            },
          ],
        };
    } else
      return json(response, 200, {
        jsonrpc: '2.0',
        id: rpc.id,
        error: { code: -32601, message: 'Method not found' },
      });
    json(response, 200, { jsonrpc: '2.0', id: rpc.id, result });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error();
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    get refreshes() {
      return refreshes;
    },
    get refreshAttempts() {
      return refreshAttempts;
    },
    get toolCalls() {
      return toolCalls;
    },
    get advertisedApps() {
      return advertisedApps;
    },
    get failedConnections() {
      return failedConnections;
    },
    failConnections(count: number) {
      unavailableConnections = count;
    },
    changeCatalog() {
      catalogVersion = 2;
    },
    expireToken() {
      currentAccess = 'fixture-refreshed';
    },
    rotateRefreshTokens() {
      rotatingRefreshTokens = true;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
