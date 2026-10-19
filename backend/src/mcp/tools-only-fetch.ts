import type { MastraFetchLike } from '@mastra/mcp';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function omitApps(capabilities: unknown) {
  if (record(capabilities) && record(capabilities.extensions))
    delete capabilities.extensions['io.modelcontextprotocol/ui'];
}

// Mastra MCP 2.1.2 always adds the Apps extension and offers no disable flag.
// Pal has no MCP Apps renderer. Its supported HTTP fetch hook removes that
// advertisement from legacy initialization and modern per-request metadata so
// servers select ordinary text/structured tool responses.
export const toolsOnlyFetch: MastraFetchLike = (url, init) => {
  if (
    typeof init?.body === 'string' &&
    new Headers(init.headers).get('content-type')?.includes('application/json')
  ) {
    const message: unknown = JSON.parse(init.body);
    if (
      record(message) &&
      typeof message.method === 'string' &&
      record(message.params)
    ) {
      if (message.method === 'initialize')
        omitApps(message.params.capabilities);
      if (record(message.params._meta))
        omitApps(
          message.params._meta['io.modelcontextprotocol/clientCapabilities'],
        );
      return fetch(url, { ...init, body: JSON.stringify(message) });
    }
  }
  return fetch(url, init);
};
