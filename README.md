# CheckLinks

A Chrome extension that checks all hyperlinks on a web page for broken links. Click the extension icon to scan the current page — broken links are highlighted directly on the page and results are shown in a floating, draggable panel.

## Features

- **Inline overlays** — links are outlined and badged with their status directly on the page
  - Green: working (2xx)
  - Amber: redirect (3xx)
  - Red: broken (4xx/5xx)
  - Gray: timeout or network error
- **Floating results panel** — draggable, closeable panel with sorted results list, summary counts, and progress bar. Stays open until you close it and can be moved out of the way.
- **Filter & scroll-to** — filter results by status category and click any result to scroll directly to the link on the page
- **Detailed error reporting** — network errors are classified (DNS failure, connection refused, SSL error, timeout, etc.) with explanations shown in the results
- **CSV export** — download scan results as a CSV file
- **Respectful review request** — a small optional review link sits quietly at the bottom of the panel. It never interrupts a scan and records no activity data.
- **Throttled requests** — checks 3 links concurrently with delays between requests using HEAD (with GET fallback) to avoid overwhelming servers
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

1. Navigate to any web page
2. Click the CheckLinks icon in the toolbar — a floating panel appears and scanning starts automatically
3. Links on the page will be highlighted with colored outlines and status badges as results come in
4. The panel shows a summary with counts and a scrollable, sorted list of results
5. Drag the panel by its header to move it out of the way
6. Click **Export CSV** to download the results
7. Click **Clear** to remove all overlays from the page
8. Click **X** to close the panel (click the icon again to reopen it)

## How It Works

The extension uses Chrome's Manifest V3 architecture:

- **Content script** (`content.js`) is injected on demand into the active tab when you click the icon. It scrapes all `<a>` elements, builds the floating results panel, and applies colored overlays as results arrive.
- **Service worker** (`background.js`) receives the list of URLs and checks each one via `fetch` HEAD requests (with GET fallback for servers that reject HEAD or return 403). Requests run with a concurrency limit of 3, a 250ms delay between requests, and a 10-second timeout per request.

### Link Status Categories

| Category     | HTTP Status        | Color | Badge     |
|--------------|--------------------|-------|-----------|
| OK           | 200–299            | Green | OK        |
| Redirect     | 301, 302, 307, 308| Amber | 3xx       |
| Client Error | 400–499            | Red   | Status code |
| Server Error | 500–599            | Red   | Status code |
| Timeout      | —                  | Gray  | Timeout   |
| Network Error| —                  | Gray  | Error     |
| Skipped      | mailto, tel, etc.  | Light gray | Skip |

## Project Structure

```
checklinks/
  extension/
    manifest.json    # Chrome extension manifest (Manifest V3)
    background.js    # Service worker — link checking engine
    content.js       # Content script — link scraping, results panel, and overlays
    content.css      # Panel and overlay styles
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

- **activeTab** — access to the current tab only when you click the icon
- **scripting** — inject the content script on demand
- **host_permissions (`<all_urls>`)** — required so the service worker can make HTTP requests to check links on any domain

## Links

- [Chrome Web Store](https://chromewebstore.google.com/detail/checklinks/chhcilocdjapdojciijkeghifjdicdmp)
- [Website](https://leemark.github.io/checklinks/)
- [Support and known limitations](https://leemark.github.io/checklinks/support.html)
- [Privacy policy](https://leemark.github.io/checklinks/privacy.html)

## License

MIT
