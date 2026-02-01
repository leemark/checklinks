// Per-tab scan state. Keyed by tabId.
const tabState = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHECK_LINKS") {
    const tabId = sender.tab?.id ?? message.tabId;

    // De-duplicate URLs
    const uniqueUrls = [...new Set(message.payload.links)];

    tabState[tabId] = {
      results: new Map(),
      scanning: true,
      total: uniqueUrls.length,
      cancelled: false
    };

    checkLinksWithConcurrency(tabId, uniqueUrls);
    sendResponse({ status: "started", total: uniqueUrls.length });
    return false;
  }

  if (message.type === "GET_RESULTS") {
    const tabId = message.tabId;
    const state = tabState[tabId];
    if (!state) {
      sendResponse({ results: [], scanning: false, total: 0 });
    } else {
      sendResponse({
        results: Array.from(state.results.values()),
        scanning: state.scanning,
        total: state.total
      });
    }
    return false;
  }

  if (message.type === "CANCEL_SCAN") {
    const tabId = message.tabId;
    if (tabState[tabId]) {
      tabState[tabId].cancelled = true;
      tabState[tabId].scanning = false;
    }
    sendResponse({ status: "cancelled" });
    return false;
  }
});

async function checkLinksWithConcurrency(tabId, urls, concurrency = 6) {
  let index = 0;

  async function worker() {
    while (index < urls.length) {
      if (tabState[tabId]?.cancelled) return;
      const i = index++;
      if (i >= urls.length) return;

      const result = await checkSingleLink(urls[i]);

      if (tabState[tabId]?.cancelled) return;

      tabState[tabId].results.set(result.url, result);

      // Send incremental result to content script
      try {
        chrome.tabs.sendMessage(tabId, {
          type: "LINK_RESULT",
          payload: result
        });
      } catch (_) {
        // Tab may have been closed
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  if (tabState[tabId]) {
    tabState[tabId].scanning = false;

    try {
      chrome.tabs.sendMessage(tabId, { type: "SCAN_COMPLETE" });
    } catch (_) {
      // Tab may have been closed
    }
  }
}

async function checkSingleLink(url) {
  // Skip non-HTTP schemes
  if (/^(mailto:|tel:|javascript:|data:)/.test(url)) {
    return { url, status: 0, statusText: "Skipped", category: "skipped" };
  }

  // Skip anchor-only (already resolved to full URL with hash, but if it's
  // the same page with just a fragment, we don't need to fetch)
  // This is handled by content.js marking same-page anchors

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
      credentials: "omit"
    });
    clearTimeout(timeoutId);

    // Some servers reject HEAD — retry with GET
    if (response.status === 405) {
      return await checkWithGet(url);
    }

    return {
      url,
      status: response.status,
      statusText: response.statusText,
      category: categorize(response.status),
      redirectedTo: response.headers.get("Location") || null
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      return { url, status: 0, statusText: "Timeout", category: "timeout" };
    }
    return { url, status: 0, statusText: err.message, category: "error" };
  }
}

async function checkWithGet(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      credentials: "omit"
    });
    clearTimeout(timeoutId);

    return {
      url,
      status: response.status,
      statusText: response.statusText,
      category: categorize(response.status),
      redirectedTo: response.headers.get("Location") || null
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      return { url, status: 0, statusText: "Timeout", category: "timeout" };
    }
    return { url, status: 0, statusText: err.message, category: "error" };
  }
}

function categorize(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 301 || status === 302 || status === 307 || status === 308) return "redirect";
  if (status >= 400 && status < 500) return "client_error";
  if (status >= 500 && status < 600) return "server_error";
  return "error";
}
