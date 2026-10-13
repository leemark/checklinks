# CheckLinks checks

Run the dependency-free background regression suite with Node.js:

```sh
node --test tests/background.test.cjs
```

It covers scan/document identity, cancellation and fetch aborts, missing receivers,
completion cleanup, HTTP classifications, HEAD fallback, timeout handling, and
toolbar feedback. It does not replace browser interaction checks.

For a local browser smoke test, start `node store-assets/capture/server.js`, load
`extension/` unpacked in Chrome, and open `http://127.0.0.1:4173/`. The demonstration
page intentionally includes working URLs, a redirect, broken responses, a timeout,
and a skipped email link. Verify filters and details with the keyboard; check
Show on page, Export all CSV, Stop, and Clear results. Resize to a narrow or short
window and confirm the panel and controls remain reachable.

After editing background.js, use **Reload** on the extension's Chrome management
page or a fresh test profile. A browser restart can retain its cached service worker.
