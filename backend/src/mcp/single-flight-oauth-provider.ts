import {
  UnauthorizedError,
  auth,
  extractWWWAuthenticateParams,
  type AuthProvider,
  type OAuthClientProvider,
} from '@modelcontextprotocol/client';

/**
 * Adapts an OAuth provider for MCP connections while sharing one refresh across
 * concurrent 401 responses. The MCP TypeScript SDK currently starts a separate
 * auth transaction for each rejected request, which can replay a rotating
 * refresh token and invalidate the newly saved credentials.
 *
 * Before keeping this workaround during dependency upgrades, check Mastra's
 * MCP client version and the upstream fix status:
 * https://github.com/modelcontextprotocol/typescript-sdk/issues/1760
 * https://github.com/modelcontextprotocol/typescript-sdk/pull/2757
 * Remove the adapter once Mastra uses an MCP SDK release with equivalent
 * provider-level refresh coordination.
 */
export function singleFlightOAuthProvider(
  provider: OAuthClientProvider,
): AuthProvider {
  let refresh: Promise<void> | undefined;
  return {
    token: async () => (await provider.tokens())?.access_token,
    onUnauthorized: async ({ response, serverUrl, fetchFn }) => {
      const current =
        refresh ??
        (async () => {
          const { resourceMetadataUrl, scope } =
            extractWWWAuthenticateParams(response);
          const result = await auth(provider, {
            serverUrl,
            resourceMetadataUrl,
            scope,
            fetchFn,
          });
          if (result !== 'AUTHORIZED') throw new UnauthorizedError();
        })();
      refresh = current;
      try {
        await current;
      } finally {
        if (refresh === current) refresh = undefined;
      }
    },
  };
}
