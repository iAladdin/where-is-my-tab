# Chrome Web Store Listing Draft

## Name

Where Is My Tab

## Category

Productivity

## Summary

Find existing tabs across Chrome windows, switch back fast, and review weekly domain trends from a polished new tab page.

## Description

Where Is My Tab replaces Chrome's new tab page with a focused tab finder built for one job: helping you find tabs that already exist before you open duplicates.

The current release also ships a refreshed glass-and-ivory visual system so the extension UI, icon set, and Chrome Web Store promo graphics all share one coherent look.

What it does:

- Scans tabs across all Chrome windows in the current Chrome profile
- Groups tabs by exact hostname so subdomains stay separate
- Lets you search across tab titles, URLs, and domains
- Switches directly to the existing tab you want
- Supports quick close, save-for-later, and merge-to-window actions
- Tracks lightweight tab activity so you can review weekly hostname trends over time

Trends include:

- Top domains for the last 7, 14, and 30 days, plus lifetime
- Weekly top-10 archive cards for the last 52 weeks
- Browsing time, playback count, and open count metrics

The extension is intentionally narrow:

- no cloud sync
- no backend
- no account dashboard
- local-first storage using Chrome extension APIs

## Single Purpose

This extension helps users find, reopen, organize, and review their existing Chrome tabs from a custom new tab page.

## Assets Prepared In This Repo

- Upload package:
  `release/chrome-web-store/where-is-my-tab-0.1.0-chrome-web-store.zip`
- Extension icons:
  `assets/icons/icon16.png`
  `assets/icons/icon48.png`
  `assets/icons/icon128.png`
- Master icon art used for icon exports:
  `assets/icons/icon.png`
- Small promo image:
  `assets/chrome-web-store/promo-440x280.png`
- Large promo image:
  `assets/chrome-web-store/promo-1400x560.png`
- Trends screenshot:
  `assets/chrome-web-store/screenshots/trends-1280x800.png`
- Screenshot shot list and capture notes:
  `release/chrome-web-store/SCREENSHOT_SHOTLIST.md`
- Regenerate store visuals:
  `npm run assets:store`
- Run the full store-prep pipeline:
  `npm run prepare:store`

## Assets Still Needed Before Submission

- Optional additional screenshots for current-tabs search and see-it-later flows

## Suggested Screenshot List

- Main new tab page with grouped tab cards and search
- Trends view with the top leaderboard and weekly archive cards
- See it later view with grouped saved tabs

## Notes

- Keep screenshots truthful. Use the real extension running in Chrome.
- If you change the extension name, update the package zip, listing text, and icon exports together.
