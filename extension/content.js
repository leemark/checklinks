(() => {
  // Guard against double-injection
  if (window.__checkLinksInjected) {
    // Re-scan: clear previous overlays and re-scrape
    clearOverlays();
    scrapeAndSend();
    return;
  }
  window.__checkLinksInjected = true;

  // Listen for messages from background/popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "LINK_RESULT") {
      applyOverlay(message.payload);
    }
    if (message.type === "SCAN_COMPLETE") {
      showBanner("Scan complete", false);
    }
    if (message.type === "CLEAR_OVERLAYS") {
      clearOverlays();
      sendResponse({ status: "cleared" });
    }
  });

  scrapeAndSend();

  function scrapeAndSend() {
    const allAnchors = document.querySelectorAll("a[href]");
    const urls = [];

    allAnchors.forEach((anchor) => {
      const href = anchor.href; // Resolved to absolute URL by the browser
      const rawHref = anchor.getAttribute("href");

      // Tag element for matching results later
      if (!anchor.dataset.checklinkUrl) {
        anchor.dataset.checklinkUrl = href;
      }

      // Skip pure fragment-only links (same-page anchors)
      if (rawHref && rawHref.startsWith("#")) {
        applyOverlay({
          url: href,
          status: 0,
          statusText: "Anchor",
          category: "skipped"
        });
        return;
      }

      urls.push(href);
    });

    showBanner(`Checking ${urls.length} links...`, true);

    chrome.runtime.sendMessage({
      type: "CHECK_LINKS",
      payload: { links: urls }
    });
  }

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

        // Add badge if not already present
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
    removeBanner();
  }

  function showBanner(text, showSpinner) {
    removeBanner();
    const banner = document.createElement("div");
    banner.id = "checklinks-banner";
    banner.className = "checklinks-banner";

    const msg = document.createElement("span");
    if (showSpinner) {
      msg.textContent = "\u23F3 " + text;
    } else {
      msg.textContent = "\u2705 " + text;
    }

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Dismiss";
    closeBtn.addEventListener("click", () => banner.remove());

    banner.appendChild(msg);
    banner.appendChild(closeBtn);
    document.body.prepend(banner);
  }

  function removeBanner() {
    const existing = document.getElementById("checklinks-banner");
    if (existing) existing.remove();
  }
})();
