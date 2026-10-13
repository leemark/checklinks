// Per-tab scan state. A state object represents one content-script document
// and one scan. Workers must keep this exact object before publishing results.
const tabState = {};

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

const REQUEST_TIMEOUT_MS = 10000;
const REQUEST_SPACING_MS = 250;

// A tab can be closed while a fetch or message delivery is still pending.
// Abort the state before deleting it so every worker observes cancellation.
if (chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    const state = tabState[tabId];
    if (!state) return;
    cancelState(state);
    if (tabState[tabId] === state) delete tabState[tabId];
  });
}

// Clicking the extension icon injects only the content script. The content
// script owns its Shadow DOM stylesheet, so no page-level CSS is injected.
chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab && tab.id;
  if (typeof tabId !== "number") return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    await setActionFeedback(tabId, "", "");
  } catch (_) {
    await setActionFeedback(
      tabId,
      "!",
      "CheckLinks works on normal webpages. Reload the page and try again."
    );
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "CHECK_LINKS") {
    const tabId = sender && sender.tab && sender.tab.id;
    const scanId = message.scanId;
    const documentId = sender && sender.documentId;
    if (typeof tabId !== "number" || typeof scanId !== "string" || !scanId) return false;

    const links = message.payload && Array.isArray(message.payload.links)
      ? message.payload.links
      : [];
    const uniqueUrls = [...new Set(links)];
    const previousState = tabState[tabId];
    if (previousState) cancelState(previousState);

    const state = {
      results: new Map(),
      scanning: true,
      total: uniqueUrls.length,
      cancelled: false,
      scanId,
      documentId,
      controllers: new Set()
    };
    tabState[tabId] = state;

    // Start the workers after recording the state. The response remains
    // synchronous, while all later messages carry the same scan identity.
    void checkLinksWithConcurrency(tabId, uniqueUrls, 3, state);
    sendResponse({ status: "started", total: uniqueUrls.length, scanId });
    return false;
  }

  if (message.type === "STOP_SCAN") {
    const tabId = sender && sender.tab && sender.tab.id;
    const scanId = message.scanId;
    const documentId = sender && sender.documentId;
    const state = typeof tabId === "number" ? tabState[tabId] : undefined;
    if (
      !state ||
      typeof scanId !== "string" ||
      state.scanId !== scanId ||
      state.documentId !== documentId
    ) {
      return false;
    }

    cancelState(state);
    if (tabState[tabId] === state) delete tabState[tabId];
    sendResponse({ status: "stopped", scanId });
    return false;
  }

  return false;
});

function cancelState(state) {
  if (!state || state.cancelled) return;
  state.cancelled = true;
  state.scanning = false;
  if (state.controllers) {
    for (const controller of state.controllers) {
      try {
        controller.abort();
      } catch (_) {
        // An already-aborted controller is harmless.
      }
    }
    state.controllers.clear();
  }
}

function isCurrentState(tabId, state) {
  return Boolean(
    state &&
    !state.cancelled &&
    tabState[tabId] === state &&
    tabState[tabId].scanId === state.scanId &&
    tabState[tabId].documentId === state.documentId
  );
}

async function setActionFeedback(tabId, badgeText, title) {
  try {
    if (chrome.action.setBadgeText) {
      await Promise.resolve(chrome.action.setBadgeText({ tabId, text: badgeText }));
    }
  } catch (_) {
    // Feedback is best effort; injection result remains the source of truth.
  }
  try {
    if (chrome.action.setTitle) {
      await Promise.resolve(chrome.action.setTitle({ tabId, title }));
    }
  } catch (_) {
    // Feedback is best effort; injection result remains the source of truth.
  }
}

async function sendScanMessage(tabId, state, message) {
  if (!isCurrentState(tabId, state)) return false;

  const options = state.documentId === undefined
    ? undefined
    : { documentId: state.documentId };

  try {
    const delivery = options === undefined
      ? chrome.tabs.sendMessage(tabId, message)
      : chrome.tabs.sendMessage(tabId, message, options);
    await Promise.resolve(delivery);
    return true;
  } catch (_) {
    // The tab or content document may have gone away between the state check
    // and sendMessage. Cancel the job so remaining fetches are released, and
    // guard deletion so a replacement scan survives this old rejection.
    cancelState(state);
    if (tabState[tabId] === state) delete tabState[tabId];
    return false;
  }
}

async function checkLinksWithConcurrency(tabId, urls, concurrency = 3, state = tabState[tabId]) {
  if (!state) return;
  let index = 0;

  async function worker() {
    while (isCurrentState(tabId, state)) {
      const i = index++;
      if (i >= urls.length) return;

      const result = await checkSingleLink(urls[i], state);
      if (!isCurrentState(tabId, state)) return;

      state.results.set(result.url, result);
      await sendScanMessage(tabId, state, {
        type: "LINK_RESULT",
        scanId: state.scanId,
        payload: result
      });
      if (!isCurrentState(tabId, state)) return;

      await delay(REQUEST_SPACING_MS, state);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, urls.length || 1));
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  if (!isCurrentState(tabId, state)) return;
  state.scanning = false;
  await sendScanMessage(tabId, state, {
    type: "SCAN_COMPLETE",
    scanId: state.scanId
  });
  // Results remain in the content document for display/export. The service
  // worker does not need to retain a parallel result map after completion.
  if (tabState[tabId] === state) delete tabState[tabId];
}

function delay(ms, state) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (!state || !state.cancelled) return;
    clearTimeout(timer);
    resolve();
  });
}

function registerController(state) {
  const controller = new AbortController();
  if (state && state.controllers) state.controllers.add(controller);
  return controller;
}

function unregisterController(state, controller) {
  if (state && state.controllers) state.controllers.delete(controller);
}

async function request(url, method, state) {
  if (state && state.cancelled) {
    const error = new Error("Scan cancelled");
    error.name = "AbortError";
    throw error;
  }

  const controller = registerController(state);
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: controller.signal,
      credentials: "omit"
    });

    // Link checking uses response headers only. Release an unused GET/HEAD
    // body so a large response is not downloaded after classification.
    try {
      const cancellation = response && response.body && typeof response.body.cancel === "function"
        ? response.body.cancel()
        : undefined;
      if (cancellation && typeof cancellation.catch === "function") {
        cancellation.catch(() => {});
      }
    } catch (_) {
      // Some response implementations expose a non-cancellable body.
    }
    return response;
  } finally {
    clearTimeout(timeoutId);
    unregisterController(state, controller);
  }
}

async function checkSingleLink(url, state) {
  // Skip non-HTTP schemes.
  if (/^(mailto:|tel:|javascript:|data:)/.test(url)) {
    return { url, status: 0, statusText: "Skipped", category: "skipped" };
  }

  try {
    const response = await request(url, "HEAD", state);

    // Some servers reject HEAD or block it — retry with GET.
    if (response.status === 405 || response.status === 403 || response.status === 999) {
      return await checkWithGet(url, state);
    }

    return resultFromResponse(url, response);
  } catch (err) {
    return resultFromError(url, err);
  }
}

async function checkWithGet(url, state) {
  try {
    const response = await request(url, "GET", state);
    return resultFromResponse(url, response);
  } catch (err) {
    return resultFromError(url, err);
  }
}

function resultFromResponse(url, response) {
  const redirected = response.redirected;
  const finalUrl = response.url;

  // A successful final response after a redirect is still a redirect result.
  if (redirected && response.ok) {
    return {
      url,
      status: response.status,
      statusText: response.statusText,
      category: "redirect",
      redirectedTo: finalUrl
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      url,
      status: response.status,
      statusText: "Needs access",
      errorDetail: "The destination requires access or declined this request; verify it in a browser.",
      category: "unverified",
      redirectedTo: redirected ? finalUrl : null
    };
  }

  if (response.status === 429) {
    return {
      url,
      status: response.status,
      statusText: "Rate limited",
      errorDetail: "The destination is rate limiting automated checks; verify it again later.",
      category: "unverified",
      redirectedTo: redirected ? finalUrl : null
    };
  }

  if (response.status === 999) {
    return {
      url,
      status: 999,
      statusText: "Blocked",
      errorDetail: "This site blocks automated link checking (status 999)",
      category: "error",
      redirectedTo: redirected ? finalUrl : null
    };
  }

  return {
    url,
    status: response.status,
    statusText: response.statusText,
    category: categorize(response.status),
    redirectedTo: redirected ? finalUrl : null
  };
}

function resultFromError(url, err) {
  if (err && err.name === "AbortError") {
    return {
      url,
      status: 0,
      statusText: "Timeout",
      errorDetail: "Request timed out after 10 seconds",
      category: "timeout"
    };
  }
  const { reason, detail } = classifyNetworkError(err || {});
  return { url, status: 0, statusText: reason, errorDetail: detail, category: "error" };
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
