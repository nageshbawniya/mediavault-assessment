import { memo, useState } from 'react';
import { thumbnailUrl } from '@/api/client';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import { STATUS_ICON } from '@/lib/statusMeta';
import type { Asset } from '@/lib/types';

interface Props {
  asset: Asset;
  index: number;
  selected: boolean;
  active: boolean;
  focused: boolean;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onOpen: (id: string) => void;
}

const KIND_GLYPH: Record<Asset['kind'], string> = {
  image: '🖼',
  video: '🎬',
  document: '📄',
};

function AssetCardImpl({ asset, index, selected, active, focused, onToggleSelect, onOpen }: Props) {
  // hasThumbnail tells us up front to skip the request entirely (API.md:
  // ~4% of assets 404 on /thumb). onError still catches the unexpected case.
  const [thumbFailed, setThumbFailed] = useState(false);
  const showPlaceholder = !asset.hasThumbnail || thumbFailed;

  return (
    <div
      className={
        'card' + (selected ? ' card--selected' : '') + (active ? ' card--active' : '')
      }
      onClick={() => onOpen(asset.id)}
      role="gridcell"
      data-index={index}
      data-id={asset.id}
      tabIndex={focused ? 0 : -1}
      aria-selected={selected}
      aria-label={`${asset.name}, ${asset.kind}, ${statusLabel(asset.status)}${selected ? ', selected' : ''}`}
    >
      {showPlaceholder ? (
        <div className="card__thumb card__thumb--placeholder" aria-hidden="true">
          {KIND_GLYPH[asset.kind]}
        </div>
      ) : (
        <img
          className="card__thumb"
          src={thumbnailUrl(asset.id)}
          alt=""
          loading="lazy"
          onError={() => setThumbFailed(true)}
        />
      )}
      <div className="card__body">
        <p className="card__name">{asset.name}</p>
        <p className="muted">
          {asset.kind} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.updatedAt)}
        </p>
        <span className={`pill pill--${asset.status}`}>
          <span className="pill__icon" aria-hidden="true">
            {STATUS_ICON[asset.status]}
          </span>
          {statusLabel(asset.status)}
        </span>
      </div>
      <input
        type="checkbox"
        className="card__check"
        checked={selected}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(asset.id, e.shiftKey);
        }}
        onChange={() => {
          /* selection itself is handled in onClick, which fires first and
             has access to shiftKey; onChange only exists to satisfy React's
             controlled-checkbox requirement */
        }}
        aria-hidden="true"
      />
    </div>
  );
}

// Custom comparator: only re-render when THIS card's own relevant props
// change, not when selectedIds/activeId change for some other card.
export const AssetCard = memo(AssetCardImpl, (prev, next) => {
  return (
    prev.asset === next.asset &&
    prev.index === next.index &&
    prev.selected === next.selected &&
    prev.active === next.active &&
    prev.focused === next.focused &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.onOpen === next.onOpen
  );
});
