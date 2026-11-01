import { createServer } from 'node:net';
import { createHmac, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HelperClient } from './helper-client.mjs';

test('authenticates every connection before sending a fill and never retries a lost write', async () => {
  const key = randomBytes(32);
  let mode = 'spoof', requests = 0;
  const frames = [];
  const server = createServer((socket) => {
    let buffer = '', nonce;
    const mac = (direction, body) => createHmac('sha256', key).update(direction + '\n' + nonce + '\n' + body).digest('hex');
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        const frame = JSON.parse(line); frames.push(frame);
        if (frame.hello) {
          nonce = frame.hello;
          socket.write(JSON.stringify({ mac: mode === 'spoof' ? '0'.repeat(64) : mac('hello', '') }) + '\n');
          continue;
        }
        requests++;
        if (mode === 'lost') { socket.destroy(); return; }
        const body = JSON.stringify({ status: 'filled' });
        socket.end(JSON.stringify({ body, mac: mode === 'replay' ? '0'.repeat(64) : mac('response', body) }) + '\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = new HelperClient('test-device'); client.port = server.address().port; client.key = key;
  const input = { action: 'fill', fields: [{ value: 'PRIVATE_SYNTHETIC_CANARY' }] };
  try {
    await assert.rejects(client.request(input), /fill response lost/);
    assert.equal(frames.length, 1); assert.equal(requests, 0);
    assert(!JSON.stringify(frames).includes('PRIVATE_SYNTHETIC_CANARY'), 'An unauthenticated peer received no secret payload');
    mode = 'valid'; assert.equal((await client.request(input)).status, 'filled');
    mode = 'replay'; await assert.rejects(client.request(input), /fill response lost/);
    const before = requests;
    mode = 'lost'; await assert.rejects(client.request(input), /fill response lost/);
    assert.equal(requests, before + 1, 'Lost mutation was dispatched exactly once');
  } finally { key.fill(0); await new Promise((resolve) => server.close(resolve)); }
});
