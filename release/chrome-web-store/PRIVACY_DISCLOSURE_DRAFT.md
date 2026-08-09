# Privacy Disclosure Draft

Use this as the source draft when filling the Chrome Web Store privacy section.

## Data The Extension Handles

- Web history / browsing activity
  Why:
  The extension reads current tab titles and URLs, groups tabs by hostname, and stores lightweight forward-looking trend metrics for tab usage.
- Website content
  Why:
  The extension reads a short local snippet from accessible HTTP(S) tabs: it first checks `meta[name="description"]` or `og:description`, then falls back to visible `article`/`main`/body text when metadata is unavailable. It truncates the result for display, does not retain full page content, and does not transmit the snippet.

## Data Storage Model

- Data is stored locally in `chrome.storage.local`.
- No backend service is used.
- No analytics SDK is used.
- No advertising or sale of data is used.

## Draft Disclosure Answers

- Is user data sold?
  No.
- Is user data transferred to third parties other than for the item's core functionality?
  No.
- Is user data used or transferred for creditworthiness or lending purposes?
  No.
- Is user data used only for the extension's single purpose?
  Yes.

## Permission Justification

- `tabs`
  Needed to read current tabs, switch to existing tabs, close tabs, and merge tabs into windows.
- `storage`
  Needed for local persistence of see-it-later state, UI preferences, last-switched metadata, and trend metrics.
- `alarms`
  Needed to flush best-effort active-tab browse-time tracking in the background.
- `favicon`
  Needed to render Chrome favicon fallbacks for trend and domain cards.
- `scripting`
  Needed to read a short page description or fallback text snippet locally from accessible HTTP(S) tabs.
- `http://*/*` and `https://*/*`
  Needed so the packaged script can inspect standard metadata and a small visible-text fallback on the user's open webpages. The values stay local and are not sent to a server.

## Reviewer Notes

- The extension does not sync browsing data to a remote service.
- The extension does not request Chrome identity information or access the user's profile email.
- Trends are forward-looking only and are derived from local Chrome extension events after installation.
