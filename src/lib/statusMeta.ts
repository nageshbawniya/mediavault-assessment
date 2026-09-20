import type { AssetStatus } from '@/lib/types';

/**
 * Visual order: draft -> in_review -> approved reads left-to-right as a
 * progression. archived is a terminal side-state (reachable from any of
 * the other three, not "further along" than approved) — its icon is
 * deliberately a different shape family, not just further along a scale.
 */
export const STATUS_ORDER: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

/**
 * One glyph per status so the status is never conveyed by color alone —
 * a colorblind user, or anyone on a grayscale/high-contrast display, still
 * gets a distinct shape: empty -> half -> filled -> boxed away.
 */
export const STATUS_ICON: Record<AssetStatus, string> = {
  draft: '○',
  in_review: '◐',
  approved: '●',
  archived: '▪',
};