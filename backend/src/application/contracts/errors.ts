export type ApplicationErrorCode =
  'invalid_input' | 'too_large' | 'not_found' | 'conflict' | 'unavailable';

/** Error classification translated into protocol-specific failures by adapters. */
export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
