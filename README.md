# CheckLinks

A Chrome extension that checks links on the page you are viewing. Click the extension icon to start a scan — results are highlighted directly on the page and collected in a floating panel.

## Features

- **Inline overlays** — links are outlined and badged with their status directly on the page
  - Green: OK (2xx)
  - Amber: redirect (the request reached another URL)
  - Red: broken (most 4xx/5xx responses)
  - Gray: Other, including access, rate-limit, timeout, and network results
- **Floating results panel** — a responsive, draggable panel with accessible status filters, summary counts, and progress. The first toolbar click starts a scan; later toolbar clicks show or hide the panel.
- **Filter & show on page** — filter by OK, Redirect, Broken, Other, or Total, then use **Show on page** to jump to a matching link.
- **Clear and stop controls** — **Stop** cancels an active scan while retaining its partial report. **Clear results** removes the report and its page overlays.
- **CSV export** — **Export all CSV** saves every result, regardless of the selected filter; a stopped scan exports the partial report.
- **Respectful review request** — a small optional review link sits quietly at the bottom of the panel. It never interrupts a scan and records no activity data.
- **Throttled requests** — checks unique HTTP/HTTPS destinations concurrently with delays between requests, using HEAD with GET fallback for 403, 405, and 999 responses
- **Lightweight** — plain JavaScript, no build step, no dependencies

## Installation

### From Chrome Web Store (recommended)

Install directly from the Chrome Web Store:

https://chromewebstore.google.com/detail/checklinks/chhcilocdjapdojciijkeghifjdicdmp

### From source (developer mode)

1. Clone this repository:
   ```
   git clone https://github.com/leemark/checklinks.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked**
5. Select the `extension` folder from this repository

## Usage

1. Navigate to a normal `http://` or `https://` webpage. If CheckLinks is not pinned, open Chrome's Extensions menu (the puzzle-piece icon), find CheckLinks, and select the pin control so it stays in the toolbar.
2. Click the CheckLinks toolbar icon once. The panel appears and the scan starts automatically. On later toolbar clicks, the panel is shown or hidden.
3. Use **Scan Page** to start a new scan of the current main document. The scan reads links present at that moment; links added later require another scan.
4. Links on the page are highlighted as results arrive. Duplicate occurrences of the same HTTP/HTTPS URL are grouped; fragment-only links and `mailto:`, `tel:`, and `javascript:` links are skipped and not tested.
5. Use the **OK**, **Redirect**, **Broken**, **Other**, and **Total** buttons to filter. Each result includes its full URL, response details, any final redirect URL, and an error explanation when available. Select **Show on page** to jump to the link.
6. Drag the panel by its header to move it out of the way. **Stop** cancels the active scan and retains the partial report.
7. Click **Export all CSV** to save every current result, even while a filter is selected. The local CSV may include the page URL and link text.
8. Click **Clear results** to remove the report and all page overlays.

## How It Works

The extension uses Chrome's Manifest V3 architecture:

- **Content script** (`content.js`) is injected on demand into the active tab when you click the icon. It reads anchors in the current main document, groups duplicate HTTP/HTTPS destinations, builds the floating results panel, and applies colored overlays as results arrive. It does not scan frames or shadow roots, and links added after collection require a rescan.
- **Service worker** (`background.js`) checks each unique destination with `fetch`, following redirects and showing the final response and final URL in the result. It uses HEAD first, then GET for 403, 405, or 999 responses, omits credentials, limits concurrency to 3, spaces requests by 250ms, and times out each request after 10 seconds.

### Link Status Categories

| Category | Typical result | Color | Meaning |
|----------|----------------|-------|---------|
| OK | 2xx | Green | The destination returned a successful response. |
| Redirect | Followed redirect | Amber | The request ended at another URL; the row shows the final response. |
| Broken | Most 4xx/5xx | Red | The destination returned an HTTP error. 401 and 403 are reported as **Needs access** under Other, and a same-site 404 as **May need sign-in**. |
| Other | 401/403, same-site 404, 429, blocked, timeout, network error, or skipped | Gray | The result is unverified or was not tested. 429 is **Rate limited** and is not necessarily broken. |

Network failures use a general error description. CheckLinks does not promise to identify a precise DNS, TLS, or connection-refused cause from a browser fetch failure.

## Project Structure

```
checklinks/
  extension/
    manifest.json    # Chrome extension manifest (Manifest V3)
    background.js    # Service worker — link checking engine
    content.js       # Content script — link scraping, results panel, and overlays
    content.css      # Isolated panel styles
    icons/           # Extension icons (16/32/48/128px)
  docs/
    index.html       # Landing page (GitHub Pages)
    styles.css       # Shared website styles
    support.html     # Support and known limitations
    how-to-check-links-before-publishing.html
    broken-link-qa-after-website-migration.html
    broken-link-checking-for-documentation-teams.html
    privacy.html     # Privacy policy
    images/          # Product screenshots and social-sharing image
```

## Releasing

1. Bump `version` in `extension/manifest.json` and merge to `main`.
2. Optionally add release notes at `.github/release-notes/vX.Y.Z.md`; without that file, GitHub generates notes from merged PRs.
3. Push a matching tag (`git tag -a vX.Y.Z -m "CheckLinks X.Y.Z" && git push origin vX.Y.Z`).

The **Release** workflow then checks that the tag matches the manifest version, zips `extension/` and publishes a GitHub release with the zip attached. For a tag that already exists, run the workflow manually from the Actions tab and enter the tag.

## Permissions

- **activeTab** — lets CheckLinks read the current page after you click the toolbar icon.
- **scripting** — inject the content script on demand
- **host_permissions (`<all_urls>`)** — required so the service worker can make HTTP requests to check links on any domain

Link-check requests go directly from your browser to the destination websites. Chrome grants broad website access so the extension can check destinations across domains; a page scan runs only when you activate it by clicking the toolbar icon. CheckLinks has no telemetry, collection, account, or third-party processing backend. The visible report is held in memory; **Clear results** removes the visible report and overlays, and a new scan or navigation replaces the current in-memory scan state. Nothing is written to persistent storage, and a CSV saved locally can contain the source page URL and link text. Chrome-controlled pages such as `chrome://` pages and the Chrome Web Store do not allow injection; when injection is blocked, CheckLinks provides best-effort toolbar badge and title feedback.

## Links

- [Chrome Web Store](https://chromewebstore.google.com/detail/checklinks/chhcilocdjapdojciijkeghifjdicdmp)
- [Website](https://leemark.github.io/checklinks/)
- [Support and known limitations](https://leemark.github.io/checklinks/support.html)
- [Privacy policy](https://leemark.github.io/checklinks/privacy.html)

## License

MIT
