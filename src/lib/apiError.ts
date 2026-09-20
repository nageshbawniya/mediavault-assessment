/**
 * Thrown by the API client for any non-2xx response. Carries the HTTP
 * status and the server's error `code` (see API.md) as real fields, not
 * buried in a message string — so callers can do `err.status === 409`
 * instead of parsing `"409: ..."` out of an error message.
 *
 * Used by Task 3 (detecting version_conflict) and Task 4 (deciding what's
 * retryable) — one error shape serving both, instead of two ad-hoc patterns.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string | undefined, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}