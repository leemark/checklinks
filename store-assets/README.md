# CheckLinks Chrome Web Store presentation

Prepared for the 1.0.4 listing refresh.

## Product details

**Title**

CheckLinks – Broken Link Checker

**Summary (99 characters)**

Find broken links and redirects on any webpage, highlight them in place, and export results to CSV.

**Category**

Developer Tools

**Homepage**

https://leemark.github.io/checklinks/

**Support**

https://github.com/leemark/checklinks/issues

**Privacy policy**

https://leemark.github.io/checklinks/privacy.html

## Detailed description

Find broken links, redirects, and network errors on the page you are viewing. CheckLinks highlights each result directly on the page and collects everything in a filterable panel, so you can spot problems in context and export a clear follow-up report.

Built for web editors, QA testers, SEO reviewers, website owners, and developers who need a quick page-level link check without creating an account or sending scan results to a separate service.

FEATURES

• In-page results — See color-coded outlines and status badges beside each link.
• Clear status groups — Distinguish working links, redirects, 4xx/5xx responses, timeouts, and network errors.
• Filterable results panel — Focus on the result types that need attention.
• Scroll to link — Select a result to jump to the matching link on the page.
• CSV export — Download the scan results for QA notes, content cleanup, SEO review, or issue tracking.
• Detailed errors — Identify DNS failures, refused connections, SSL errors, timeouts, and other network problems.
• Lightweight — Plain JavaScript with no external dependencies.

HOW TO USE

1. Open the webpage you want to check.
2. Select the CheckLinks toolbar icon to start the scan.
3. Review, filter, and export the results from the floating panel.

SCOPE

CheckLinks checks links on the single page currently open in your active tab. It does not crawl an entire website.

PRIVACY AND PERMISSIONS

CheckLinks has no accounts, analytics, or tracking. It does not collect, store, or send scan results to the developer or an analytics service. Link-check requests go directly from your browser to the linked websites.

The extension uses activeTab and scripting only after you select its toolbar icon, so it can read links and display results on the current page. It uses host access to check destinations across domains. Scan results remain in memory for the current page and are not persisted. A small optional Chrome Web Store review link sits at the bottom of the panel and is not tracked by the extension.

## Screenshot order

1. Find broken links right on the page.
2. Click once and watch results appear.
3. Filter results and jump to the exact link.
4. Distinguish timeouts and network errors.
5. Export a clean CSV report.

The capture fixture in `capture/` provides deterministic 200, redirect, 404, 500, timeout, and skipped-link states. It is development-only and is not included in the extension package.
