import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/** Rejects cross-site browser mutations while leaving native/private clients usable. */
@Injectable()
export class BrowserOriginGuard implements CanActivate {
  private readonly publicOrigin: string;
  constructor(@Inject(ConfigService) config: ConfigService) {
    this.publicOrigin = new URL(
      config.get<string>('PAL_PUBLIC_URL') ?? 'http://localhost:3000/',
    ).origin;
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const origin = request.headers.origin;
    if (!origin) return true;
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite === 'same-origin' || origin === this.publicOrigin)
      return true;
    throw new ForbiddenException('Cross-origin browser mutation rejected');
  }
}
