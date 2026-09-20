import { useEffect, useRef, useState } from 'react';
import { getAsset, thumbnailUrl, updateAsset } from '@/api/client';
import { ApiError } from '@/lib/apiError';
import { describeError } from '@/lib/errorMessage';
import { formatBytes, formatDate, formatDuration, statusLabel } from '@/lib/format';
import { STATUS_ICON } from '@/lib/statusMeta';
import type { Asset, AssetStatus } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

interface Props {
  id: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}

export function AssetDetail({ id, onClose, onSaved }: Props) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Runs on every `id` change, not just mount — the panel component stays
  // mounted while the user clicks from one asset straight to another, so a
  // mount-only effect would miss those.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [id]);

  useEffect(() => {
    setAsset(null);
    setError(null);
    getAsset(id)
      .then(setAsset)
      .catch((err: unknown) => setError(describeError(err)));
  }, [id]);

  async function setStatus(status: AssetStatus) {
    if (!asset) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAsset(asset.id, asset.version, { status });
      setAsset(updated);
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone else saved this asset since we loaded it — our `version`
        // is stale, and retrying with it would just 409 again. Refetch to
        // the real current state rather than guessing; the user can decide
        // whether to re-apply their change on top of it.
        setError(
          'Someone else updated this asset in the meantime. Showing the latest version — please try again.',
        );
        try {
          const latest = await getAsset(asset.id);
          setAsset(latest);
          onSaved(latest);
        } catch {
          /* refetch failed too — the conflict message above still stands */
        }
      } else {
        setError(describeError(err));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside
      className="panel"
      aria-label="Asset detail"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="panel__head">
        <h2>Asset detail</h2>
        <button ref={closeButtonRef} onClick={onClose}>
          Close
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {!asset && !error && (
        <p className="muted">
          <span className="spinner" aria-hidden="true" /> Loading…
        </p>
      )}

      {asset && (
        <div className="panel__body">
          <img className="panel__thumb" src={thumbnailUrl(asset.id)} alt="" />
          <h3>{asset.name}</h3>
          <dl className="facts">
            <dt>Id</dt>
            <dd>{asset.id}</dd>
            <dt>Kind</dt>
            <dd>{asset.kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
            {asset.width && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec && (
              <>
                <dt>Duration</dt>
                <dd>{formatDuration(asset.durationSec)}</dd>
              </>
            )}
            <dt>Owner</dt>
            <dd>{asset.owner.name}</dd>
            <dt>Updated</dt>
            <dd>{formatDate(asset.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{asset.version}</dd>
          </dl>

          {asset.tags.length > 0 && (
            <ul className="tags">
              {asset.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}

          <p className="muted">Status</p>
          <div className="row">
            {STATUSES.map((status) => (
              <button
                key={status}
                disabled={saving || status === asset.status}
                aria-current={status === asset.status ? 'true' : undefined}
                onClick={() => setStatus(status)}
              >
                <span aria-hidden="true">{STATUS_ICON[status]}</span> {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
