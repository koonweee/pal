import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import httpProxy from 'http-proxy';

@Injectable()
export class AndroidViewerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly proxy = httpProxy.createProxyServer({ ws: true });
  private server?: Server;
  constructor(
    private readonly config: ConfigService,
    private readonly adapter: HttpAdapterHost,
  ) {
    this.proxy.on('error', (_error, _request, socket) => socket.destroy());
  }
  private readonly upgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    if (request.url !== '/android/viewer') return;
    const endpoint = this.config.get<string>('PAL_ANDROID_MCP_URL');
    const token = this.config.get<string>('PAL_ANDROID_MCP_TOKEN');
    // Same private gateway boundary as desktop. Reject cross-site browser use.
    let sameOrigin = false;
    try {
      sameOrigin =
        new URL(request.headers.origin ?? '').host === request.headers.host;
    } catch {
      /* missing or invalid origin */
    }
    if (!sameOrigin || !endpoint || !token) {
      socket.end(
        `HTTP/1.1 ${sameOrigin ? '503 Service Unavailable' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`,
      );
      return;
    }
    request.url = '/viewer';
    this.proxy.ws(request, socket, head, {
      target: new URL(endpoint).origin,
      headers: { authorization: `Bearer ${token}` },
    });
  };
  onApplicationBootstrap() {
    this.server = this.adapter.httpAdapter.getHttpServer() as Server;
    this.server.on('upgrade', this.upgrade);
  }
  onModuleDestroy() {
    this.server?.off('upgrade', this.upgrade);
    this.proxy.close();
  }
}
