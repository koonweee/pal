import { ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ApplicationError } from '../../application/contracts/errors.js';

const status = {
  invalid_input: 400,
  too_large: 413,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
} as const;

/** Maps application failures to the first-party HTTP protocol. */
@Catch(ApplicationError)
export class ApplicationErrorFilter implements ExceptionFilter {
  catch(error: ApplicationError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status[error.code])
      .json({
        statusCode: status[error.code],
        message: error.message,
        ...(error.details && typeof error.details === 'object'
          ? error.details
          : {}),
      });
  }
}
