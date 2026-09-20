# Submission

## Links

- **Repo:** https://github.com/nageshbawniya/mediavault-assessment
- **Deployed app:** https://mediavault-assessment-xi.vercel.app
- **Deployed API:** https://mediavault-assessment-jprl.onrender.com _(Render free tier — spins down after inactivity; first request after idle can take 30–60s to wake up)_

## Video walkthrough

**Link:** _[paste your Loom link here]_

## How to run it

`npm install && npm run dev` — no extra setup, except one added dependency:

```
npm install @tanstack/react-virtual
```

used for row-based grid virtualization in Task 2. Everything else runs against the
existing mock API unchanged (`CHAOS=1`, `LATENCY=1` by default, as shipped).

Verified against a fresh clone of the repo: `npm install`, `npm run build`
(production), and `node server/index.mjs` all run clean with no errors.

## Time spent

Roughly 14 hours, split as:
- Task 0 (defect inventory): ~1 hr
- Task 1 (search/race conditions): ~2.5 hrs
- Task 2 (virtualization/scale): ~2.5 hrs
- Task 3 (bulk actions): ~2 hrs
- Task 4 (resilience): ~1.5 hrs
- Task 5 (accessibility): ~1.5 hrs
- Task 6 (visual design): ~1 hr
- Bug fixes found during manual testing (StrictMode/dedup race, column-change scroll bug): ~1 hr
- SUBMISSION.md + review: ~0.5 hr

---

## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Stale response race — a slow response for an old query could overwrite a newer one's result | `useAssets.ts` | Fixed — request-id guard + AbortController |
| 2 | No debounce on search input — every keystroke fired a request | `App.tsx` | Fixed — 400ms debounce, filters stay instant |
| 3 | No request cancellation | `client.ts` | Fixed — AbortController wired through |
| 4 | No de-duplication of identical concurrent requests | `client.ts` | Fixed — in-flight request cache (see note below) |
| 5 | No URL sync for `q`, `status`, `sort` — filters lost on reload/share | `App.tsx` | **Left — out of scope.** Prioritized async correctness (races, retries, bulk) and a11y over this; would add via a thin `useSearchParams`-style hook if given more time. |
| 6 | No pagination — `nextCursor` was fetched and ignored | `useAssets.ts` | Fixed — `useInfiniteAssets` with cursor-based infinite scroll |
| 7 | No virtualization — all rows mounted into the DOM at once | `AssetGrid.tsx` | Fixed — row-based virtualization via `@tanstack/react-virtual` |
| 8 | Missing thumbnails (404s) had no fallback | `AssetGrid.tsx` | Fixed — `hasThumbnail` flag checked up front + `onError` fallback |
| 9 | Toggling one card's selection re-rendered the whole grid | `AssetGrid.tsx` | Fixed — `React.memo` with custom comparator + stable callbacks |
| 10 | Bulk update sent every selected id in one call (API rejects >50) | `App.tsx` | Fixed — automatic chunking (50/call) with bounded concurrency (3) |
| 11 | Bulk failure notice only showed counts, not which assets or why | `App.tsx` | Fixed — per-item failure list with reason, grouped by retryable/not |
| 12 | No optimistic update on bulk status | `App.tsx` | Fixed — immediate local update, per-item rollback on failure |
| 13 | `409 version_conflict` fell into the same generic error as everything else | `AssetDetail.tsx` | Fixed — structured `ApiError`, auto-refetch to latest on conflict |
| 14 | Detail-panel save didn't update the grid — stale row until refetch | `App.tsx` `handleSaved` | Fixed — `setAssetLocally` patches the list in place |
| 15 | No retry/backoff for transient failures (`503`, `429`) | `client.ts` | Fixed — exponential backoff + jitter, capped retries |
| 16 | Errors flattened into a string — no way to distinguish retryable from not | `client.ts` | Fixed — `ApiError` class carries `status`/`code`/`retryAfterSeconds` |
| 17 | `Retry-After` header never read | `client.ts` | Fixed — honored over computed backoff when present |
| 18 | Raw server error strings reached the user unrewritten | `App.tsx`, `AssetDetail.tsx` | Fixed — `describeError`/`describeBulkFailureCode` copy layer |
| 19 | No error boundary — a component throw blanked the whole app | `main.tsx` | Fixed — `ErrorBoundary` class component |
| 20 | No offline detection | Whole app | Fixed — `useOnlineStatus`, banner, blocked load-more, auto-resume on reconnect |
| 21 | Grid not keyboard-operable — no `tabIndex`, no key handling | `AssetGrid.tsx` | Fixed — roving tabindex, Arrow/Enter/Space/Home/End |
| 22 | No focus management in the detail panel | `AssetDetail.tsx` | Fixed — focus moves in on open, returns to trigger on close, Escape closes |
| 23 | No live region for result counts, bulk outcomes, errors | `App.tsx` | Fixed — `role="status"`/`"alert"` on existing visible text |
| 24 | Selection checkbox had no independent accessible name | `AssetCard.tsx` | Fixed differently — checkbox is `aria-hidden` (mouse-only); the card's own `aria-label` carries name/status/selected state, avoiding duplicate announcements |
| 25 | Status pills distinguished only by color/text | `styles.css` | Fixed — distinct icon per status (`○ ◐ ● ▪`), contrast-checked |
| 26 | Selection wasn't cleared when filters/search changed | `App.tsx` | Fixed — resets on query change |

**Two additional defects found during manual testing** (not in the original baseline, introduced/exposed by my own Task 1–2 changes — see "Anything you'd like us to look at"):
- Request de-dup cache let one caller's `AbortController` cancel a shared in-flight request for *other* callers (surfaced by React StrictMode's double-invoked effects) — fixed by decoupling the shared fetch from any single caller's signal.
- Scroll position was preserved by raw pixel `scrollTop`, which pointed at different assets once the detail panel's open/close changed the column count — fixed by converting through item index instead of pixel offset.

---

## Key decisions

**Data fetching and caching**
Built a thin client (`client.ts`) around `fetch` rather than pulling in React Query — the app has exactly one list endpoint with unusual invalidation rules (cursor bound to query, `stale_cursor` on reuse) that didn't map cleanly onto a general-purpose cache. Added an in-flight request de-dup map keyed by full query string, but deliberately did **not** tie the shared fetch to any single caller's `AbortSignal` — early on this caused one caller's cancellation to kill the response for a sibling caller sharing the same promise (see React StrictMode note above). Rejected: a full library (React Query/SWR) — would have solved caching for free but fought the API's cursor semantics more than it helped.

**Stale response handling**
Two independent layers: `AbortController` cancels the in-flight network request when the query changes (saves bandwidth/rate-limit budget), and a monotonically increasing `requestId` ref is the actual correctness guarantee — a response is only applied if it's still the latest request, regardless of whether the abort landed in time. Rejected: relying on `AbortController` alone — abort is best-effort, not a guarantee, since a response can already be in flight to the browser when `.abort()` is called.

**Virtualization approach**
Row-based virtualization via `@tanstack/react-virtual`, with container width measured by `ResizeObserver` to compute how many columns fit, then virtualizing rows (each holding N cards). Rejected: cell-level virtualization — more precise but unnecessary complexity for a responsive grid where the column count is the only real unknown. Rejected: `content-visibility: auto` — simpler, but gives no control over an explicit sentinel row for triggering `fetchNextPage`.

**Optimistic updates and rollback**
Bulk status changes apply immediately to local state, then reconcile per item once the server responds: successes get replaced with the server's real object (correct `version`), failures roll back to their original snapshot individually. Rejected: rolling back the whole batch on any failure — with a large selection and a handful of `legal_hold` items, that would discard hundreds of successful updates over a few expected failures.

**Retry and backoff policy**
Exponential backoff with jitter (up to 30%), capped at 5s, deferring to the server's `Retry-After` header when present. Retryable set is `429`/`503`/`5xx` only, matching API.md's documented "safe to retry" cases; `400`/`409`/`422` never retry since they're correctness errors, not transient ones. Also skip retrying entirely when `navigator.onLine` is `false`, so an offline user doesn't sit through a multi-second backoff sequence that was never going to succeed.

**State placement and URL sync**
All state (filters, selection, pagination) lives in local component state/hooks — no global store, since nothing here is shared across routes or components outside this one screen. URL sync was scoped out (see defect #5) in favor of the async-correctness and accessibility work the brief weighted higher.

---

## Performance

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes, any scroll depth (virtualization is scale-independent) | N (equals items loaded — no virtualization in baseline) | **22** (verified via DevTools `.card` search, 48 items loaded) | DevTools Elements panel, `Ctrl+F` search for `.card` |
| Cards re-rendered when toggling one selection | all loaded cards | 1 *(by design — `React.memo` + custom comparator; not directly profiled with React DevTools since the extension wasn't installed during testing)* | React DevTools Profiler, record a selection toggle |
| Longest task during sustained scroll | _[not measured — needs a live Performance-panel recording]_ | _[not measured — needs a live Performance-panel recording]_ | Performance panel, record while scrolling, read the longest task bar under "Main" |
| Requests fired while typing a 6-character query | 6 (one per keystroke — baseline had no debounce) | **1** (verified — fast typing collapses into a single debounced request; confirmed via Network tab during testing) | Network tab, typed "night" at normal speed, counted `/api/assets` calls |
| Production bundle, gzipped | N/A (baseline never built/measured independently — missing `lib/format.ts`/`lib/types.ts` from the original snapshot prevent an isolated baseline build) | **62.05 kB** (60.45 kB JS + 1.60 kB CSS) | `npm run build`, fresh clone, gzip sizes from Vite's build output |

_[One row above ("Longest task during sustained scroll") still needs your own live DevTools Performance-panel recording — see "How to measure" note in that row. Everything else has been verified against a fresh clone of the actual repo.]_

What was the actual bottleneck, and how did you find it?
The unmitigated bottleneck was DOM size at scale: rendering 12,400 asset cards
directly (as the baseline did) produces that many `.card` elements plus their
children, which is what made scrolling janky and selection toggles expensive —
confirmed by inspecting the Elements panel before virtualization and watching
node count drop after.

---

## Accessibility

**Keyboard model:** Roving tabindex over the asset grid — exactly one card is a
tab stop at a time; Tab moves focus into/out of the grid as a whole, and Arrow
keys move between cards (Home/End jump to the first/last loaded item). Enter
opens the detail panel; Space toggles selection (Shift+Space extends a range).
The detail panel moves focus to its Close button on open, returns focus to the
triggering card on close, and closes on Escape.

**How tested:** Manually, keyboard-only, click-free — verified Tab reaches the
first card, Arrow keys move focus (including scrolling an out-of-view target
into range first, since the grid is virtualized), Space selects, Enter opens
with focus landing on Close, and Escape closes with focus landing back on the
originating card. Also manually forced an error boundary crash and confirmed a
recoverable screen instead of a blank page.

**Known gaps:**
- Did not test with an actual screen reader (NVDA/VoiceOver) — live regions
  (`role="status"`/`"alert"`) and `aria-label`s were implemented per WAI-ARIA
  guidance but not verified by ear.
- No full ARIA grid pattern (`aria-colcount`/per-cell `aria-colindex`) — basic
  `role="grid"`/`"row"`/`"gridcell"` plus roving tabindex covers functional
  keyboard nav, but a purist AT experience would want more.
- No dedicated mobile/touch accessibility pass (larger touch targets, etc).

---

## Interface decisions

Optimized for clarity over decoration: every visual choice exists to make
state legible at a glance (what's loading, what failed, what's selected, what
status something is) rather than to look distinctive. Given the assessment's
weighting toward correctness and unhappy-path handling, visual polish was
scoped to what directly serves those states.

- **Visual system.** A small spacing scale (`--space-1` through `--space-6`)
  lives in `styles.css` and is applied to page-chrome padding; a full
  refactor of every hardcoded value in the original CSS was cut for time.
  Colors are the original neutral/accent palette from the baseline CSS.
- **Status treatment.** The four statuses read as a progression via both
  color and a distinct icon shape (`○ → ◐ → ●`), with `archived` as a
  visually separate terminal state (`▪`, muted gray) rather than "further
  along" the scale, since an asset can be archived from any status.
- **States.** Loading uses a small spinner (initial load, load-more, detail
  panel), respecting `prefers-reduced-motion`. Empty state gets a
  low-opacity icon instead of bare text. Error and offline banners are
  color-coded and carry rewritten, non-technical copy. Bulk partial failure
  shows a breakdown by cause with a conditional retry action.
- **Contrast.** Checked with the WCAG relative-luminance formula (the same
  math WebAIM's contrast checker uses) against every text/background pair in
  the status pills and banners. All measured ≥5.2:1, clearing the 4.5:1 AA
  minimum for normal text with real margin (documented inline in
  `styles.css`).
- **Copy.** Rewrote every user-facing error from raw API text (`"409:
  version_conflict"`) into plain language (`"Someone else updated this just
  now. Showing the latest version."`), and gave `legal_hold`/`conflict` bulk
  failures their own short descriptions instead of a generic "failed."

---

## Trade-offs and cuts

- **URL state sync** (defect #5) — scoped out in favor of async-correctness
  and accessibility work.
- **Range selection (Shift+click)** only spans currently *loaded* items —
  extending it across not-yet-fetched pages would mean selecting by position
  into data that doesn't exist yet client-side; out of scope by design.
- **Full ARIA grid semantics** (`aria-colcount`, per-cell `aria-colindex`) —
  cut for time; the roving-tabindex + basic grid/row/gridcell roles cover
  functional keyboard use.
- **Design-token refactor** — the spacing scale exists and is used, but only
  applied to page chrome, not every component's hardcoded padding.
- With another day: screen-reader verification pass, URL sync, and a proper
  design-token refactor across all components.

## Critique of the API

- **Bulk endpoint takes no `version`** — unlike the single-asset `PATCH`,
  `bulk-status` has no optimistic-concurrency check, so a bulk update can
  silently overwrite a change someone else made moments earlier. Forced a
  choice on the client to just accept this (nothing to check against) rather
  than something I'd prefer.
- **Cursor invalidation is opaque** — `stale_cursor` only surfaces as a
  generic `400` after the fact; a cursor that also encoded its originating
  query (or an endpoint to validate one) would let the client avoid the
  wasted round-trip entirely instead of finding out via a failed request.
- **No per-endpoint indication of which errors are retryable** — I inferred
  the retryable set (`429`/`503`/`5xx`) from the prose in API.md rather than
  from anything machine-readable in the error payload itself; a `retryable:
  true/false` field on the error object would remove that guesswork.

## Anything you would like us to look at

Two bugs surfaced only through manual testing, not code review, and I think
they're worth a look specifically because of *how* they surfaced:

1. The request de-dup cache (built for Task 1/2) was tying a shared in-flight
   promise to whichever caller's `AbortSignal` happened to be passed in first.
   React StrictMode's double-invoked effects in dev created exactly two
   simultaneous callers for the same query, and the first one's cleanup
   `abort()` cancelled the *shared* request — killing the second (real)
   caller's data along with it, with no console error, just an infinite
   loading state. Fixed by decoupling the shared fetch from any single
   caller's signal entirely.
2. Scroll position was preserved as a raw pixel `scrollTop`, which is only
   correct if the number of columns per row stays constant. Opening the
   detail panel narrows the grid enough to drop from 3 columns to 1, so the
   same `scrollTop` after closing the panel pointed at a completely
   different set of assets. Fixed by converting through the visible item's
   index rather than the pixel offset when column count changes.

Both are the kind of bug that a code read genuinely would not catch — they
only show up under a specific runtime interaction (dev-mode double-invoke;
a width-dependent layout property changing) — which is the case for actually
running the thing end-to-end rather than trusting a correct-looking diff.