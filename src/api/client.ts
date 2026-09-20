import { ApiError } from '@/lib/apiError';
import { runWithConcurrency } from '@/lib/concurrency';
import { withRetry } from '@/lib/retry';
import type { Asset, AssetPage, AssetQuery, BulkResult } from '@/lib/types';

/**
 * In local dev, this stays empty and every request is a relative path
 * (`/api/...`), which Vite's dev-server proxy forwards to the mock API.
 * In production, frontend and backend are deployed separately (Vercel +
 * Render), so VITE_API_BASE_URL points at the deployed backend's origin
 * instead — set it in the hosting platform's environment variables, not
 * committed to the repo.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status?.length) params.set('status', query.status.join(','));
  if (query.kind?.length) params.set('kind', query.kind.join(','));
  if (query.tag?.length) params.set('tag', query.tag.join(','));
  if (query.collectionId) params.set('collectionId', query.collectionId);
  if (query.owner) params.set('owner', query.owner);
  if (query.sort) params.set('sort', query.sort);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  return params.toString();
}

async function requestOnce<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let code: string | undefined;
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body?.error?.code;
      message = body?.error?.message ?? message;
    } catch {
      /* response was not JSON */
    }
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
    throw new ApiError(res.status, code, message, retryAfterSeconds);
  }
  return res.json() as Promise<T>;
}

/**
 * Every call through here gets retry-with-backoff for free (503/429/5xx),
 * respecting the caller's AbortSignal so a cancelled request doesn't sit
 * through a backoff wait it no longer needs.
 */
function request<T>(path: string, init?: RequestInit): Promise<T> {
  const signal = init?.signal instanceof AbortSignal ? init.signal : undefined;
  return withRetry(() => requestOnce<T>(path, init), { signal });
}

const inFlightListRequests = new Map<string, Promise<AssetPage>>();

/**
 * De-duplicates identical concurrent GET /api/assets calls.
 *
 * Important: the underlying shared fetch is deliberately NOT tied to any
 * one caller's AbortSignal. Two callers can legitimately share this
 * promise (React StrictMode's double-invoked effects in dev, or two
 * components requesting the same page) — if caller A's signal aborted the
 * real network request, caller B would lose its response too, even though
 * B never asked to cancel anything. Instead, each caller gets its own
 * abortable *view* of the shared promise below; aborting only rejects that
 * caller's local promise, never the underlying request.
 */
export function listAssets(query: AssetQuery, signal?: AbortSignal): Promise<AssetPage> {
  const qs = toSearchParams(query);
  let shared = inFlightListRequests.get(qs);
  if (!shared) {
    shared = request<AssetPage>(`${API_BASE}/api/assets?${qs}`).finally(() => {
      inFlightListRequests.delete(qs);
    });
    inFlightListRequests.set(qs, shared);
  }

  if (!signal) return shared;

  return new Promise<AssetPage>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    shared.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export function getAsset(id: string, signal?: AbortSignal): Promise<Asset> {
  return request<Asset>(`${API_BASE}/api/assets/${id}`, { signal });
}

export function getAssetsByIds(ids: string[]): Promise<{ items: Asset[]; missing: string[] }> {
  // Note: the endpoint rejects more than 25 ids per call.
  return request(`${API_BASE}/api/assets/batch?ids=${ids.join(',')}`);
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, 'name' | 'status' | 'tags'>>,
): Promise<Asset> {
  return request<Asset>(`${API_BASE}/api/assets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version, patch }),
  });
}

export function bulkSetStatus(ids: string[], status: Asset['status']): Promise<BulkResult> {
  // Note: the endpoint rejects more than 50 ids per call.
  return request<BulkResult>(`${API_BASE}/api/assets/bulk-status`, {
    method: 'POST',
    body: JSON.stringify({ ids, status }),
  });
}

export type BulkItemResult = BulkResult['results'][number];

const BULK_CHUNK_SIZE = 50;
const BULK_CONCURRENCY = 3;

export async function bulkSetStatusChunked(
  ids: string[],
  status: Asset['status'],
): Promise<BulkItemResult[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += BULK_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + BULK_CHUNK_SIZE));
  }

  const chunkResults = await runWithConcurrency(chunks, BULK_CONCURRENCY, (chunk) =>
    bulkSetStatus(chunk, status).then(
      (result) => result.results,
      (err: unknown): BulkItemResult[] =>
        chunk.map((id) => ({
          id,
          ok: false,
          code: 'network_error',
          message: err instanceof Error ? err.message : 'Request failed',
        })),
    ),
  );

  return chunkResults.flat();
}

export const thumbnailUrl = (id: string) => `${API_BASE}/api/thumb/${id}.svg`;