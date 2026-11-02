import { createServer } from 'node:net';
import { createHmac, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HelperClient } from './helper-client.mjs';

class LifecycleClient extends HelperClient {
  constructor({ installed, launches }) {
    super('test-device');
    this.packageInstalled = installed;
    this.launches = [...launches];
    this.commands = [];
  }
  async adb(...args) {
    this.commands.push(args);
    if (args[0] === 'shell' && args[1] === 'pm' && args[2] === 'path')
      return this.packageInstalled ? 'package:/data/app/helper/base.apk' : '';
    if (args[0] === 'uninstall') {
      this.packageInstalled = false;
      return 'Success';
    }
    if (args[0] === 'install') {
      this.packageInstalled = true;
      this.installed = true;
      return 'Success';
    }
    return '';
  }
  async launch() {
    if (!this.installed && !this.packageInstalled)
      await this.adb('install', this.directory + '/helper.apk');
    const next = this.launches.shift();
    if (next instanceof Error) throw next;
    return next;
  }
  async stop() {
    this.commands.push(['stop']);
  }
  async removeForward() {}
}

test('reuses one compatible helper installation across environments', async () => {
  const client = new LifecycleClient({
    installed: true,
    launches: [{ status: 'ready' }],
  });
  await client.start();
  assert.equal(client.installed, true);
  assert.equal(client.commands.some(([name]) => name === 'install'), false);
  assert.equal(client.commands.some(([name]) => name === 'uninstall'), false);
});

test('installs a missing helper and replaces an incompatible helper', async () => {
  const missing = new LifecycleClient({
    installed: false,
    launches: [{ status: 'ready', protocol: 1 }],
  });
  await missing.start();
  assert.equal(missing.commands.filter(([name]) => name === 'install').length, 1);

  const incompatible = new LifecycleClient({
    installed: true,
    launches: [
      { status: 'ready', protocol: 2 },
      { status: 'ready', protocol: 1 },
    ],
  });
  await incompatible.start();
  assert.equal(
    incompatible.commands.filter(([name]) => name === 'uninstall').length,
    1,
  );
  assert.equal(
    incompatible.commands.filter(([name]) => name === 'install').length,
    1,
  );
});

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
