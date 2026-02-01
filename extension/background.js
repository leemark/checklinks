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

async function checkLinksWithConcurrency(tabId, urls, concurrency = 3) {
  let index = 0;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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

      // Pause between requests to avoid overwhelming servers
      await delay(250);
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

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

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
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: controller.signal,
      credentials: "omit"
    });
    clearTimeout(timeoutId);

    // Some servers reject HEAD or block it — retry with GET
    if (response.status === 405 || response.status === 403) {
      return await checkWithGet(url);
    }

    const redirected = response.redirected;
    const finalUrl = response.url;

    // If the response followed a redirect, report it as a redirect
    // even though the final status is 200
    if (redirected && response.ok) {
      return {
        url,
        status: response.status,
        statusText: response.statusText,
        category: "redirect",
        redirectedTo: finalUrl
      };
    }

    return {
      url,
      status: response.status,
      statusText: response.statusText,
      category: categorize(response.status),
      redirectedTo: redirected ? finalUrl : null
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      return { url, status: 0, statusText: "Timeout", errorDetail: "Request timed out after 10 seconds", category: "timeout" };
    }
    const { reason, detail } = classifyNetworkError(err);
    return { url, status: 0, statusText: reason, errorDetail: detail, category: "error" };
  }
}

async function checkWithGet(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: controller.signal,
      credentials: "omit"
    });
    clearTimeout(timeoutId);

    const redirected = response.redirected;
    const finalUrl = response.url;

    if (redirected && response.ok) {
      return {
        url,
        status: response.status,
        statusText: response.statusText,
        category: "redirect",
        redirectedTo: finalUrl
      };
    }

    return {
      url,
      status: response.status,
      statusText: response.statusText,
      category: categorize(response.status),
      redirectedTo: redirected ? finalUrl : null
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      return { url, status: 0, statusText: "Timeout", errorDetail: "Request timed out after 10 seconds", category: "timeout" };
    }
    const { reason, detail } = classifyNetworkError(err);
    return { url, status: 0, statusText: reason, errorDetail: detail, category: "error" };
  }
}

function classifyNetworkError(err) {
  const msg = err.message || "";

  if (msg.includes("ERR_NAME_NOT_RESOLVED") || msg.includes("getaddrinfo")) {
    return { reason: "DNS failed", detail: "Domain name could not be resolved" };
  }
  if (msg.includes("ERR_CONNECTION_REFUSED")) {
    return { reason: "Refused", detail: "Connection refused by server" };
  }
  if (msg.includes("ERR_CONNECTION_RESET") || msg.includes("ECONNRESET")) {
    return { reason: "Reset", detail: "Connection was reset by server" };
  }
  if (msg.includes("ERR_CONNECTION_TIMED_OUT") || msg.includes("ETIMEDOUT")) {
    return { reason: "Conn timeout", detail: "Connection timed out" };
  }
  if (msg.includes("ERR_SSL") || msg.includes("ERR_CERT") || msg.includes("SSL")) {
    return { reason: "SSL error", detail: "SSL/TLS certificate error: " + msg };
  }
  if (msg.includes("ERR_TOO_MANY_REDIRECTS")) {
    return { reason: "Redirect loop", detail: "Too many redirects" };
  }
  if (msg.includes("ERR_BLOCKED") || msg.includes("ERR_ABORTED")) {
    return { reason: "Blocked", detail: "Request was blocked (possibly by CORS or browser policy)" };
  }
  if (msg.includes("ERR_INSUFFICIENT_RESOURCES") || msg.includes("ERR_NETWORK")) {
    return { reason: "Network error", detail: "Network error — too many simultaneous connections or network is down" };
  }
  if (msg.includes("Failed to fetch")) {
    return { reason: "Network error", detail: "Could not connect — network error or CORS restriction" };
  }

  return { reason: "Error", detail: msg || "Unknown error" };
}

function categorize(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 301 || status === 302 || status === 307 || status === 308) return "redirect";
  if (status >= 400 && status < 500) return "client_error";
  if (status >= 500 && status < 600) return "server_error";
  return "error";
}
