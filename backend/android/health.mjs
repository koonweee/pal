// Protocol readiness is independent of the phone being plugged in or authorized.
const response = await fetch('http://127.0.0.1:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${process.env.MOBILEMCP_AUTH}`,
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'pal-health', version: '1' },
    },
  }),
  signal: AbortSignal.timeout(4000),
});
if (!response.ok) process.exit(1);
const body = await response.text();
if (!body.includes('serverInfo')) process.exit(1);
