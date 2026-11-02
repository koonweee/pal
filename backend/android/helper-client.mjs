import { execFile, spawn } from 'node:child_process';
import { connect } from 'node:net';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const helperPackage = 'dev.pal.secureentry';
const helperProtocol = 1;

function compatible(result, allowLegacy = false) {
  return result?.status === 'ready' &&
    (result.protocol === helperProtocol ||
      (allowLegacy && result.protocol === undefined));
}

/** Calls are serialized by the sidecar. This transport never retries a write. */
export class HelperClient {
  constructor(device, directory = '/opt/android') {
    if (!device) throw new Error('Android device is not configured');
    this.device = device;
    this.directory = directory;
  }
  async adb(...args) {
    try {
      return (await exec('adb', ['-s', this.device, ...args], {
        timeout: 30000, maxBuffer: 1024 * 1024,
      })).stdout.trim();
    } catch { throw new Error('Android helper device operation failed'); }
  }
  async start() {
    if (this.process && this.process.exitCode === null) return;
    const installed = this.installed ||
      (await this.adb('shell', 'pm', 'path', helperPackage)).startsWith('package:');
    if (installed) {
      this.installed = true;
      try {
        const ready = await this.launch(true);
        if (compatible(ready, true)) {
          this.installed = true;
          return;
        }
      } catch { /* Replace an unusable Pal-owned helper below. */ }
      await this.stop().catch(() => {});
      await this.adb('uninstall', helperPackage);
      this.installed = false;
    }
    try { await this.launch(); }
    catch {
      await this.stop().catch(() => {});
      await this.removeForward().catch(() => {});
      throw new Error('Android helper could not start');
    }
  }
  async removeForward() {
    if (!this.port) return;
    const rows = (await this.adb('forward', '--list')).split('\n').map((line) => line.split(/\s+/));
    if (rows.some(([device, port, target]) => device === this.device && port === 'tcp:' + this.port && target === 'localabstract:' + this.socketName))
      await this.adb('forward', '--remove', 'tcp:' + this.port);
    this.port = undefined;
    this.socketName = undefined;
  }
  async launch(allowLegacy = false) {
    // Android has one UI Automation connection. Mobile CLI has no public
    // Android stop command; release its exact pinned DeviceServer process.
    await this.adb('shell', "pkill -f 'com.mobilenext.mobilecli.[D]eviceServer' || [ $? -eq 1 ]");
    if (!this.installed) {
      await this.adb('install', this.directory + '/helper.apk');
      this.installed = true;
    }
    await this.removeForward();
    const socketName = 'pal_secure_' + randomBytes(16).toString('hex');
    this.key?.fill(0);
    this.key = randomBytes(32);
    await this.adb('shell', 'run-as', 'dev.pal.secureentry', 'mkdir', '-p', 'cache');
    // Bootstrap only a session authentication key into app-private cache. ADB
    // stdin carries it; no credentials or key enter command-line arguments.
    await new Promise((resolve, reject) => {
      const copy = spawn('adb', ['-s', this.device, 'shell', '-T', 'run-as', 'dev.pal.secureentry', 'dd', 'of=cache/bridge-key'], { timeout: 30000, stdio: ['pipe', 'ignore', 'ignore'] });
      copy.on('error', () => reject(new Error('Android helper authentication bootstrap failed')));
      copy.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Android helper authentication bootstrap failed')));
      copy.stdin.on('error', () => {});
      copy.stdin.end(this.key);
    });
    await this.adb('shell', 'run-as', 'dev.pal.secureentry', 'chmod', '600', 'cache/bridge-key');
    this.socketName = socketName;
    this.port = Number(await this.adb('forward', 'tcp:0', 'localabstract:' + socketName));
    if (!Number.isInteger(this.port) || this.port <= 0) throw new Error('Android helper forwarding failed');
    this.process = spawn('adb', ['-s', this.device, 'shell', 'am', 'instrument', '-e', 'socket', socketName, '-w', 'dev.pal.secureentry/.Bridge'], { stdio: 'ignore' });
    this.process.on('error', () => {});
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const ready = await this.request({ action: 'ping' }, 1000);
        if (!compatible(ready, allowLegacy))
          throw new Error('Android helper protocol mismatch');
        return ready;
      }
      catch { await wait(100); }
    }
    throw new Error('Android helper could not start');
  }
  request(input, timeout = 20000) {
    const nonce = randomBytes(16).toString('hex');
    const body = JSON.stringify(input);
    const mac = (direction, value) => createHmac('sha256', this.key).update(direction + '\n' + nonce + '\n' + value).digest();
    const payload = JSON.stringify({ nonce, body, mac: mac('request', body).toString('hex') });
    return new Promise((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: this.port });
      let output = '';
      let settled = false;
      let authenticated = false;
      const fail = () => {
        if (settled) return;
        settled = true; socket.destroy();
        reject(new Error(input.action === 'fill' ? 'Android fill response lost; inspect without refilling' : 'Android helper unavailable'));
      };
      socket.setTimeout(timeout, fail);
      socket.on('error', fail);
      socket.on('end', () => { if (!settled) fail(); });
      socket.on('connect', () => { socket.write(JSON.stringify({ hello: nonce }) + '\n'); });
      socket.on('data', (chunk) => {
        output += chunk;
        if (output.length > 12 * 1024 * 1024) { fail(); return; }
        while (output.includes('\n') && !settled) {
          const end = output.indexOf('\n');
          const line = output.slice(0, end); output = output.slice(end + 1);
          try {
            const envelope = JSON.parse(line);
            if (typeof envelope.mac !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.mac)) { fail(); return; }
            if (!authenticated) {
              if (!timingSafeEqual(mac('hello', ''), Buffer.from(envelope.mac, 'hex'))) { fail(); return; }
              authenticated = true;
              // Each connection proves helper identity before any secret leaves
              // this process. A stale/replaced socket cannot collect a fill.
              socket.write(payload + '\n');
              continue;
            }
            if (typeof envelope.body !== 'string' || !timingSafeEqual(mac('response', envelope.body), Buffer.from(envelope.mac, 'hex'))) { fail(); return; }
            const result = JSON.parse(envelope.body);
            settled = true; socket.end(); resolve(result);
          } catch { fail(); }
        }
      });
    });
  }
  async call(input) {
    await this.start();
    return this.request(input);
  }
  async stop() {
    try {
      if (this.process) {
        try { await this.request({ action: 'stop' }, 2000); } catch { /* No secret mutation is repeated. */ }
        for (let i = 0; i < 20 && this.process.exitCode === null; i++) await wait(50);
      }
      // Also settles an orphan from a killed/replaced sidecar. This package is
      // owned solely by Pal; installed user apps and logins are untouched.
      const installed = this.installed || await this.adb('shell', 'pm', 'path', helperPackage);
      if (installed) {
        await this.adb('shell', 'am', 'force-stop', helperPackage);
        await this.adb('shell', 'run-as', helperPackage, 'rm', '-f', 'cache/bridge-key');
      }
    } finally {
      this.process?.kill(); this.process = undefined;
      this.key?.fill(0); this.key = undefined;
      await this.removeForward();
    }
  }
  async close() {
    try { await this.stop(); } finally { await this.removeForward(); }
  }
}
