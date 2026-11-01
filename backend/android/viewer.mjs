import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { AdbServerClient } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy';
import { ReadableStream, WritableStream } from '@yume-chan/stream-extra';

// Tango owns ADB and scrcpy. This bridge only transports its media packets and
// serialized control messages; it exposes no shell or generic ADB endpoint.
export function attachViewer(server, token) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  const sessions = new Set();
  server.on('upgrade', (request, socket, head) => {
    const actual = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from('Bearer ' + token);
    if (request.url !== '/viewer' || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(request, socket, head, ws => void run(ws));
  });
  async function run(ws) {
    let adb, client;
    let stopped = false;
    const stop = async () => {
      stopped = true;
      ws.close();
      await client?.close().catch(() => {});
      await adb?.close().catch(() => {});
    };
    sessions.add(stop);
    ws.on('error', () => void stop());
    ws.once('close', () => void stop());
    const timeout = setTimeout(() => void stop(), 15000);
    let controls = Promise.resolve();
    ws.on('message', (data, binary) => {
      if (!binary || !client?.controller) return;
      controls = controls.then(() => client.controller.write(new Uint8Array(data))).catch(() => stop());
    });
    try {
      const host = new AdbServerClient(new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 }));
      adb = await host.createAdb({ serial: process.env.PAL_ANDROID_DEVICE_ID });
      if (stopped) return;
      const bytes = new Uint8Array(await readFile('/opt/android/scrcpy-server'));
      await AdbScrcpyClient.pushServer(adb, new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }));
      if (stopped) return;
      client = await AdbScrcpyClient.start(adb, '/data/local/tmp/scrcpy-server.jar', new AdbScrcpyOptions3_3_3({
        audio: false, maxSize: 1280, maxFps: 30, videoBitRate: 4000000,
        tunnelForward: true, clipboardAutosync: false,
        scid: Math.floor(Math.random() * 0x7fffffff).toString(16),
      }));
      void client.output.pipeTo(new WritableStream({ write() {} })).catch(() => {});
      if (stopped) return;
      const video = await client.videoStream;
      ws.send(JSON.stringify({ codec: video.metadata.codec }));
      clearTimeout(timeout);
      await video.stream.pipeTo(new WritableStream({
        write(packet) {
          if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 4 * 1024 * 1024) throw Error('Viewer disconnected or too slow');
          // A nine-byte envelope retains Tango's packet kind/keyframe/PTS.
          const header = Buffer.alloc(9);
          header[0] = packet.type === 'configuration' ? 0 : packet.keyframe ? 2 : 1;
          header.writeBigUInt64BE(packet.type === 'data' ? packet.pts ?? 0n : 0n, 1);
          return new Promise((resolve, reject) => ws.send(Buffer.concat([header, packet.data]), error => error ? reject(error) : resolve()));
        },
      }));
    } catch {
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Phone unavailable');
    } finally {
      clearTimeout(timeout);
      await stop();
      sessions.delete(stop);
    }
  }
  return async () => { await Promise.all([...sessions].map(stop => stop())); wss.close(); };
}
