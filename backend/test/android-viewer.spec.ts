import { test, expect } from 'vitest';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AndroidViewerService } from '../src/android/android-viewer.service.js';

test('phone gateway rejects cross-origin and unconfigured connections and injects the private token', async () => {
  const upstream = createServer();
  upstream.on('upgrade', (req, socket) => {
    expect(req.url).toBe('/viewer');
    expect(req.headers.authorization).toBe('Bearer private-test-token');
    socket.end(
      'HTTP/1.1 418 Test Reached\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
    );
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const server = createServer();
  const config = new ConfigService();
  const service = new AndroidViewerService(config, {
    httpAdapter: { getHttpServer: () => server },
  } as HttpAdapterHost);
  service.onApplicationBootstrap();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const connect = (origin: string) =>
    new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        `http://${host}/android/viewer`,
        { headers: { origin, connection: 'Upgrade', upgrade: 'websocket' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
  try {
    expect(await connect('https://another-site.example')).toBe(403);
    expect(await connect(`http://${host}`)).toBe(503);
    config.set(
      'PAL_ANDROID_MCP_URL',
      `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/mcp`,
    );
    config.set('PAL_ANDROID_MCP_TOKEN', 'private-test-token');
    expect(await connect(`http://${host}`)).toBe(418);
  } finally {
    service.onModuleDestroy();
    server.closeAllConnections();
    server.close();
    upstream.closeAllConnections();
    upstream.close();
  }
});
