import { MCPClient, getMcpCallToolContent } from '@mastra/mcp';
const client = new MCPClient({
  id: 'pal-cua-preflight',
  registerProcessHooks: false,
  servers: {
    cua: {
      command: 'docker',
      args: [
        'exec',
        '-i',
        '-e',
        'CUA_DRIVER_RS_HOME=/tmp/pal-cua-comparison/state',
        '-e',
        'DO_NOT_TRACK=1',
        'pal-dev-split-execution-1',
        '/tmp/pal-cua-comparison/cua-driver',
        'mcp',
        '--socket',
        '/tmp/pal-cua-comparison/driver.sock',
      ],
    },
  },
});
try {
  const tools = await client.listTools();
  const tool = tools.cua_get_desktop_state;
  const output = await tool.execute({});
  const raw = getMcpCallToolContent(output);
  const converted = tool.toModelOutput(output);
  console.log(
    JSON.stringify({
      tools: Object.keys(tools).length,
      mcpImages: raw?.filter((c) => c.type === 'image').length,
      modelOutputType: converted.type,
      modelImages: Array.isArray(converted.value)
        ? converted.value.filter((c) => c.type === 'media').length
        : 0,
    }),
  );
} finally {
  await client.disconnect();
}
