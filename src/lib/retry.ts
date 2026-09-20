import { ApiError } from '@/lib/apiError';

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  isRetryable?: (err: unknown) => boolean;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Default policy, matching API.md exactly:
 *  - 429 (rate limited) and 503 (upstream_unavailable) are transient -> retry
 *  - 500 write_failed is explicitly "safe to retry" -> retry
 *  - 400/409/422 are correctness errors (bad request, version conflict,
 *    validation) -> retrying changes nothing, don't
 *  - a network-level failure (fetch throws, not an HTTP response at all)
 *    surfaces as a plain TypeError in browsers -> retry
 *  - a deliberate cancellation is not a failure at all -> never retry
 */
function isRetryableDefault(err: unknown): boolean {
  if (isAbortError(err)) return false;
  // No point burning through backoff attempts while we already know we're
  // offline — fail fast with a clear message instead of a multi-second
  // retry sequence that was never going to succeed.
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  if (err instanceof ApiError) {
    return err.status === 429 || err.status === 503 || err.status >= 500;
  }
  return err instanceof TypeError;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Retries `fn` with exponential backoff + jitter. Jitter matters here
 * specifically because a rate-limit 429 tends to hit every open tab/request
 * at once — without jitter they'd all retry on the same tick and trip the
 * limit again immediately.
 *
 * If the server sent Retry-After (ApiError.retryAfterSeconds), that wins
 * over our own computed delay — the server knows its own recovery time
 * better than a guess does.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 300,
    maxDelayMs = 5000,
    signal,
    isRetryable = isRetryableDefault,
  } = options;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;

      const serverDelayMs =
        err instanceof ApiError && err.retryAfterSeconds !== undefined
          ? err.retryAfterSeconds * 1000
          : undefined;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitter = Math.random() * backoff * 0.3;

      await delay(serverDelayMs ?? backoff + jitter, signal);
      attempt++;
    }
  }
}