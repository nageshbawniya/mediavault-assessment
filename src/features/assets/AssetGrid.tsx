import { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AssetCard } from '@/features/assets/AssetCard';
import type { Asset } from '@/lib/types';

interface Props {
  assets: Asset[];
  total: number;
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onOpen: (id: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  resetKey: string; // scroll back to top + reset keyboard focus on filter change
}

const CARD_MIN_WIDTH = 220;
const GAP = 12;
const CARD_BODY_HEIGHT = 92;

export function AssetGrid({
  assets,
  total,
  selectedIds,
  activeId,
  onToggleSelect,
  onOpen,
  hasMore,
  loadingMore,
  onLoadMore,
  resetKey,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState(0);
  // Roving tabindex: exactly one card is a tab stop at a time. Arrow keys
  // move this index; Tab moves focus into/out of the grid as a whole.
  const [focusedIndex, setFocusedIndex] = useState(0);

  // A callback ref, not a plain ref + mount-only effect. The grid div only
  // exists when assets.length > 0 (the empty state renders a different
  // tree entirely) — on first load assets start empty, so a `useEffect(…,
  // [])` would run once against a null ref and then never run again once
  // data arrives and the real div mounts. A callback ref re-fires exactly
  // when the DOM node itself attaches or detaches, so it stays correct
  // across that empty-to-populated transition.
  const setScrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (node) {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) setWidth(entry.contentRect.width);
      });
      observer.observe(node);
      resizeObserverRef.current = observer;
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setFocusedIndex(0);
  }, [resetKey]);

  // Keep the focus target valid if the list shrinks (e.g. fewer results).
  useEffect(() => {
    if (focusedIndex > assets.length - 1) {
      setFocusedIndex(Math.max(0, assets.length - 1));
    }
  }, [assets.length, focusedIndex]);

  const columns = width > 0 ? Math.max(1, Math.floor((width + GAP) / (CARD_MIN_WIDTH + GAP))) : 1;
  const cardWidth = columns > 0 ? (width - (columns - 1) * GAP) / columns : CARD_MIN_WIDTH;
  const rowHeight = cardWidth > 0 ? cardWidth * (10 / 16) + CARD_BODY_HEIGHT + GAP : 260;
  const rowCount = Math.ceil(assets.length / columns);
  const loaderRowIndex = rowCount;

  const rowVirtualizer = useVirtualizer({
    count: hasMore ? rowCount + 1 : rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
  });

  // Column count changes whenever available width changes — most visibly
  // when the detail panel opens/closes (it eats width from the grid) or
  // the window resizes. Each row holds a different number of items under
  // a different column count, so the SAME scrollTop pixel value ends up
  // pointing at a completely different row of assets after a column
  // change — the raw scroll position survives, but what it shows doesn't.
  // Converting through an item index instead of a pixel offset keeps the
  // same assets on screen across the change.
  const prevColumnsRef = useRef(columns);
  const prevRowHeightRef = useRef(rowHeight);
  useEffect(() => {
    const prevColumns = prevColumnsRef.current;
    const prevRowHeight = prevRowHeightRef.current;
    if (prevColumns !== columns && scrollRef.current) {
      const prevScrollTop = scrollRef.current.scrollTop;
      const prevRowIndex = prevRowHeight > 0 ? Math.round(prevScrollTop / prevRowHeight) : 0;
      const firstVisibleItemIndex = prevRowIndex * prevColumns;
      const newRowIndex = Math.floor(firstVisibleItemIndex / columns);
      rowVirtualizer.scrollToIndex(newRowIndex, { align: 'start' });
    }
    prevColumnsRef.current = columns;
    prevRowHeightRef.current = rowHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);

  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (!last) return;
    if (hasMore && last.index === loaderRowIndex && !loadingMore) {
      onLoadMore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualRows.map((r) => r.index).join(','), hasMore, loaderRowIndex, loadingMore]);

  // Once scrollToIndex brings the target row into the rendered window, the
  // card with this data-index actually exists in the DOM — focus it then.
  // Runs on every virtualizer update because that's the only reliable
  // signal that "the row we scrolled to just became available."
  useEffect(() => {
    const el = scrollRef.current?.querySelector(`[data-index="${focusedIndex}"]`);
    if (el instanceof HTMLElement && document.activeElement !== el) {
      // Only steal focus if focus is already inside this grid — otherwise
      // an unrelated re-render (e.g. a bulk update) would yank focus away
      // from wherever the user actually is.
      if (scrollRef.current?.contains(document.activeElement)) {
        el.focus();
      }
    }
  }, [focusedIndex, virtualRows]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const cardEl = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null;
    if (!cardEl) return;
    const currentIndex = Number(cardEl.dataset.index);
    const id = cardEl.dataset.id;
    if (id === undefined) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(id);
      return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      onToggleSelect(id, e.shiftKey);
      return;
    }

    let target: number | null = null;
    if (e.key === 'ArrowRight') target = currentIndex + 1;
    else if (e.key === 'ArrowLeft') target = currentIndex - 1;
    else if (e.key === 'ArrowDown') target = currentIndex + columns;
    else if (e.key === 'ArrowUp') target = currentIndex - columns;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = assets.length - 1;
    if (target === null) return;

    target = Math.max(0, Math.min(assets.length - 1, target));
    e.preventDefault();
    setFocusedIndex(target);
    rowVirtualizer.scrollToIndex(Math.floor(target / columns), { align: 'auto' });
  }

  if (assets.length === 0) {
    return (
      <div className="empty">
        <p className="empty__icon" aria-hidden="true">
          🔍
        </p>
        <p>Nothing matches these filters.</p>
        <p className="muted">Clear the search box or widen the status filter.</p>
      </div>
    );
  }

  return (
    <div
      className="grid-scroll"
      ref={setScrollRef}
      role="grid"
      aria-label="Assets"
      aria-rowcount={rowCount}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}
      >
        {virtualRows.map((virtualRow) => {
          if (virtualRow.index === loaderRowIndex) {
            return (
              <div
                key="loader"
                className="grid-loader"
                style={{
                  position: 'absolute',
                  top: virtualRow.start,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size,
                }}
                aria-live="polite"
              >
                {loadingMore && (
                  <>
                    <span className="spinner" aria-hidden="true" /> Loading more…
                  </>
                )}
              </div>
            );
          }

          const startIdx = virtualRow.index * columns;
          const rowAssets = assets.slice(startIdx, startIdx + columns);

          return (
            <div
              key={virtualRow.key}
              className="grid-row"
              role="row"
              aria-rowindex={virtualRow.index + 1}
              style={{
                position: 'absolute',
                top: virtualRow.start,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: GAP,
              }}
            >
              {rowAssets.map((asset, colOffset) => {
                const index = startIdx + colOffset;
                return (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    index={index}
                    selected={selectedIds.has(asset.id)}
                    active={activeId === asset.id}
                    focused={index === focusedIndex}
                    onToggleSelect={onToggleSelect}
                    onOpen={onOpen}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="muted grid-count">
        {assets.length.toLocaleString()} of {total.toLocaleString()} loaded
      </p>
    </div>
  );
}
