document.addEventListener("DOMContentLoaded", () => {
  const scanBtn = document.getElementById("scanBtn");
  const clearBtn = document.getElementById("clearBtn");
  const exportBtn = document.getElementById("exportBtn");
  const statusEl = document.getElementById("status");
  const summaryEl = document.getElementById("summary");
  const progressBar = document.getElementById("progressBar");
  const progressFill = document.getElementById("progressFill");
  const resultsList = document.getElementById("resultsList");

  let currentTabId = null;
  let pollInterval = null;
  let allResults = [];

  // Get active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    currentTabId = tabs[0].id;
    // Check for existing results
    fetchResults();
  });

  scanBtn.addEventListener("click", startScan);
  clearBtn.addEventListener("click", clearResults);
  exportBtn.addEventListener("click", exportCSV);

  async function startScan() {
    scanBtn.disabled = true;
    statusEl.textContent = "Injecting scanner...";
    allResults = [];
    renderResults([]);

    try {
      // Inject content script and CSS
      await chrome.scripting.insertCSS({
        target: { tabId: currentTabId },
        files: ["content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ["content.js"]
      });
    } catch (err) {
      statusEl.textContent = "Cannot scan this page.";
      scanBtn.disabled = false;
      return;
    }

    statusEl.textContent = "Scanning...";
    progressBar.style.display = "block";
    summaryEl.style.display = "flex";
    progressFill.style.width = "0%";

    // Poll for results
    pollInterval = setInterval(fetchResults, 500);
  }

  function fetchResults() {
    if (currentTabId === null) return;

    chrome.runtime.sendMessage(
      { type: "GET_RESULTS", tabId: currentTabId },
      (response) => {
        if (chrome.runtime.lastError || !response) return;

        allResults = response.results;

        if (allResults.length > 0) {
          summaryEl.style.display = "flex";
          progressBar.style.display = "block";
        }

        renderResults(allResults);
        updateSummary(allResults);
        updateProgress(allResults.length, response.total);

        if (!response.scanning && response.total > 0) {
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          scanBtn.disabled = false;
          clearBtn.disabled = false;
          exportBtn.disabled = false;
          statusEl.textContent = `Done. ${allResults.length} links checked.`;
          progressFill.style.width = "100%";
        } else if (response.scanning) {
          statusEl.textContent = `Checking... ${allResults.length} / ${response.total}`;
        }
      }
    );
  }

  function renderResults(results) {
    // Sort: broken first, then redirects, then errors, then ok, then skipped
    const order = {
      client_error: 0,
      server_error: 1,
      error: 2,
      timeout: 3,
      redirect: 4,
      ok: 5,
      skipped: 6
    };

    const sorted = [...results].sort(
      (a, b) => (order[a.category] ?? 7) - (order[b.category] ?? 7)
    );

    resultsList.innerHTML = "";

    if (sorted.length === 0) {
      return;
    }

    for (const r of sorted) {
      const li = document.createElement("li");

      // Build tooltip with all available detail
      let tooltip = r.url;
      if (r.redirectedTo) tooltip += "\n→ " + r.redirectedTo;
      if (r.errorDetail) tooltip += "\n⚠ " + r.errorDetail;
      li.title = tooltip;

      const dot = document.createElement("span");
      dot.className = "dot dot-" + r.category;

      const textCol = document.createElement("span");
      textCol.className = "result-text-col";

      const url = document.createElement("span");
      url.className = "result-url";
      url.textContent = r.url;
      textCol.appendChild(url);

      // Show error detail as a second line for errors/timeouts
      if (r.errorDetail) {
        const detail = document.createElement("span");
        detail.className = "result-detail";
        detail.textContent = r.errorDetail;
        textCol.appendChild(detail);
      }

      const status = document.createElement("span");
      status.className = "result-status";
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

    document.getElementById("countOk").textContent = ok;
    document.getElementById("countRedirect").textContent = redirect;
    document.getElementById("countBroken").textContent = broken;
    document.getElementById("countOther").textContent = other;
    document.getElementById("countTotal").textContent = results.length;
  }

  function updateProgress(checked, total) {
    if (total === 0) return;
    const pct = Math.round((checked / total) * 100);
    progressFill.style.width = pct + "%";
  }

  function clearResults() {
    // Send clear message to content script
    chrome.tabs.sendMessage(currentTabId, { type: "CLEAR_OVERLAYS" });

    // Clear local state
    allResults = [];
    resultsList.innerHTML = "";
    summaryEl.style.display = "none";
    progressBar.style.display = "none";
    clearBtn.disabled = true;
    exportBtn.disabled = true;
    statusEl.textContent = "Overlays cleared. Click Scan to re-check.";
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
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "checklinks-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function csvEscape(str) {
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }
});
