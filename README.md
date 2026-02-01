# CheckLinks

A Chrome extension that checks all hyperlinks on a web page for broken links. Click the extension icon to scan the current page — broken links are highlighted directly on the page and listed in a popup summary.

## Features

- **Inline overlays** — links are outlined and badged with their status directly on the page
  - Green: working (2xx)
  - Amber: redirect (3xx)
  - Red: broken (4xx/5xx)
  - Gray: timeout or network error
- **Popup summary** — sorted results list with broken links first, summary counts, and a progress bar
- **CSV export** — download scan results as a CSV file
- **Fast** — checks up to 6 links concurrently using HEAD requests with GET fallback
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
2. Click the CheckLinks icon in the toolbar
3. Click **Scan Page** in the popup
4. Links on the page will be highlighted with colored outlines and status badges
5. The popup shows a summary with counts and a scrollable list of results
6. Click **Export CSV** to download the results
7. Click **Clear** to remove all overlays from the page

## How It Works

The extension uses Chrome's Manifest V3 architecture:

- **Content script** (`content.js`) is injected on demand into the active tab. It scrapes all `<a>` elements and applies colored overlays as results arrive.
- **Service worker** (`background.js`) receives the list of URLs and checks each one via `fetch` HEAD requests (with GET fallback for servers that reject HEAD). Requests run with a concurrency limit of 6 and a 10-second timeout.
- **Popup** (`popup.html/js/css`) triggers the scan, polls for results, and renders the summary.

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
    content.js       # Content script — link scraping and overlays
    content.css      # Overlay and banner styles
    popup.html       # Popup markup
    popup.js         # Popup logic
    popup.css        # Popup styles
    icons/           # Extension icons (16/32/48/128px)
```

## Permissions

- **activeTab** — access to the current tab only when you click the icon
- **scripting** — inject the content script on demand
- **host_permissions (`<all_urls>`)** — required so the service worker can make HTTP requests to check links on any domain

## License

MIT
