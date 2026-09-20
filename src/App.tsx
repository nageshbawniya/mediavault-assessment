import { useCallback, useEffect, useRef, useState } from 'react';
import { bulkSetStatusChunked } from '@/api/client';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useInfiniteAssets } from '@/features/assets/useInfiniteAssets';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { describeBulkFailureCode } from '@/lib/errorMessage';
import { statusLabel } from '@/lib/format';
import type { Asset, AssetStatus, AssetQuery } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
const SORTS: Array<{ value: NonNullable<AssetQuery['sort']>; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'createdAt:desc', label: 'Newest' },
];

const SEARCH_DEBOUNCE_MS = 400;

interface BulkFailure {
  id: string;
  name: string;
  code?: string;
  message?: string;
}

function describeBulkOutcome(appliedCount: number, failures: BulkFailure[]): string {
  if (failures.length === 0) return `${appliedCount} updated.`;
  const legalHold = failures.filter((f) => f.code === 'legal_hold').length;
  const retryable = failures.length - legalHold;
  const parts = [`${appliedCount} updated`];
  if (legalHold > 0) parts.push(`${legalHold} on legal hold — can't be changed`);
  if (retryable > 0) parts.push(`${retryable} failed — can retry`);
  return parts.join(', ') + '.';
}

export function App() {
  const [qInput, setQInput] = useState('');
  const q = useDebouncedValue(qInput, SEARCH_DEBOUNCE_MS);
  const [status, setStatus] = useState<AssetStatus[]>([]);
  const [sort, setSort] = useState<NonNullable<AssetQuery['sort']>>('updatedAt:desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkFailures, setBulkFailures] = useState<BulkFailure[] | null>(null);
  const [bulkTargetStatus, setBulkTargetStatus] = useState<AssetStatus | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const lastToggledIdRef = useRef<string | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  const online = useOnlineStatus();
  const wasOnlineRef = useRef(online);

  const baseQuery = { q, status, sort, limit: 24 };
  const {
    items,
    total,
    loadingInitial,
    loadingMore,
    hasMore,
    error,
    fetchNextPage,
    setAssetLocally,
    refetch,
  } = useInfiniteAssets(baseQuery);
  const queryKey = JSON.stringify(baseQuery);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [queryKey]);

  useEffect(() => {
    if (!wasOnlineRef.current && online) {
      refetch();
    }
    wasOnlineRef.current = online;
  }, [online, refetch]);

  const toggleSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && lastToggledIdRef.current) {
          const ids = items.map((a) => a.id);
          const fromIdx = ids.indexOf(lastToggledIdRef.current);
          const toIdx = ids.indexOf(id);
          if (fromIdx !== -1 && toIdx !== -1) {
            const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
            for (let i = start; i <= end; i++) {
              const rangeId = ids[i];
              if (rangeId) next.add(rangeId);
            }
          }
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      lastToggledIdRef.current = id;
    },
    [items],
  );

  const selectAllLoaded = useCallback(() => {
    setSelectedIds(new Set(items.map((a) => a.id)));
  }, [items]);

  const openAsset = useCallback((id: string) => {
    lastTriggerRef.current = document.activeElement as HTMLElement | null;
    setActiveId(id);
  }, []);

  const closeAsset = useCallback(() => {
    setActiveId(null);
    requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }, []);

  async function runBulkStatus(ids: string[], next: AssetStatus) {
    if (ids.length === 0) return;
    setBulkBusy(true);
    setBulkTargetStatus(next);
    setNotice(`Applying "${statusLabel(next)}" to ${ids.length} item(s)…`);

    const originalById = new Map<string, Asset>();
    for (const id of ids) {
      const found = items.find((a) => a.id === id);
      if (found) originalById.set(id, found);
    }

    for (const original of originalById.values()) {
      setAssetLocally({ ...original, status: next });
    }

    const results = await bulkSetStatusChunked(ids, next);

    const failures: BulkFailure[] = [];
    for (const result of results) {
      if (result.ok) {
        if (result.asset) setAssetLocally(result.asset);
      } else {
        const original = originalById.get(result.id);
        if (original) setAssetLocally(original);
        failures.push({
          id: result.id,
          name: original?.name ?? result.id,
          code: result.code,
          message: result.message,
        });
      }
    }

    setBulkBusy(false);
    setBulkFailures(failures.length > 0 ? failures : null);
    setNotice(describeBulkOutcome(ids.length - failures.length, failures));
  }

  function applyBulkStatus(next: AssetStatus) {
    const ids = [...selectedIds];
    setSelectedIds(new Set());
    void runBulkStatus(ids, next);
  }

  function retryFailed() {
    if (!bulkFailures || !bulkTargetStatus) return;
    const retryableIds = bulkFailures.filter((f) => f.code !== 'legal_hold').map((f) => f.id);
    if (retryableIds.length === 0) return;
    void runBulkStatus(retryableIds, bulkTargetStatus);
  }

  const handleSaved = useCallback(
    (asset: Asset) => {
      setAssetLocally(asset);
    },
    [setAssetLocally],
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1>MediaVault</h1>
        <input
          className="search"
          type="search"
          placeholder="Search assets"
          aria-label="Search assets"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <select
          value={sort}
          aria-label="Sort by"
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>

      {!online && (
        <p className="notice notice--offline" role="status">
          You're offline. Showing what's already loaded — search and updates will resume
          automatically once you're back online.
        </p>
      )}

      <div className="filters">
        {STATUSES.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={status.includes(s)}
              onChange={(e) =>
                setStatus((prev) =>
                  e.target.checked ? [...prev, s] : prev.filter((x) => x !== s),
                )
              }
            />
            {statusLabel(s)}
          </label>
        ))}
        <span className="muted" role="status" aria-live="polite">
          {loadingInitial ? (
            <>
              <span className="spinner" aria-hidden="true" /> Loading…
            </>
          ) : (
            `${items.length} of ${total.toLocaleString()} shown`
          )}
        </span>
        {items.length > 0 && (
          <button onClick={selectAllLoaded}>Select all loaded ({items.length})</button>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="bulkbar">
          <span>{selectedIds.size} selected</span>
          {STATUSES.map((s) => (
            <button key={s} disabled={bulkBusy || !online} onClick={() => applyBulkStatus(s)}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <button onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      )}

      {notice && (
        <p className="notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {bulkFailures && (
        <div className="bulkbar bulkbar--failures" role="status" aria-live="polite">
          <span>
            {bulkFailures.length} failed:{' '}
            {bulkFailures
              .slice(0, 3)
              .map((f) => `${f.name} (${describeBulkFailureCode(f.code)})`)
              .join(', ')}
            {bulkFailures.length > 3 ? ` +${bulkFailures.length - 3} more` : ''}
          </span>
          {bulkFailures.some((f) => f.code !== 'legal_hold') && (
            <button onClick={retryFailed} disabled={bulkBusy || !online}>
              Retry failed
            </button>
          )}
          <button onClick={() => setBulkFailures(null)}>Dismiss</button>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <main className="content">
        <AssetGrid
          assets={items}
          total={total}
          selectedIds={selectedIds}
          activeId={activeId}
          onToggleSelect={toggleSelect}
          onOpen={openAsset}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={online ? fetchNextPage : () => {}}
          resetKey={queryKey}
        />
        {activeId && (
          <AssetDetail id={activeId} onClose={closeAsset} onSaved={handleSaved} />
        )}
      </main>
    </div>
  );
}
