(() => {
  // If already injected, toggle the panel
  if (window.__checkLinksInjected) {
    const existing = document.getElementById("checklinks-panel");
    if (existing) {
      existing.style.display = existing.style.display === "none" ? "flex" : "none";
    } else {
      init();
    }
    return;
  }
  window.__checkLinksInjected = true;
  init();

  function init() {
    let allResults = [];
    let scanning = false;
    let totalLinks = 0;
    let activeFilter = null; // null = show all, or a category group name

    // ── Build panel DOM ──────────────────────────────────────────────

    const panel = document.createElement("div");
    panel.id = "checklinks-panel";
    panel.className = "checklinks-panel";

    // Header (drag handle)
    const header = document.createElement("div");
    header.className = "checklinks-header";

    const titleRow = document.createElement("div");
    titleRow.className = "checklinks-title-row";

    const title = document.createElement("span");
    title.className = "checklinks-title";
    title.textContent = "CheckLinks";

    const statusEl = document.createElement("span");
    statusEl.className = "checklinks-status";
    statusEl.textContent = "Ready";

    const closeBtn = document.createElement("button");
    closeBtn.className = "checklinks-close";
    closeBtn.textContent = "\u2715";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", () => { panel.style.display = "none"; });

    titleRow.appendChild(title);
    titleRow.appendChild(closeBtn);
    header.appendChild(titleRow);
    header.appendChild(statusEl);

    // Controls
    const controls = document.createElement("div");
    controls.className = "checklinks-controls";

    const scanBtn = document.createElement("button");
    scanBtn.className = "checklinks-btn checklinks-btn-primary";
    scanBtn.textContent = "Scan Page";

    const clearBtn = document.createElement("button");
    clearBtn.className = "checklinks-btn";
    clearBtn.textContent = "Clear";
    clearBtn.disabled = true;

    const exportBtn = document.createElement("button");
    exportBtn.className = "checklinks-btn";
    exportBtn.textContent = "Export CSV";
    exportBtn.disabled = true;

    controls.appendChild(scanBtn);
    controls.appendChild(clearBtn);
    controls.appendChild(exportBtn);

    // Summary
    const summary = document.createElement("div");
    summary.className = "checklinks-summary";
    summary.style.display = "none";

    function makeStat(cls, label, filterKey) {
      const div = document.createElement("div");
      div.className = "checklinks-stat checklinks-stat-" + cls;
      div.style.cursor = "pointer";
      const num = document.createElement("span");
      num.textContent = "0";
      div.appendChild(num);
      div.appendChild(document.createTextNode(" " + label));
      div.addEventListener("click", () => {
        if (activeFilter === filterKey) {
          activeFilter = null;
        } else {
          activeFilter = filterKey;
        }
        updateFilterHighlight();
        renderResults(allResults);
      });
      return { el: div, num, filterKey };
    }

    const statOk = makeStat("ok", "OK", "ok");
    const statRedirect = makeStat("redirect", "Redirect", "redirect");
    const statBroken = makeStat("broken", "Broken", "broken");
    const statOther = makeStat("other", "Other", "other");
    const statTotal = makeStat("total", "Total", null);
    const allStats = [statOk, statRedirect, statBroken, statOther, statTotal];
    summary.appendChild(statOk.el);
    summary.appendChild(statRedirect.el);
    summary.appendChild(statBroken.el);
    summary.appendChild(statOther.el);
    summary.appendChild(statTotal.el);

    function updateFilterHighlight() {
      for (const s of allStats) {
        s.el.classList.toggle("checklinks-stat-active", activeFilter !== null && s.filterKey === activeFilter);
      }
    }

    // Progress bar
    const progressBar = document.createElement("div");
    progressBar.className = "checklinks-progress-bar";
    progressBar.style.display = "none";
    const progressFill = document.createElement("div");
    progressFill.className = "checklinks-progress-fill";
    progressBar.appendChild(progressFill);

    // Results list
    const resultsList = document.createElement("ul");
    resultsList.className = "checklinks-results";

    // Assemble panel
    panel.appendChild(header);
    panel.appendChild(controls);
    panel.appendChild(summary);
    panel.appendChild(progressBar);
    panel.appendChild(resultsList);
    document.body.appendChild(panel);

    // ── Drag logic ───────────────────────────────────────────────────

    makeDraggable(panel, header);

    function makeDraggable(el, handle) {
      let isDragging = false;
      let startX, startY, origLeft, origTop;

      handle.style.cursor = "grab";

      handle.addEventListener("mousedown", (e) => {
        // Don't drag if clicking a button
        if (e.target.tagName === "BUTTON") return;
        isDragging = true;
        handle.style.cursor = "grabbing";
        startX = e.clientX;
        startY = e.clientY;
        const rect = el.getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;
        e.preventDefault();
      });

      document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        el.style.left = (origLeft + dx) + "px";
        el.style.top = (origTop + dy) + "px";
        // Clear any right/bottom anchoring once user drags
        el.style.right = "auto";
        el.style.bottom = "auto";
      });

      document.addEventListener("mouseup", () => {
        if (isDragging) {
          isDragging = false;
          handle.style.cursor = "grab";
        }
      });
    }

    // ── Message listener ─────────────────────────────────────────────

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "LINK_RESULT") {
        applyOverlay(message.payload);
        // Update panel results incrementally
        allResults.push(message.payload);
        renderResults(allResults);
        updateSummary(allResults);
        updateProgress(allResults.length, totalLinks);
      }
      if (message.type === "SCAN_COMPLETE") {
        scanning = false;
        scanBtn.disabled = false;
        clearBtn.disabled = false;
        exportBtn.disabled = false;
        statusEl.textContent = `Done. ${allResults.length} links checked.`;
        progressFill.style.width = "100%";
      }
      if (message.type === "CLEAR_OVERLAYS") {
        clearAll();
        sendResponse({ status: "cleared" });
      }
    });

    // ── Event handlers ───────────────────────────────────────────────

    scanBtn.addEventListener("click", startScan);
    clearBtn.addEventListener("click", clearAll);
    exportBtn.addEventListener("click", exportCSV);

    // Auto-start scan on first injection
    startScan();

    function startScan() {
      scanBtn.disabled = true;
      clearBtn.disabled = true;
      exportBtn.disabled = true;
      allResults = [];
      activeFilter = null;
      updateFilterHighlight();
      resultsList.innerHTML = "";
      clearOverlays();

      const allAnchors = document.querySelectorAll("a[href]");
      const urls = [];

      allAnchors.forEach((anchor) => {
        const href = anchor.href;
        const rawHref = anchor.getAttribute("href");

        if (!anchor.dataset.checklinkUrl) {
          anchor.dataset.checklinkUrl = href;
        }

        // Skip pure fragment-only links
        if (rawHref && rawHref.startsWith("#")) {
          const result = { url: href, status: 0, statusText: "Anchor", category: "skipped" };
          applyOverlay(result);
          allResults.push(result);
          return;
        }

        urls.push(href);
      });

      totalLinks = urls.length;
      scanning = true;
      statusEl.textContent = `Checking ${urls.length} links...`;
      summary.style.display = "flex";
      progressBar.style.display = "block";
      progressFill.style.width = "0%";
      renderResults(allResults);
      updateSummary(allResults);

      chrome.runtime.sendMessage({
        type: "CHECK_LINKS",
        payload: { links: urls }
      });
    }

    // ── Overlay logic ────────────────────────────────────────────────

    function applyOverlay(result) {
      const colorMap = {
        ok:           { border: "#22c55e", label: "OK" },
        redirect:     { border: "#f59e0b", label: "3xx" },
        client_error: { border: "#ef4444", label: String(result.status || "4xx") },
        server_error: { border: "#ef4444", label: String(result.status || "5xx") },
        timeout:      { border: "#6b7280", label: "Timeout" },
        error:        { border: "#6b7280", label: result.statusText || "Error" },
        skipped:      { border: "#d1d5db", label: "Skip" }
      };

      const style = colorMap[result.category] || colorMap.error;

      document.querySelectorAll("a[href]").forEach((anchor) => {
        if (anchor.href === result.url) {
          anchor.style.outline = `2px solid ${style.border}`;
          anchor.style.outlineOffset = "2px";
          anchor.classList.add("checklinks-checked");

          if (!anchor.querySelector(".checklinks-badge")) {
            const badge = document.createElement("span");
            badge.className = "checklinks-badge";
            badge.textContent = style.label;
            badge.style.cssText = [
              `background:${style.border}`,
              "color:#fff",
              "font-size:10px",
              "padding:1px 4px",
              "border-radius:3px",
              "margin-left:4px",
              "font-family:monospace",
              "vertical-align:middle",
              "display:inline",
              "pointer-events:none",
              "line-height:normal"
            ].join(";");
            anchor.appendChild(badge);
          }
        }
      });
    }

    function clearOverlays() {
      document.querySelectorAll(".checklinks-checked").forEach((el) => {
        el.style.outline = "";
        el.style.outlineOffset = "";
        el.classList.remove("checklinks-checked");
      });
      document.querySelectorAll(".checklinks-badge").forEach((el) => el.remove());
    }

    function clearAll() {
      clearOverlays();
      allResults = [];
      activeFilter = null;
      updateFilterHighlight();
      resultsList.innerHTML = "";
      summary.style.display = "none";
      progressBar.style.display = "none";
      clearBtn.disabled = true;
      exportBtn.disabled = true;
      statusEl.textContent = "Cleared. Click Scan to re-check.";
    }

    // ── Scroll-to-link + highlight ──────────────────────────────────

    function scrollToLink(url) {
      // Remove any previous pulse
      document.querySelectorAll(".checklinks-pulse").forEach((el) => {
        el.classList.remove("checklinks-pulse");
      });

      // Find the first matching anchor on the page
      const anchors = document.querySelectorAll("a[href]");
      for (const anchor of anchors) {
        if (anchor.href === url) {
          anchor.scrollIntoView({ behavior: "smooth", block: "start" });
          anchor.classList.add("checklinks-pulse");
          // Remove the pulse class after the animation completes
          setTimeout(() => anchor.classList.remove("checklinks-pulse"), 2000);
          return;
        }
      }
    }

    // ── Filter helpers ───────────────────────────────────────────────

    const filterCategories = {
      ok: ["ok"],
      redirect: ["redirect"],
      broken: ["client_error", "server_error"],
      other: ["error", "timeout", "skipped"]
    };

    function matchesFilter(r) {
      if (!activeFilter) return true;
      const cats = filterCategories[activeFilter];
      return cats && cats.includes(r.category);
    }

    // ── Panel rendering ──────────────────────────────────────────────

    function renderResults(results) {
      const order = {
        client_error: 0, server_error: 1, error: 2,
        timeout: 3, redirect: 4, ok: 5, skipped: 6
      };

      const filtered = results.filter(matchesFilter);

      const sorted = [...filtered].sort(
        (a, b) => (order[a.category] ?? 7) - (order[b.category] ?? 7)
      );

      resultsList.innerHTML = "";

      for (const r of sorted) {
        const li = document.createElement("li");
        li.style.cursor = "pointer";

        let tooltip = r.url;
        if (r.redirectedTo) tooltip += "\n\u2192 " + r.redirectedTo;
        if (r.errorDetail) tooltip += "\n\u26A0 " + r.errorDetail;
        tooltip += "\nClick to scroll to this link on the page";
        li.title = tooltip;

        // Click to scroll to the link on the page
        li.addEventListener("click", () => scrollToLink(r.url));

        const dot = document.createElement("span");
        dot.className = "checklinks-dot checklinks-dot-" + r.category;

        const textCol = document.createElement("span");
        textCol.className = "checklinks-result-text";

        const url = document.createElement("span");
        url.className = "checklinks-result-url";
        url.textContent = r.url;
        textCol.appendChild(url);

        if (r.errorDetail) {
          const detail = document.createElement("span");
          detail.className = "checklinks-result-detail";
          detail.textContent = r.errorDetail;
          textCol.appendChild(detail);
        }

        const status = document.createElement("span");
        status.className = "checklinks-result-status";
        status.textContent = formatStatus(r);

        li.appendChild(dot);
        li.appendChild(textCol);
        li.appendChild(status);
        resultsList.appendChild(li);
      }
    }

    function formatStatus(r) {
      if (r.category === "skipped") return "Skip";
      if (r.category === "timeout") return "Timeout";
      if (r.category === "error") return r.statusText || "Error";
      if (r.status) return String(r.status);
      return r.statusText || "?";
    }

    function updateSummary(results) {
      let ok = 0, redirect = 0, broken = 0, other = 0;
      for (const r of results) {
        switch (r.category) {
          case "ok": ok++; break;
          case "redirect": redirect++; break;
          case "client_error":
          case "server_error": broken++; break;
          default: other++; break;
        }
      }
      statOk.num.textContent = ok;
      statRedirect.num.textContent = redirect;
      statBroken.num.textContent = broken;
      statOther.num.textContent = other;
      statTotal.num.textContent = results.length;
    }

    function updateProgress(checked, total) {
      if (total === 0) return;
      const pct = Math.round((checked / total) * 100);
      progressFill.style.width = pct + "%";
    }

    function exportCSV() {
      if (allResults.length === 0) return;

      const header = "URL,Status,Category,Status Text,Redirected To";
      const rows = allResults.map((r) =>
        [
          csvEscape(r.url),
          r.status || "",
          r.category,
          csvEscape(r.statusText || ""),
          csvEscape(r.redirectedTo || "")
        ].join(",")
      );

      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const csvUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = csvUrl;
      a.download = "checklinks-report.csv";
      a.click();
      URL.revokeObjectURL(csvUrl);
    }

    function csvEscape(str) {
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }
  }
})();
