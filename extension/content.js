(() => {
  if (window.__checkLinksUI?.host.isConnected) {
    window.__checkLinksUI.toggle();
    return;
  }

  const REVIEW_URL = "https://chromewebstore.google.com/detail/checklinks/chhcilocdjapdojciijkeghifjdicdmp/reviews";
  const host = document.createElement("div");
  host.id = "checklinks-panel";
  // Host rules cannot leak into the panel. Important inline properties also protect
  // its position from common site-wide div and custom-element rules.
  host.style.cssText = "all:initial!important;position:fixed!important;z-index:2147483647!important;display:block!important;visibility:hidden!important;width:min(420px, calc(100vw - 16px))!important;max-height:calc(100vh - 16px)!important;left:0!important;top:16px!important;";
  const root = host.attachShadow({ mode: "open" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = chrome.runtime.getURL("content.css");
  root.append(stylesheet);

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(text, className = "button") {
    const el = element("button", className, text);
    el.type = "button";
    return el;
  }

  const panel = element("section", "panel");
  panel.setAttribute("aria-label", "CheckLinks link checker");
  panel.tabIndex = -1;
  const header = element("header", "header");
  const titleRow = element("div", "title-row");
  const title = element("h2", "title", "CheckLinks");
  const moveBtn = button("Move", "header-button move");
  moveBtn.setAttribute("aria-label", "Move panel: drag or use arrow keys");
  moveBtn.title = "Drag or use arrow keys to move the panel";
  const closeBtn = button("✕", "header-button close");
  closeBtn.setAttribute("aria-label", "Hide CheckLinks panel");
  closeBtn.title = "Hide panel (a running scan continues)";
  titleRow.append(title, moveBtn, closeBtn);
  const status = element("p", "status", "Ready");
  status.setAttribute("role", "status");
  status.setAttribute("aria-atomic", "true");
  header.append(titleRow, status);
  const controls = element("div", "controls");
  const scanBtn = button("Scan Page", "button primary");
  const stopBtn = button("Stop");
  const clearBtn = button("Clear results");
  const exportBtn = button("Export all CSV");
  controls.append(scanBtn, stopBtn, clearBtn, exportBtn);
  const summary = element("div", "summary");
  summary.setAttribute("role", "group");
  summary.setAttribute("aria-label", "Filter results by status");
  const filters = ["OK", "Redirect", "Broken", "Other", "Total"].map((label, i) => {
    const key = ["ok", "redirect", "broken", "other", null][i];
    const el = button("", "stat " + (key || "total"));
    const count = element("span", "count", "0");
    el.append(count, element("span", "", label));
    el.addEventListener("click", () => {
      activeFilter = activeFilter === key ? null : key;
      refresh();
    });
    summary.append(el);
    return { el, count, key, label };
  });
  const progress = element("progress", "progress");
  progress.max = 1;
  progress.value = 0;
  progress.setAttribute("aria-label", "Unique HTTP URLs checked");
  const list = element("ul", "results");
  list.setAttribute("aria-label", "Link results");
  const empty = element("p", "empty", "No results yet.");
  const review = element("aside", "review");
  review.setAttribute("aria-label", "Review CheckLinks");
  const reviewLink = element("a", "", "Leave a review");
  reviewLink.href = REVIEW_URL;
  reviewLink.target = "_blank";
  reviewLink.rel = "noopener noreferrer";
  review.append(element("span", "", "Finding CheckLinks useful? Your review helps this free, independent project."), reviewLink);
  panel.append(header, controls, summary, progress, empty, list, review);
  root.append(panel);

  let previousFocus = document.activeElement;
  let activeScanId = null;
  let activeFilter = null;
  let total = 0;
  let checked = 0;
  let skipped = 0;
  let watchdog;
  let sourcePage = "";
  let scannedAt = "";
  let reportState = "complete";
  const entries = new Map();
  const results = new Map();
  const rows = new Map();
  const overlays = new Map();

  function position(left, top) {
    const rect = host.getBoundingClientRect();
    const x = Math.max(8, Math.min(left, innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(top, innerHeight - rect.height - 8));
    host.style.setProperty("left", x + "px", "important");
    host.style.setProperty("top", y + "px", "important");
  }
  function clamp() {
    const rect = host.getBoundingClientRect();
    position(rect.left, rect.top);
  }
  function hide() {
    host.style.setProperty("display", "none", "important");
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function show() {
    previousFocus = document.activeElement === host ? previousFocus : document.activeElement;
    host.style.setProperty("display", "block", "important");
    clamp();
    panel.focus({ preventScroll: true });
  }
  window.__checkLinksUI = { host, toggle: () => host.style.display === "none" ? show() : hide() };
  closeBtn.addEventListener("click", hide);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      hide();
    }
  });
  let drag;
  moveBtn.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = host.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    moveBtn.setPointerCapture(event.pointerId);
  });
  moveBtn.addEventListener("pointermove", (event) => {
    if (drag) position(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  });
  moveBtn.addEventListener("pointerup", () => { drag = null; });
  moveBtn.addEventListener("pointercancel", () => { drag = null; });
  moveBtn.addEventListener("keydown", (event) => {
    const offset = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
    if (!offset) return;
    event.preventDefault();
    const rect = host.getBoundingClientRect();
    position(rect.left + offset[0], rect.top + offset[1]);
  });
  window.addEventListener("resize", clamp);
  new ResizeObserver(clamp).observe(panel);

  function group(result) {
    if (["client_error", "server_error"].includes(result.category)) return "broken";
    if (["ok", "redirect"].includes(result.category)) return result.category;
    return "other";
  }
  function resultLabel(result) {
    if (result.category === "redirect") return "Redirect → " + (result.status || result.statusText);
    if (result.category === "unverified") return result.statusText + " · " + result.status;
    if (result.category === "skipped") return "Skipped";
    return result.status ? result.status + " " + (result.statusText || "") : result.statusText || "Error";
  }
  function refresh() {
    const counts = { ok: 0, redirect: 0, broken: 0, other: 0 };
    let visible = 0;
    for (const result of results.values()) {
      const category = group(result);
      counts[category]++;
      const row = rows.get(result.url);
      row.hidden = Boolean(activeFilter && activeFilter !== category);
      if (!row.hidden) visible++;
    }
    for (const filter of filters) {
      filter.count.textContent = filter.key ? counts[filter.key] : results.size;
      filter.el.setAttribute("aria-pressed", String(activeFilter === filter.key));
    }
    summary.hidden = !results.size && !activeScanId;
    progress.hidden = !activeScanId;
    progress.max = Math.max(1, total);
    progress.value = Math.min(checked, total);
    scanBtn.disabled = Boolean(activeScanId);
    stopBtn.hidden = !activeScanId;
    clearBtn.disabled = !results.size && !activeScanId;
    exportBtn.disabled = !results.size;
    empty.hidden = Boolean(visible);
    empty.textContent = activeFilter ? "No results in this category." : activeScanId ? "Checking links…" : "No results. Select Scan Page to check the links currently on this page.";
    clamp();
  }
  function addResult(result) {
    if (!entries.has(result.url) || results.has(result.url)) return;
    results.set(result.url, result);
    const entry = entries.get(result.url);
    const row = element("li", "result " + group(result));
    const heading = element("div", "result-heading");
    const url = element("span", "url", result.url);
    url.title = result.url;
    heading.append(url, element("span", "result-status", resultLabel(result)));
    const text = entry.text || "Link without text";
    const caption = element("p", "caption", text + (entry.anchors.length > 1 ? ` · ${entry.anchors.length} occurrences` : ""));
    const actions = element("div", "result-actions");
    const jump = button("Show on page", "text-button");
    jump.addEventListener("click", () => {
      const anchor = entry.anchors.find((item) => item.isConnected);
      if (!anchor) {
        status.textContent = "This link is no longer on the page. Select Scan Page to refresh the report.";
        return;
      }
      const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      anchor.scrollIntoView({ behavior: reduceMotion ? "instant" : "smooth", block: "center" });
      anchor.focus({ preventScroll: true });
    });
    const details = element("details", "details");
    details.append(element("summary", "", "Details"), element("p", "full-url", result.url));
    if (result.redirectedTo) details.append(element("p", "", "Final URL: " + result.redirectedTo));
    if (result.errorDetail) details.append(element("p", "", result.errorDetail));
    if (entry.http) {
      const open = element("a", "", "Open destination in a new tab");
      open.href = result.url;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      details.append(open);
    }
    actions.append(jump, details);
    row.append(heading, caption, actions);
    rows.set(result.url, row);
    // Insert by priority without rebuilding focused buttons or open details.
    const priority = { client_error: 0, server_error: 0, error: 1, timeout: 1, unverified: 1, redirect: 2, ok: 3, skipped: 4 };
    const rank = priority[result.category] ?? 1;
    const before = Array.from(list.children).find((item) => Number(item.dataset.priority) > rank);
    row.dataset.priority = rank;
    list.insertBefore(row, before || null);
    applyOverlay(result, entry);
    refresh();
  }
  function applyOverlay(result, entry) {
    const color = { ok: "#166534", redirect: "#92400e", broken: "#b91c1c", other: "#475569" }[group(result)];
    for (const anchor of entry.anchors) {
      if (!anchor.isConnected) continue;
      const saved = ["outline", "outline-offset"].map((name) => ({ name, value: anchor.style.getPropertyValue(name), priority: anchor.style.getPropertyPriority(name) }));
      anchor.style.setProperty("outline", `2px solid ${color}`);
      anchor.style.setProperty("outline-offset", "2px");
      const applied = saved.map(({ name }) => anchor.style.getPropertyValue(name));
      const label = group(result) === "broken" ? String(result.status) : result.category === "redirect" ? "Redirect" : result.category === "ok" ? "OK" : result.category === "skipped" ? "Skip" : result.statusText || String(result.status);
      const badge = element("span", "checklinks-badge", label);
      badge.setAttribute("aria-hidden", "true");
      const badgeStyle = { all: "initial", background: color, color: "#fff", "font-size": "10px", padding: "1px 4px", "border-radius": "3px", "margin-left": "4px", "font-family": "system-ui,sans-serif", "vertical-align": "middle", display: "inline", "pointer-events": "none", "line-height": "normal" };
      for (const [name, value] of Object.entries(badgeStyle)) badge.style.setProperty(name, value, "important");
      anchor.append(badge);
      overlays.set(anchor, { saved, applied, badge });
    }
  }
  function clearOverlays() {
    for (const [anchor, { saved, applied, badge }] of overlays) {
      saved.forEach(({ name, value, priority }, i) => {
        // Avoid undoing a site's own subsequent style change.
        if (anchor.style.getPropertyValue(name) !== applied[i]) return;
        if (value) anchor.style.setProperty(name, value, priority);
        else anchor.style.removeProperty(name);
      });
      badge.remove();
    }
    overlays.clear();
  }
  function cancelRequest(scanId) {
    if (!scanId) return;
    try { Promise.resolve(chrome.runtime.sendMessage({ type: "STOP_SCAN", scanId })).catch(() => {}); } catch (_) { /* An updated extension has already discarded this scan. */ }
  }
  function finish(text, state = "complete") {
    activeScanId = null;
    clearTimeout(watchdog);
    reportState = state;
    status.textContent = text;
    refresh();
  }
  function armWatchdog(scanId) {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (activeScanId !== scanId) return;
      finish("The scan stopped responding. Your partial results are available. Reload this page, then try again.", "interrupted");
      cancelRequest(scanId);
    }, 30000);
  }
  function stopScan() {
    const scanId = activeScanId;
    finish(`Stopped. ${checked} of ${total} unique HTTP URLs checked · ${skipped} skipped.`, "stopped");
    cancelRequest(scanId);
  }
  function clearAll() {
    const scanId = activeScanId;
    activeScanId = null;
    clearTimeout(watchdog);
    cancelRequest(scanId);
    clearOverlays();
    entries.clear();
    results.clear();
    rows.clear();
    list.replaceChildren();
    activeFilter = null;
    checked = total = skipped = 0;
    status.textContent = "Results and highlights cleared. Select Scan Page to check again.";
    refresh();
  }
  function startScan() {
    clearAll();
    sourcePage = location.href;
    scannedAt = new Date().toISOString();
    reportState = "in progress";
    for (const anchor of document.querySelectorAll("a[href]")) {
      if (anchor.closest("#checklinks-panel")) continue;
      const raw = (anchor.getAttribute("href") || "").trim();
      const url = anchor.href;
      const http = /^https?:/i.test(url) && !raw.startsWith("#");
      const entry = entries.get(url) || { anchors: [], text: anchor.textContent.trim() || anchor.getAttribute("aria-label") || anchor.querySelector("img")?.alt || "", http: false, reason: raw.startsWith("#") ? "In-page fragment targets are not checked." : "Only HTTP and HTTPS destinations are checked." };
      entry.anchors.push(anchor);
      entry.http ||= http;
      entries.set(url, entry);
    }
    const links = Array.from(entries).filter(([, entry]) => entry.http).map(([url]) => url);
    total = links.length;
    skipped = entries.size - total;
    // getRandomValues is also available on ordinary HTTP pages.
    const scanId = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16)).join("-");
    activeScanId = scanId;
    for (const [url, entry] of entries) {
      if (!entry.http) addResult({ url, status: 0, category: "skipped", statusText: "Skipped", errorDetail: entry.reason });
    }
    if (!total) {
      finish(entries.size ? `No HTTP URLs to check · ${skipped} skipped.` : "No links found in this page's main document. Try another page, or rescan after its content loads.");
      return;
    }
    status.textContent = `Checking 0 of ${total} unique HTTP URLs · ${skipped} skipped…`;
    refresh();
    armWatchdog(scanId);
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: "CHECK_LINKS", scanId, payload: { links } })).then((response) => {
        if (activeScanId !== scanId) return;
        if (response?.status !== "started" || response.scanId !== scanId) throw new Error("Scan did not start");
      }).catch(() => {
        if (activeScanId === scanId) finish("Unable to start the scan. The extension may have updated. Reload this page, then try again.", "interrupted");
      });
    } catch (_) {
      finish("The extension has updated or disconnected. Reload this page to scan again.", "interrupted");
    }
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (!activeScanId || message.scanId !== activeScanId) return;
    if (message.type === "LINK_RESULT" && entries.get(message.payload?.url)?.http && !results.has(message.payload.url)) {
      checked++;
      addResult(message.payload);
      status.textContent = `Checking ${checked} of ${total} unique HTTP URLs · ${skipped} skipped…`;
      armWatchdog(activeScanId);
    }
    if (message.type === "SCAN_COMPLETE") {
      finish(`Done. ${checked} of ${total} unique HTTP URLs checked · ${skipped} skipped.`);
    }
  });

  function csvEscape(value) {
    let str = String(value ?? "");
    // Page-controlled text must remain data when opened in a spreadsheet.
    if (/^[\s]*[=+\-@]/.test(str) || /^[\t\r\n]/.test(str)) str = "'" + str;
    return '"' + str.replace(/"/g, '""') + '"';
  }
  function exportCSV() {
    const header = ["Source page", "Scanned at", "Scan state", "URL", "Link text", "Occurrences", "Status", "Category", "Status Text", "Redirected To", "Details"];
    const lines = Array.from(results.values(), (result) => [sourcePage, scannedAt, reportState, result.url, entries.get(result.url)?.text, entries.get(result.url)?.anchors.length, result.status || "", result.category, result.statusText, result.redirectedTo, result.errorDetail].map(csvEscape).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = element("a");
    link.href = url;
    link.download = "checklinks-report.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  scanBtn.addEventListener("click", startScan);
  stopBtn.addEventListener("click", stopScan);
  clearBtn.addEventListener("click", clearAll);
  exportBtn.addEventListener("click", exportCSV);
  window.addEventListener("pagehide", () => {
    if (!activeScanId) return;
    const scanId = activeScanId;
    finish("Page changed. Select Scan Page to check again.", "interrupted");
    cancelRequest(scanId);
  });
  stylesheet.addEventListener("load", () => {
    host.style.setProperty("visibility", "visible", "important");
    position(innerWidth - 436, 16);
    show();
    startScan();
  }, { once: true });
  stylesheet.addEventListener("error", () => {
    // Keep a useful recovery message even when an extension update invalidates
    // the packaged stylesheet between injection and loading.
    panel.replaceChildren(element("p", "", "CheckLinks could not load. Reload this page, then open CheckLinks again."), closeBtn);
    panel.style.cssText = "padding:16px;background:white;color:#1e293b;font:14px/1.5 system-ui;border:1px solid #475569;";
    host.style.setProperty("visibility", "visible", "important");
    position(innerWidth - 436, 16);
    show();
  }, { once: true });
  document.documentElement.append(host);
})();
