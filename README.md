# CheckLinks

A Chrome extension that checks all hyperlinks on a web page for broken links. Click the extension icon to scan the current page — broken links are highlighted directly on the page and results are shown in a floating, draggable panel.

## Features

- **Inline overlays** — links are outlined and badged with their status directly on the page
  - Green: working (2xx)
  - Amber: redirect (3xx)
  - Red: broken (4xx/5xx)
  - Gray: timeout or network error
- **Floating results panel** — draggable, closeable panel with sorted results list, summary counts, and progress bar. Stays open until you close it and can be moved out of the way.
- **Detailed error reporting** — network errors are classified (DNS failure, connection refused, SSL error, timeout, etc.) with explanations shown in the results
- **CSV export** — download scan results as a CSV file
- **Throttled requests** — checks 3 links concurrently with delays between requests using HEAD (with GET fallback) to avoid overwhelming servers
- **Lightweight** — plain JavaScript, no build step, no dependencies

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/<your-username>/checklinks.git
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
```

## Permissions

- **activeTab** — access to the current tab only when you click the icon
- **scripting** — inject the content script on demand
- **host_permissions (`<all_urls>`)** — required so the service worker can make HTTP requests to check links on any domain

## License

MIT
