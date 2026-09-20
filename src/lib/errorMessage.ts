import { ApiError } from '@/lib/apiError';

/**
 * Turns a caught error into copy a user should actually see — never a raw
 * "409: version_conflict" string. Returns '' for a deliberate cancellation,
 * since that's not a failure and callers should just not show anything.
 */
export function describeError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return '';
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return "You're offline. Check your connection and try again.";
  }

  if (err instanceof ApiError) {
    switch (err.code) {
      case 'stale_cursor':
        return 'The list changed while loading more — refreshing from the top.';
      case 'version_conflict':
        return 'Someone else updated this just now. Showing the latest version.';
      case 'legal_hold':
        return "This item is on legal hold and can't be moved to that status.";
      case 'invalid_name':
        return 'Name must be at least 3 characters.';
      case 'invalid_status':
      case 'invalid_tags':
        return 'That value is not valid for this field.';
      case 'too_many_ids':
        return 'Too many items in one request — try a smaller selection.';
    }
    if (err.status === 429) return 'Too many requests — retrying shortly…';
    if (err.status === 503) return 'The server is temporarily unavailable — retrying…';
    if (err.status >= 500) return 'Something went wrong on the server. Retrying…';
    if (err.status === 404) return "That item couldn't be found — it may have been removed.";
  }

  return 'Something went wrong. Please try again.';
}

/** Same idea, for the per-id codes bulk-status returns (API.md). */
export function describeBulkFailureCode(code?: string): string {
  switch (code) {
    case 'legal_hold':
      return 'on legal hold';
    case 'conflict':
      return 'conflicting update — retryable';
    case 'not_found':
      return 'no longer exists';
    case 'network_error':
      return 'network error — retryable';
    default:
      return 'failed';
  }
}