import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import {
  FIRST_PARTY_CONTRACT_HEADER,
  FIRST_PARTY_CONTRACT_VERSION,
  FIRST_PARTY_RELEASE_HEADER,
} from './first-party-contract.js';

const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class FirstPartyContractInterceptor implements NestInterceptor {
  private readonly releaseId: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.releaseId = config.getOrThrow<string>('PAL_RELEASE_ID');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    response.setHeader(
      FIRST_PARTY_CONTRACT_HEADER,
      String(FIRST_PARTY_CONTRACT_VERSION),
    );
    response.setHeader(FIRST_PARTY_RELEASE_HEADER, this.releaseId);

    const browserRequest = request.headers['sec-fetch-site'] !== undefined;
    const supplied = request.header(FIRST_PARTY_CONTRACT_HEADER);
    if (
      !readMethods.has(request.method) &&
      browserRequest &&
      supplied !== String(FIRST_PARTY_CONTRACT_VERSION)
    ) {
      throw new ConflictException(
        'This Pal client must update before making changes.',
      );
    }
    return next.handle();
  }
}
