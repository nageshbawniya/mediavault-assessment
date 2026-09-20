import { useCallback, useEffect, useRef, useState } from 'react';
import { listAssets } from '@/api/client';
import { describeError } from '@/lib/errorMessage';
import type { Asset, AssetQuery } from '@/lib/types';

interface State {
  items: Asset[];
  total: number;
  nextCursor: string | null;
  loadingInitial: boolean;
  loadingMore: boolean;
  error: string | null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Same race-safety pattern as useAssets (requestId + abort), extended to
 * accumulate pages instead of replacing them.
 *
 * `baseQuery` excludes `cursor` on purpose — cursor is internal state here,
 * never something a caller passes in. Changing any field of `baseQuery`
 * (search, status, sort) resets to page one, because a cursor is bound to
 * the query that produced it (API.md: reusing one after a filter change is
 * a 400 stale_cursor) — so the only safe move is to drop it and refetch.
 */
export function useInfiniteAssets(baseQuery: Omit<AssetQuery, 'cursor'>) {
  const [state, setState] = useState<State>({
    items: [],
    total: 0,
    nextCursor: null,
    loadingInitial: true,
    loadingMore: false,
    error: null,
  });

  const requestIdRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const baseKey = JSON.stringify(baseQuery);
  const [retryTick, setRetryTick] = useState(0);

  // Lets a caller force page one to reload without changing the query —
  // used to auto-resume after the browser comes back online.
  const refetch = useCallback(() => setRetryTick((t) => t + 1), []);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    setState({
      items: [],
      total: 0,
      nextCursor: null,
      loadingInitial: true,
      loadingMore: false,
      error: null,
    });

    listAssets(baseQuery, controller.signal)
      .then((page) => {
        if (requestId !== requestIdRef.current) return;
        setState({
          items: page.items,
          total: page.total,
          nextCursor: page.nextCursor,
          loadingInitial: false,
          loadingMore: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        if (requestId !== requestIdRef.current) return;
        setState((s) => ({
          ...s,
          loadingInitial: false,
          error: describeError(err),
        }));
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, retryTick]);

  const fetchNextPage = useCallback(() => {
    const current = stateRef.current;
    if (!current.nextCursor || current.loadingMore || current.loadingInitial) return;

    const requestId = ++requestIdRef.current;
    setState((s) => ({ ...s, loadingMore: true }));

    listAssets({ ...baseQuery, cursor: current.nextCursor } as AssetQuery)
      .then((page) => {
        if (requestId !== requestIdRef.current) return; // filters changed since
        setState((prev) => ({
          items: [...prev.items, ...page.items],
          total: page.total,
          nextCursor: page.nextCursor,
          loadingInitial: false,
          loadingMore: false,
          error: null,
        }));
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        if (requestId !== requestIdRef.current) return;
        setState((s) => ({
          ...s,
          loadingMore: false,
          error: describeError(err),
        }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);

  // Replaces one loaded asset in place. Used two ways: (1) optimistic bulk
  // updates write a locally-guessed version immediately, then overwrite it
  // with the server's real object once the request resolves — or restore
  // the original if it failed; (2) the detail panel's save calls this too,
  // which is what fixes the "list shows a stale row after editing" defect.
  const setAssetLocally = useCallback((asset: Asset) => {
    setState((s) => ({
      ...s,
      items: s.items.map((a) => (a.id === asset.id ? asset : a)),
    }));
  }, []);

  return {
    ...state,
    hasMore: state.nextCursor !== null,
    fetchNextPage,
    setAssetLocally,
    refetch,
  };
}