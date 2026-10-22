import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { Workspace } from '@mastra/core/workspace';
import { RequestContext } from '@mastra/core/request-context';
import { createCodeMode, noopObserve } from '@mastra/core/tools';
import { noopLogger } from '@mastra/core/logger';
import { MCPClient } from '@mastra/mcp';
import { startMcpFixture } from '../../test/mcp-fixture.ts';
import { ExecutionService } from '../../dist/execution/execution.service.js';
import { toolsOnlyFetch } from '../../dist/mcp/tools-only-fetch.js';

const execution = new ExecutionService(new ConfigService(process.env));
const fixture = await startMcpFixture();
const client = new MCPClient({
  id: 'split-mcp-check',
  servers: {
    fixture: {
      url: new URL(fixture.origin + '/public'),
      fetch: toolsOnlyFetch,
      enableServerLogs: false,
    },
  },
});
client.__setLogger(noopLogger);
const workspace = new Workspace({
  filesystem: execution.filesystem,
  sandbox: execution.sandbox,
});
try {
  await workspace.init();
  const tools = await client.listTools();
  const code = createCodeMode({ tools, timeout: 10000 });
  const result = await code.tool.execute(
    {
      code: 'return await Promise.all([external_fixture_lookup({}), external_fixture_text({})]);',
    },
    { workspace, requestContext: new RequestContext(), observe: noopObserve },
  );
  assert.equal(result.success, true, JSON.stringify(result));
  assert.match(JSON.stringify(result.result), /42/);
  assert.match(JSON.stringify(result.result), /ordinary text/);
  assert.equal(fixture.toolCalls, 2);
  console.log(
    'PASS: native execution code mode calls actual service-side MCP tools in parallel',
  );
} finally {
  await client.disconnect();
  await fixture.close();
  await workspace.destroy();
}
