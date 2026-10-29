const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "extension", "background.js"),
  "utf8"
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function response(status, url, options = {}) {
  const statusText = {
    200: "OK",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    429: "Too Many Requests",
    500: "Server Error",
    999: "Blocked"
  }[status] || "";
  return {
    status,
    statusText,
    ok: status >= 200 && status < 300,
    url: options.url || url,
    redirected: Boolean(options.redirected)
  };
}

function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function harness(fetchImpl, options = {}) {
  const messages = [];
  const sendCalls = [];
  const badges = [];
  const titles = [];
  let onMessage;
  let onRemoved;
  let onUpdated;
  let onClicked;

  const sendMessage = options.sendMessage || ((tabId, message, sendOptions) => {
    sendCalls.push({ tabId, message, options: sendOptions });
    messages.push({ tabId, message });
    return Promise.resolve();
  });

  const context = vm.createContext({
    AbortController,
    URL,
    clearTimeout,
    fetch: fetchImpl,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 250 ? 0 : ms),
    chrome: {
      tabs: {
        onRemoved: { addListener: (fn) => { onRemoved = fn; } },
        onUpdated: { addListener: (fn) => { onUpdated = fn; } },
        sendMessage
      },
      action: {
        onClicked: { addListener: (fn) => { onClicked = fn; } },
        setBadgeText: (details) => { badges.push(details); return Promise.resolve(); },
        setTitle: (details) => { titles.push(details); return Promise.resolve(); }
      },
      scripting: {
        executeScript: options.executeScript || (() => Promise.resolve())
      },
      runtime: {
        onMessage: { addListener: (fn) => { onMessage = fn; } }
      }
    }
  });

  vm.runInContext(source, context, { filename: "background.js" });

  return {
    context,
    messages,
    sendCalls,
    badges,
    titles,
    receive(message, sender = { tab: { id: 7 } }) {
      let responseValue;
      const returned = onMessage(message, sender, (value) => { responseValue = value; });
      return { returned, response: responseValue };
    },
    remove(tabId = 7) { onRemoved(tabId); },
    update(tabId = 7, changeInfo = { status: "loading" }) {
      if (onUpdated) onUpdated(tabId, changeInfo);
    },
    click(tab = { id: 7 }) { return onClicked(tab); }
  };
}

async function flush() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("classifies access, rate-limit, blocked, redirect, and timeout responses", async () => {
  const calls = [];
  const h = harness(async (url, options) => {
    calls.push({ url, method: options.method, credentials: options.credentials });
    const scenario = url.split("/").pop();
    if (scenario === "timeout") throw abortError();
    if (scenario === "403") return response(options.method === "HEAD" ? 403 : 403, url);
    if (scenario === "999") return response(options.method === "HEAD" ? 999 : 999, url);
    if (scenario === "redirect") return response(200, url, { redirected: true, url: `${url}/final` });
    return response(Number(scenario), url);
  });

  const needsAccess = await h.context.checkSingleLink("https://example.test/401");
  assert.deepEqual(plain(needsAccess), {
    url: "https://example.test/401",
    status: 401,
    statusText: "Needs access",
    errorDetail: "The destination requires access or declined this request; verify it in a browser.",
    category: "unverified",
    redirectedTo: null
  });

  const forbidden = await h.context.checkSingleLink("https://example.test/403");
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.statusText, "Needs access");
  assert.equal(forbidden.category, "unverified");
  assert.match(forbidden.errorDetail, /requires access/i);

  const limited = await h.context.checkSingleLink("https://example.test/429");
  assert.equal(limited.status, 429);
  assert.equal(limited.statusText, "Rate limited");
  assert.equal(limited.category, "unverified");
  assert.match(limited.errorDetail, /rate limiting/i);

  const blocked = await h.context.checkSingleLink("https://example.test/999");
  assert.equal(blocked.status, 999);
  assert.equal(blocked.statusText, "Blocked");
  assert.equal(blocked.category, "error");

  const redirected = await h.context.checkSingleLink("https://example.test/redirect");
  assert.equal(redirected.status, 200);
  assert.equal(redirected.category, "redirect");
  assert.equal(redirected.redirectedTo, "https://example.test/redirect/final");

  const timedOut = await h.context.checkSingleLink("https://example.test/timeout");
  assert.equal(timedOut.category, "timeout");
  assert.equal(timedOut.statusText, "Timeout");

  assert.deepEqual(calls.filter((call) => call.url.endsWith("/403")).map((call) => call.method), ["HEAD", "GET"]);
  assert.deepEqual(calls.filter((call) => call.url.endsWith("/999")).map((call) => call.method), ["HEAD", "GET"]);
  assert.ok(calls.every((call) => call.credentials === "omit"));
});

test("cancels an unused response body after headers are available", async () => {
  let cancelled = 0;
  const h = harness(async (url) => ({
    ...response(200, url),
    body: { cancel: () => { cancelled += 1; return Promise.resolve(); } }
  }));

  const result = await h.context.checkSingleLink("https://example.test/body");
  assert.equal(result.category, "ok");
  assert.equal(cancelled, 1);
});

test("replacement scan does not deliver results from the old document", async () => {
  const oldRequest = deferred();
  const newRequest = deferred();
  const requests = new Map();
  const h = harness((url, options) => {
    const pending = url.endsWith("/old") ? oldRequest : newRequest;
    requests.set(url, options.signal);
    if (options.signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const abort = () => reject(abortError());
      options.signal.addEventListener("abort", abort, { once: true });
      pending.promise.then(resolve, reject);
    });
  });

  const oldStart = h.receive(
    { type: "CHECK_LINKS", scanId: "old-scan", payload: { links: ["https://example.test/old"] } },
    { tab: { id: 7 }, documentId: "old-document" }
  );
  assert.deepEqual(plain(oldStart.response), { status: "started", total: 1, scanId: "old-scan" });

  const newStart = h.receive(
    { type: "CHECK_LINKS", scanId: "new-scan", payload: { links: ["https://example.test/new"] } },
    { tab: { id: 7 }, documentId: "new-document" }
  );
  assert.deepEqual(plain(newStart.response), { status: "started", total: 1, scanId: "new-scan" });
  assert.equal(requests.get("https://example.test/old").aborted, true);

  newRequest.resolve(response(500, "https://example.test/new"));
  await flush();

  assert.deepEqual(h.messages.map(({ message }) => ({ type: message.type, scanId: message.scanId })), [
    { type: "LINK_RESULT", scanId: "new-scan" },
    { type: "SCAN_COMPLETE", scanId: "new-scan" }
  ]);
  assert.ok(h.sendCalls.every((call) => call.options && call.options.documentId === "new-document"));
  assert.equal(vm.runInContext("tabState[7]", h.context), undefined);
});

test("old completion cannot delete a replacement state", async () => {
  const h = harness(() => Promise.resolve(response(200, "https://example.test/empty")));

  h.receive(
    { type: "CHECK_LINKS", scanId: "old-empty", payload: { links: [] } },
    { tab: { id: 7 }, documentId: "document-a" }
  );
  h.receive(
    { type: "CHECK_LINKS", scanId: "new-empty", payload: { links: [] } },
    { tab: { id: 7 }, documentId: "document-b" }
  );
  await flush();

  assert.deepEqual(h.messages.map(({ message }) => ({ type: message.type, scanId: message.scanId })), [
    { type: "SCAN_COMPLETE", scanId: "new-empty" }
  ]);
  assert.equal(vm.runInContext("tabState[7]", h.context), undefined);
});

test("STOP_SCAN aborts outstanding fetches and suppresses later messages", async () => {
  const pending = deferred();
  let signal;
  const h = harness((url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(abortError()), { once: true });
      pending.promise.then(resolve, reject);
    });
  });

  h.receive(
    { type: "CHECK_LINKS", scanId: "cancel-me", payload: { links: ["https://example.test/pending"] } },
    { tab: { id: 7 }, documentId: "document-a" }
  );
  const stopped = h.receive(
    { type: "STOP_SCAN", scanId: "cancel-me" },
    { tab: { id: 7 }, documentId: "document-a" }
  );
  assert.deepEqual(plain(stopped.response), { status: "stopped", scanId: "cancel-me" });
  assert.equal(signal.aborted, true);

  pending.resolve(response(200, "https://example.test/pending"));
  await flush();
  assert.deepEqual(h.messages, []);
});

test("tab removal aborts a job without rejecting its worker", async () => {
  const pending = deferred();
  let signal;
  const h = harness((url, options) => {
    signal = options.signal;
    return pending.promise;
  });

  h.receive(
    { type: "CHECK_LINKS", scanId: "close-me", payload: { links: ["https://example.test/closed"] } },
    { tab: { id: 7 }, documentId: "document-a" }
  );
  h.remove(7);
  assert.equal(signal.aborted, true);
  pending.resolve(response(200, "https://example.test/closed"));
  await flush();
  assert.deepEqual(h.messages, []);
});

test("failed old receiver delivery cancels its job before replacement", async () => {
  const oldFirst = deferred();
  const oldSecond = deferred();
  const fresh = deferred();
  const signals = {};
  const attempts = [];
  const sent = [];
  const h = harness((url, options) => {
    const key = url.split("/").pop();
    signals[key] = options.signal;
    const pending = key === "old-first" ? oldFirst : key === "old-second" ? oldSecond : fresh;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(abortError()), { once: true });
      pending.promise.then(resolve, reject);
    });
  }, {
    sendMessage: (tabId, message, options) => {
      attempts.push({ tabId, message, options });
      if (message.scanId === "old-scan" && message.type === "LINK_RESULT") {
        return Promise.reject(new Error("old receiver gone"));
      }
      sent.push({ tabId, message, options });
      return Promise.resolve();
    }
  });

  h.receive(
    {
      type: "CHECK_LINKS",
      scanId: "old-scan",
      payload: {
        links: ["https://example.test/old-first", "https://example.test/old-second"]
      }
    },
    { tab: { id: 7 }, documentId: "old-document" }
  );
  oldFirst.resolve(response(200, "https://example.test/old-first"));
  await flush();
  assert.equal(signals["old-second"].aborted, true);
  assert.equal(vm.runInContext("tabState[7]", h.context), undefined);
  assert.equal(attempts[0].message.scanId, "old-scan");

  h.receive(
    { type: "CHECK_LINKS", scanId: "new-scan", payload: { links: ["https://example.test/new"] } },
    { tab: { id: 7 }, documentId: "new-document" }
  );
  fresh.resolve(response(500, "https://example.test/new"));
  await flush();
  assert.deepEqual(sent.map(({ message }) => ({ type: message.type, scanId: message.scanId })), [
    { type: "LINK_RESULT", scanId: "new-scan" },
    { type: "SCAN_COMPLETE", scanId: "new-scan" }
  ]);
  assert.ok(sent.every(({ options }) => options && options.documentId === "new-document"));
});

test("loading tab updates do not cancel a same-document scan", async () => {
  const pending = deferred();
  let signal;
  const h = harness((url, options) => {
    signal = options.signal;
    return pending.promise;
  });

  h.receive(
    { type: "CHECK_LINKS", scanId: "same-document", payload: { links: ["https://example.test/hash"] } },
    { tab: { id: 7 }, documentId: "document-a" }
  );
  h.update(7, { status: "loading", url: "https://example.test/page#section" });
  assert.equal(signal.aborted, false);

  pending.resolve(response(200, "https://example.test/hash"));
  await flush();
  assert.deepEqual(h.messages.map(({ message }) => ({ type: message.type, scanId: message.scanId })), [
    { type: "LINK_RESULT", scanId: "same-document" },
    { type: "SCAN_COMPLETE", scanId: "same-document" }
  ]);
});

test("rejected tab message delivery is guarded", async () => {
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    const h = harness(() => Promise.resolve(response(200, "https://example.test/ok")), {
      sendMessage: () => Promise.reject(new Error("tab closed"))
    });
    h.receive(
      { type: "CHECK_LINKS", scanId: "send-fails", payload: { links: ["https://example.test/ok"] } },
      { tab: { id: 7 }, documentId: "document-a" }
    );
    await flush();
    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
});

test("unsupported-page feedback is set on failure and cleared after success", async () => {
  let shouldFail = true;
  const executed = [];
  const h = harness(() => Promise.resolve(response(200, "https://example.test/ok")), {
    executeScript: (details) => {
      executed.push(details);
      return shouldFail ? Promise.reject(new Error("Cannot access chrome:// page")) : Promise.resolve();
    }
  });

  await h.click({ id: 12 });
  assert.deepEqual(plain(executed), [{ target: { tabId: 12 }, files: ["content.js"] }]);
  assert.deepEqual(plain(h.badges[0]), { tabId: 12, text: "!" });
  assert.match(h.titles[0].title, /normal webpages.*Reload/i);

  shouldFail = false;
  await h.click({ id: 12 });
  assert.deepEqual(plain(h.badges[1]), { tabId: 12, text: "" });
  assert.deepEqual(plain(h.titles[1]), { tabId: 12, title: "" });
});

test("retries a HEAD 404 with GET and reports the page as OK when GET succeeds", async () => {
  const calls = [];
  const h = harness(async (url, options) => {
    calls.push(options.method);
    return response(options.method === "HEAD" ? 404 : 200, url);
  });

  const result = await h.context.checkSingleLink("https://other.test/page");
  assert.equal(result.status, 200);
  assert.equal(result.category, "ok");
  assert.deepEqual(calls, ["HEAD", "GET"]);
});

test("same-site 404s are unverified, other-site 404s stay broken", async () => {
  const h = harness(async (url) => response(404, url));
  const state = { pageUrl: "https://www.github.com/leemark/checklinks", controllers: new Set() };

  const sameSite = await h.context.checkSingleLink("https://github.com/leemark/checklinks/settings", state);
  assert.equal(sameSite.status, 404);
  assert.equal(sameSite.category, "unverified");
  assert.equal(sameSite.statusText, "May need sign-in");
  assert.match(sameSite.errorDetail, /sign-in/i);

  const otherSite = await h.context.checkSingleLink("https://example.test/missing", state);
  assert.equal(otherSite.status, 404);
  assert.equal(otherSite.category, "client_error");

  const noPage = await h.context.checkSingleLink("https://github.com/missing");
  assert.equal(noPage.category, "client_error");
});

test("a scan records the sender page URL for same-site checks", async () => {
  const h = harness(async (url) => response(404, url));
  h.receive(
    { type: "CHECK_LINKS", scanId: "s1", payload: { links: ["https://github.com/settings"] } },
    { tab: { id: 7, url: "https://github.com/leemark" }, url: "https://github.com/leemark" }
  );
  await flush();
  await flush();
  const result = h.messages.find((m) => m.message.type === "LINK_RESULT").message.payload;
  assert.equal(result.category, "unverified");
  assert.equal(result.statusText, "May need sign-in");
});
