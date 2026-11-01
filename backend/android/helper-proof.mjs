import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { HelperClient } from './helper-client.mjs';

const directory = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const devices = execFileSync('adb', ['devices'], { encoding: 'utf8' }).split('\n').filter((s) => /\tdevice$/.test(s)).map((s) => s.split('\t')[0]);
assert.equal(devices.length, 1, 'Proof requires the single configured phone');
const helper = new HelperClient(devices[0], directory);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secret = ['pal-user-É漢字', 'pal-password-É漢字!72', '936721', 'PRIVATE_READONLY_CHILD_CANARY'];
const images = [];
async function inspect(action = 'inspect') {
  let result;
  for (let i = 0; i < 3; i++) {
    result = await helper.call({ action });
    if (result.status === 'ready') return result;
    await sleep(400);
  }
  assert.equal(result.status, 'ready', 'Native inspection must succeed: ' + JSON.stringify(result));
}
  const headers = { Authorization: 'Bearer ' + process.env.MOBILEMCP_AUTH, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
  let id = 1;
  async function rpc(method, params) {
    const response = await fetch('http://127.0.0.1:3000/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) });
    const session = response.headers.get('mcp-session-id'); if (session) headers['mcp-session-id'] = session;
    const text = await response.text();
    const message = JSON.parse(text.startsWith('event:') || text.startsWith('data:') ? text.split('\n').find((s) => s.startsWith('data:')).slice(5) : text);
    assert(!message.error, 'MCP protocol success'); return message.result;
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'pal-secure-proof', version: '1' } });
try {
  await helper.adb('install', '-r', directory + '/fixture.apk');
  for (const activity of ['Fixture', 'WebFixture']) {
    await helper.stop();
    await helper.adb('shell', 'am', 'force-stop', 'dev.pal.securefixture');
    await helper.adb('shell', 'am', 'start', '-W', '-n', 'dev.pal.securefixture/.' + activity);
    await sleep(600);
    for (const [i, role] of ['username', 'password', 'code'].entries()) {
      console.log('Checking ' + activity + ' stage: ' + role);
      const before = await inspect();
      console.log('Native inspection ready');
      assert.equal(before.identity.packageName, 'dev.pal.securefixture');
      assert.equal(before.inputs.length, 1, 'One native fixture field');
      const input = before.inputs[0];
      assert.equal(input.password, activity === 'Fixture' && role === 'password', 'Field password metadata');
      const target = { session: before.session, packageName: before.identity.packageName, fields: [{ ref: input.ref, role, value: secret[i] }] };
      if (i === 0) {
        const selectedPassword = await helper.call({ action: 'fill', ...target, fields: [{ ref: input.ref, role: 'password', value: secret[1] }] });
        assert.equal(selectedPassword.status, 'filled', 'Model-selected password role works without password metadata');
        const inspected = await inspect();
        for (const value of secret) assert(!JSON.stringify(inspected).includes(value), 'Non-password value omitted from metadata');
        target.fields[0].ref = inspected.inputs[0].ref;
      }
      const filled = await helper.call({ action: 'fill', ...target });
      assert.equal(filled.status, 'filled', 'Direct native field fill');
      console.log('Direct fill completed');
      const after = await inspect();
      assert.equal(after.status, 'ready', 'Observation after filling');
      for (const value of secret) assert(!JSON.stringify(after).includes(value), 'No value in private field metadata');
      const image = directory + '/preview-' + (activity === 'Fixture' ? '' : 'web-') + role + '.png';
      await writeFile(image, Buffer.from(after.image, 'base64')); images.push(image);
      await helper.stop();
      const screen = await rpc('tools/call', { name: 'mobile_list_elements_on_screen', arguments: { device: devices[0], format: 'json' } });
      assert(!screen.isError, 'Upstream inspection after private fill');
      const payload = screen.content.find((part) => part.type === 'text').text;
      const elements = JSON.parse(payload.slice(payload.indexOf('[')));
      const next = elements.find((e) => (e.text || e.label || '').toLowerCase() === (role === 'code' ? 'verify' : 'continue'));
      assert(next, 'Continue control from upstream');
      const tapped = await rpc('tools/call', { name: 'mobile_click_on_screen_at_coordinates', arguments: { device: devices[0], ref: next.ref } });
      assert(!tapped.isError, 'Upstream ref tap');
      await sleep(500);
      const stale = await helper.call({ action: 'validate', ...target });
      assert.equal(stale.status, 'error', 'Stopped helper invalidates secret refs');
    }
    await helper.stop();
    const final = await rpc('tools/call', { name: 'mobile_list_elements_on_screen', arguments: { device: devices[0] } });
    assert(JSON.stringify(final).includes('Authenticated'));
    assert(JSON.stringify(final).includes('Verified stages: username, password, transient code'));
  }
  // Exercise Mobile MCP after releasing the helper's UI automation connection.
  const launched = await rpc('tools/call', { name: 'mobile_launch_app', arguments: { device: devices[0], packageName: 'com.android.settings' } });
  assert(!launched.isError, 'Mobile MCP works after private helper');
  await sleep(500);
  const settings = await inspect();
  assert.equal(settings.identity.packageName, 'com.android.settings', 'Helper reconnects after Mobile MCP');
  await helper.stop();
  const clipboard = (text) => rpc('tools/call', { name: 'mobile_clipboard', arguments: { device: devices[0], ...(text === undefined ? {} : { text }) } });
  const previous = await clipboard();
  assert(!previous.isError, 'Upstream clipboard read is supported');
  const original = previous.content.filter((part) => part.type === 'text').map((part) => part.text).join('');
  try {
    assert(!(await clipboard('https://example.com/pal-android-acceptance')).isError, 'Upstream clipboard write');
    const copied = await clipboard();
    assert(!copied.isError && JSON.stringify(copied.content).includes('https://example.com/pal-android-acceptance'), 'Upstream clipboard round trip');
  } finally { assert(!(await clipboard(original)).isError, 'Restore previous clipboard'); }
  console.log(JSON.stringify({ status: 'passed', directFill: ['username', 'password', 'code'], webView: true, unicode: true, roleMetadataIsHint: true, staleGate: true, mcpHandoff: true, clipboard: true, previewImages: images }));
} finally { await helper.close(); }
