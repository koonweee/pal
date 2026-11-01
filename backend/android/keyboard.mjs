import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { AdbServerClient } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy';
import { HidKeyboard } from '@yume-chan/aoa';
import { ReadableStream, WritableStream } from '@yume-chan/stream-extra';

// A control-only scrcpy session keeps Android's hardware-keyboard policy active
// even when no PWA viewer is open. Tango supplies the HID descriptor/protocol.
export function startKeyboard() {
  const abort = new AbortController();
  let adb, client;
  const closeSession = async () => {
    await client?.close().catch(() => {});
    await adb?.close().catch(() => {});
  };
  const run = (async () => {
    let warned = false;
    while (!abort.signal.aborted) {
      const timeout = setTimeout(() => void closeSession(), 15000);
      try {
        const host = new AdbServerClient(new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 }));
        adb = await host.createAdb({ serial: process.env.PAL_ANDROID_DEVICE_ID });
        if (abort.signal.aborted) break;
        const path = '/data/local/tmp/pal-keyboard-server.jar';
        const bytes = new Uint8Array(await readFile('/opt/android/scrcpy-server'));
        await AdbScrcpyClient.pushServer(adb, new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), path);
        client = await AdbScrcpyClient.start(adb, path, new AdbScrcpyOptions3_3_3({
          video: false, audio: false, control: true, powerOn: false,
          tunnelForward: true, clipboardAutosync: false,
          scid: Math.floor(Math.random() * 0x7fffffff).toString(16),
        }));
        void client.output.pipeTo(new WritableStream({ write() {} })).catch(() => {});
        if (abort.signal.aborted) break;
        await client.controller.uHidCreate({ id: 1, vendorId: 0, productId: 0, name: 'Pal keyboard', data: HidKeyboard.DESCRIPTOR });
        const result = await adb.subprocess.shellProtocol.spawnWaitText(['settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '0']);
        if (result.exitCode !== 0) throw Error('Keyboard setting unavailable');
        clearTimeout(timeout);
        console.log('Android hardware keyboard connected');
        warned = false;
        await client.exited;
      } catch {
        if (!abort.signal.aborted && !warned) {
          console.warn('Android hardware keyboard unavailable; reconnecting');
          warned = true;
        }
      } finally {
        clearTimeout(timeout);
        await closeSession();
        adb = undefined; client = undefined;
      }
      await delay(3000, undefined, { signal: abort.signal }).catch(() => {});
    }
  })();
  return async () => { abort.abort(); await closeSession(); await run; };
}
