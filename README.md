# Where Is My Tab

`Where Is My Tab` is a Manifest V3 Chrome extension that replaces the default new tab page with a focused tab finder. It is built for one job: find tabs that already exist in the current Chrome profile, group them by exact hostname, and switch back to them fast instead of opening duplicates. The current UI pass uses a premium glass-and-ivory visual system derived from the extension icon so the new tab page, packaged icons, and Chrome Web Store promo assets all share the same visual language.

## What This Version Does

- Replaces Chrome's new tab page with `Where Is My Tab`.
- Reads tabs across all Chrome windows in the current Chrome profile context.
- Groups open tabs by exact hostname.
- Keeps subdomains separate, so `example.com` and `docs.example.com` never collapse together.
- Uses an icon-led glassmorphism visual system with a centered hero search bar, a compact theme-swatch dock, and frosted card surfaces across all views.
- Uses a responsive packed-column card layout so uneven cards stack more tightly and waste less vertical space.
- Keeps a centered, search-engine-style global search box in the header and filters by title, URL, and domain text.
- Uses a main-content toggle with three views:
  - `Current open tabs`
  - `Trends`
  - `See it later tabs`
- In `Current open tabs`, supports two card perspectives:
  - `Domain`
  - `Window`
- Renders compact tab rows with:
  - title on line 1
  - full URL on line 2
  - last-switched time on line 3
  - a top-right badge for the current window or saved state
  - single-line truncation with full values available on hover
- Uses compact icon buttons for row and card actions, with accessible labels and native tooltips.
- Uses a locally generated, nine-icon Lucide subset for consistent 24px line geometry without a CDN or runtime package dependency.
- Shows a favicon slot on each domain card and falls back to a placeholder if the favicon is missing.
- Adds `Merge to window` on open-tab domain cards to pull that group's tabs into one new window.
- Adds `Close all` on open-tab cards so an entire domain or window card can be closed in one action.
- Adds `Gather solo tabs` at the profile level to merge one-tab windows into one window.
- Tracks last-switched timestamps in the background service worker and shows them when available.
- Adds a `Trends` leaderboard that ranks exact hostnames across four time windows:
  - `7d`
  - `14d`
  - `30d`
  - `Lifetime`
- Supports three trend metrics:
  - `Browsing time`
  - `Playback count`
  - `Open count`
- Adds a rolling 52-week archive in `Trends`, with one weekly top-10 card per week.
- Uses a hero layout for each weekly card:
  - rank #1 at the top with a larger favicon
  - ranks #2-#10 in a 3x3 grid below
  - ranks #2-#10 support hover for the full hostname and click through to that domain
- Includes a built-in `Trends` debug panel that shows current trackable tabs, runtime session state, stored host metrics, and the raw local payload.
- Persists theme preference, see-it-later state, and forward-looking trends data in `chrome.storage.local`.

## Product Decisions

- Scope stays extension-native and lightweight: no framework, no server, no build step.
- Search behavior is consistent filtering, not fuzzy reranking. Cards and rows disappear when they do not match the current query.
- Domain groups are sorted by exact hostname label so close actions do not trigger activity-based reshuffling.
- The default main view is `Current open tabs`.
- Inside `Current open tabs`, `Domain` remains the default card view and `Window` is an alternate persisted perspective.
- `Trends` is the middle main-content view. Its two switch groups are intentionally narrow:
  - one switcher for the time window
  - one switcher for the metric
- The selected trend metric also drives the weekly archive cards.
- The current leaderboard stays in place, and the weekly archive sits beneath it.
- `See it later tabs` is now a main-content view instead of a separate top section.
- In `See it later tabs`, tracked items are grouped by exact hostname so the same stable packed-column layout is used there too.
- `Trends` also stays exact-hostname-based, so `github.com` and `docs.github.com` rank separately there too.
- In `Trends`, the global search box filters hostnames only. Title and full-URL search still apply to the open-tab and see-it-later views.
- The weekly archive is a rolling local-week view:
  - one card per week
  - latest 52 weeks
  - Monday-start local weeks
  - with no search query, empty historical weeks still render so the yearly archive shape stays visible
  - with a search query, empty weekly cards are hidden so only matching weekly boards remain
- `See it later` stays intentionally narrow:
  - Marking an open tab stores a snapshot in `chrome.storage.local`.
  - While that tracked tab ID is still open, the tab stays linked to the live tab.
  - Once that tracked tab closes, it remains in `See it later tabs` as a saved item.
  - Clicking a saved closed item opens its URL in a fresh tab and relinks the saved record to that new tab.
  - In `Current open tabs`, the bookmark icon toggles membership in `See it later`.
- Middle truncation is handled in the renderer rather than with dynamic layout measurement. Full values are available through hover tooltips.
- Profile/account grouping stays current-profile-only because Chrome extensions do not get cross-profile tab visibility from one running profile instance.
- Trend metrics are forward-looking from this version onward:
  - `Open count` means completed hostname loads observed by the extension after install/update.
  - `Browsing time` means best-effort focused active-tab time, accumulated locally while a Chrome window stays focused.
  - `Playback count` means best-effort `audible` false-to-true transitions seen by the extension after install/update.
- The background service worker uses a lightweight alarm tick to flush active browse-time sessions without adding backend infrastructure.

## Project Layout

- `manifest.json`
  Manifest V3 entry point with the new-tab override and required permissions.
- `newtab.html`
  Static shell for the hero header, centered global search, theme switcher, and main content mount.
- `src/newtab.js`
  New-tab page controller. Reads Chrome tabs and storage, builds the snapshot, renders the three main views, handles icon actions, and runs tab/window commands.
- `src/background.js`
  Background service worker that records last-switched timestamps, keeps see-it-later links in sync when tabs close or are replaced, tracks forward-looking hostname trends, and resolves the best-effort current profile label.
- `src/lib/grouping.js`
  Pure snapshot, grouping, formatting, theme, favicon, see-it-later, and trends aggregation helpers shared by runtime code and tests.
- `src/styles.css`
  Search-bar styling, packed-column responsive card layout, trends leaderboard styling, compact card/row styling, icon actions, badges, and theme tokens.
- `tests/grouping.test.js`
  Node tests for exact-host grouping, cross-window grouping, favicon propagation, search behavior, see-it-later snapshot handling, trends ranking helpers, and time formatting.
- `scripts/validate-manifest.mjs`
  Repeatable smoke-check for manifest wiring, trends permissions, and required UI entry files.
- `scripts/generate_store_assets.py`
  Regenerates the packaged 16/48/128 icons from `assets/icons/icon.png` and rebuilds the small and large Chrome Web Store promo images from the same shared visual system.
- `scripts/generate-ui-icons.mjs`
  Generates `src/lib/icons.js` from the small Lucide subset used by the interface. Run `npm run assets:icons` after changing the icon map.

## Trends Data Model

Trend data is stored locally under one `chrome.storage.local` record:

- `domainTrends.hosts[hostname].lifetime`
  Running lifetime totals for `browseTimeMs`, `playbackCount`, and `openCount`.
- `domainTrends.hosts[hostname].daily[YYYY-MM-DD]`
  Daily buckets used to answer the `7d`, `14d`, and `30d` windows and to derive the rolling 52-week archive cards.
- `domainTrends.runtime`
  Lightweight background runtime state for the currently active browsing session and per-tab dedupe fields.

The new leaderboard is current-profile-only and exact-hostname-based.

## Metric Definitions

- `Open count`
  Counted when the extension observes a completed page load for a trackable hostname.
- `Browsing time`
  Best-effort milliseconds spent on the active tab while a Chrome window is focused. The service worker flushes this with an alarm tick and tab/window transitions.
- `Playback count`
  Counted when Chrome reports a tab's `audible` state changing from false to true.

## Time Windows

- `7d`, `14d`, and `30d`
  Calculated from the daily buckets kept in local storage.
- `Lifetime`
  Calculated from the lifetime totals and is not limited by the rolling daily window.

## Weekly Archive

- The weekly archive is derived from the same daily trend buckets rather than from a separate snapshot table.
- Each card represents one local Monday-to-Sunday week.
- Cards are shown newest first.
- The archive aims to cover the latest 52 weeks, so daily trend buckets are retained long enough to support roughly one year of weekly cards.
- Cards with no collected data still render when no search query is active, which keeps the yearly archive shape visible even early in adoption.

## Validation

Run the repeatable validation command:

```bash
npm run validate
```

For store-prep output in one shot:

```bash
npm run prepare:store
```

What `npm run validate` covers:

- exact-host grouping and subdomain separation logic
- cross-window grouping behavior
- stable hostname ordering for domain cards
- favicon propagation into domain groups
- search filtering behavior
- see-it-later snapshot shaping
- trends ranking helpers and time-window aggregation
- rolling weekly trends aggregation
- theme preference normalization
- manifest wiring for the new-tab page and background service worker
- required trends permissions and alarm wiring
- required project files and key static UI anchors

`npm run prepare:store` also:

- refreshes the local Lucide UI icon subset
- regenerates the packaged icon sizes from `assets/icons/icon.png`
- rebuilds the Chrome Web Store promo graphics
- produces the upload zip in `release/chrome-web-store/`

There is no build step for this repository.

## Load In Chrome

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select this repository root: `where-is-my-tab/`.
6. Open a fresh tab with `Cmd+T` or the `+` button.
7. Confirm the page title reads `Where Is My Tab`.
8. Confirm the new tab is the extension page rather than Chrome's default local new tab page.

## Manual Chrome Verification

Use this checklist in real Chrome after loading the unpacked extension.

### Setup Scenario

1. Open at least three Chrome windows.
2. Create this tab spread:
   - Window 1:
     - `https://github.com/openai`
     - `https://github.com/openai/openai-openapi`
   - Window 2:
     - `https://docs.github.com/en`
   - Window 3:
     - `https://mail.google.com/mail/u/0/#inbox`
3. Open one more new tab so the extension page is visible.

### Core Workflow

1. Confirm `Where Is My Tab` replaces the default new tab page.
2. Confirm the search box is visually centered in the header, focused by default, and does not show redundant helper copy underneath it.
3. Confirm `Current open tabs` is the default active view.
4. Confirm `Trends` appears between `Current open tabs` and `See it later tabs`.
5. In `Current open tabs`, switch the card view between `Domain` and `Window`.
6. Confirm `Domain` groups by exact hostname and `Window` groups by Chrome window label.
7. Confirm the page shows separate cards for:
   - `github.com`
   - `docs.github.com`
   - `mail.google.com`
8. Confirm the `github.com` card contains both GitHub tabs when they share the same hostname.
9. Confirm subdomains stay separate, so `docs.github.com` is not merged into `github.com`.
10. Search for `openai-openapi` and confirm only the matching GitHub row remains visible.
11. Click that row and confirm Chrome focuses the existing tab instead of opening a duplicate.
12. Open the extension page again and confirm that row now shows a `Last switched ...` label.

### UI Polish

1. Resize the browser wider and confirm more domain cards fit across the page.
2. Confirm the hero shows the refreshed brand mark and the compact theme-swatch dock in the top-right.
3. Confirm the search field feels like a single integrated search bar, with the clear control living inside the field rather than beside it.
4. Confirm uneven cards stack tightly with reduced vertical whitespace between them.
5. Confirm closing a tab does not cause unrelated domain cards to jump into a surprising new order.
6. Confirm cards remain in predictable hostname order after refreshes and close actions, even though the packed column layout no longer guarantees a strict row-by-row reading order.
7. Confirm each domain card shows a favicon slot at the top-left.
8. Confirm cards with a working site favicon render it, and cards without one still keep a stable placeholder.
9. Confirm the domain-card meta row stays on one line on practical desktop widths.
10. Confirm row and card actions are primarily compact icon buttons and stay on one line on normal desktop widths.
11. Confirm each open-tab card now includes a `Close all` action and that it closes every tab represented by that card.
12. Hover long titles and URLs and confirm the full value is still available in the native tooltip.
13. Confirm each visible tab row shows:
   - title on one line
   - URL on one line
   - last-switched time on one line
   - no content wrapping within those lines
   - a top-right window badge that does not push into the main content

### See It Later

1. In `Current open tabs`, click the bookmark icon on one or two open tabs.
2. Confirm the icon switches into its selected state.
3. Switch the main content to `See it later tabs`.
4. Confirm the tracked items appear there, grouped by exact hostname.
5. Close one of those tracked live tabs.
6. Confirm it still appears in `See it later tabs` as a saved item.
7. Click the saved row or its open icon and confirm Chrome opens its URL in a fresh tab.
8. Confirm the reopened item becomes live again.
9. Click the remove icon and confirm the item leaves `See it later tabs`.
10. Switch back to `Current open tabs` and confirm the bookmark icon reflects the current tracked state.

### Trends

1. Use Chrome normally with this unpacked extension loaded so the service worker can collect a little activity.
2. Open `Where Is My Tab` and switch to `Trends`.
3. Confirm the `Time window` switcher works for:
   - `7d`
   - `14d`
   - `30d`
   - `Lifetime`
4. Confirm the `Metric` switcher works for:
   - `Browsing time`
   - `Playback count`
   - `Open count`
5. Confirm each selected combination shows up to 10 exact hostnames.
6. Confirm `github.com` and `docs.github.com` stay separate in the leaderboard if both have tracked activity.
7. Trigger a few fresh page loads on one hostname and confirm `Open count` changes.
8. Play audio/video in a tab that Chrome marks as audible and confirm `Playback count` changes after a fresh audible start.
9. Keep one tab focused for a while, switch away, and confirm `Browsing time` increases.
10. Type a hostname fragment into the global search box while staying in `Trends` and confirm the leaderboard filters by hostname.
11. Confirm the weekly archive renders one card per week, newest first.
12. Confirm each populated weekly card shows:
    - a larger #1 favicon at the top
    - a 3x3 grid for ranks #2-#10 underneath
13. Hover any `#2-#10` weekly cell and confirm the full hostname appears in the tooltip.
14. Click any `#2-#10` weekly cell and confirm Chrome opens that hostname in a fresh tab.
15. Confirm changing the selected metric changes both the main leaderboard and the weekly archive cards.
16. Open the `Debug panel` in `Trends` and use it to confirm:
    - `Trackable tabs now` reflects currently open `http/https` tabs
    - `Runtime tab states` is non-zero after normal browsing
    - `Active session` shows the focused webpage hostname when applicable
    - `Stored hosts overview` and `Raw payload` explain whether metrics have actually been persisted yet

### Window Actions

1. In `Current open tabs`, click the `Merge to window` icon on a multi-tab domain card.
2. Confirm Chrome creates a new window containing all tabs from that domain group.
3. Create at least two separate Chrome windows that each contain exactly one non-extension tab.
4. Click `Gather solo tabs`.
5. Confirm Chrome creates one new window containing those scattered tabs together.

### Theme

1. Use the theme switcher in the top-right of the header.
2. Confirm the page palette changes immediately.
3. Open another new tab and confirm the selected theme persists.

## Known Limitations

- Chrome extensions only see tabs from the current Chrome profile instance. Tabs in other Chrome profiles or signed-in profile containers are not enumerable from this runtime, so this version stays current-profile-only.
- The interface uses the generic `Current Chrome profile` label and does not request Chrome identity or profile-email access.
- Last-switched metadata is best-effort and stored in `chrome.storage.local` by current tab ID. It survives ordinary extension reloads but is not intended to be a permanent cross-session browsing history.
- `See it later` persists lightweight tab snapshots in `chrome.storage.local`, not full page state.
- `Trends` starts collecting from this version onward. The extension does not reconstruct old browsing duration or old playback history that happened before install/update.
- The 52-week archive can only be as complete as the locally retained daily trend buckets. Older weeks before this version or before enough data retention has accumulated will stay empty.
- `Open count` is the strongest trend metric because it is based on observed completed hostname loads. `Browsing time` and `Playback count` are both best-effort approximations of real usage signals.
- `Browsing time` only accrues while Chrome has a focused window and the extension can maintain the active session. To avoid runaway overcounting after sleep/restart gaps, stale increments are capped.
- `Playback count` depends on Chrome exposing a tab's `audible` transitions. If a site plays media without surfacing that state, the counter may under-report.
- Favicon rendering depends on what Chrome exposes for the current tab snapshot. When no favicon URL is available, the UI falls back to a placeholder rather than trying a heavier fetch path.
- The card layout now uses stable source-order column packing to reduce vertical whitespace. It preserves predictable hostname-based ordering, but on uneven card heights the visual scan order is no longer a strict left-to-right, row-by-row grid.
- The repeatable automated validation path does not install the extension into a live Chrome session. Real extension loading and new-tab override verification should be done with the manual `Load unpacked` steps above.
