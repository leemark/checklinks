const http = require("http");
const fs = require("fs");
const path = require("path");

const port = 4173;
const demoPath = path.join(process.cwd(), "store-assets", "capture", "demo.html");
const shotsPath = path.join(process.cwd(), "store-assets", "capture", "shots.html");
const promoPath = path.join(process.cwd(), "store-assets", "capture", "promo.html");
const contentCssPath = path.join(process.cwd(), "extension", "content.css");
const contentJsPath = path.join(process.cwd(), "extension", "content.js");

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  if (res.req.method !== "HEAD") res.end(body);
  else res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/") {
    send(res, 200, fs.readFileSync(demoPath, "utf8"));
    return;
  }

  if (url.pathname === "/shots.html") {
    send(res, 200, fs.readFileSync(shotsPath, "utf8"));
    return;
  }

  if (url.pathname === "/promo.html") {
    send(res, 200, fs.readFileSync(promoPath, "utf8"));
    return;
  }

  if (url.pathname === "/content.css") {
    res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(contentCssPath, "utf8"));
    return;
  }

  if (url.pathname === "/content.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(contentJsPath, "utf8"));
    return;
  }

  if (url.pathname === "/icon128.png") {
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(path.join(process.cwd(), "docs", "icon128.png")));
    return;
  }

  if (["/ok-home", "/ok-pricing", "/ok-contact", "/docs"].includes(url.pathname)) {
    send(res, 200, "<!doctype html><title>Available</title><p>This resource is available.</p>");
    return;
  }

  if (url.pathname === "/old-docs") {
    res.writeHead(302, { Location: "/docs", "Cache-Control": "no-store" });
    res.end();
    return;
  }

  if (["/missing-guide", "/missing-image"].includes(url.pathname)) {
    send(res, 404, "<!doctype html><title>Not found</title><p>This fixture intentionally returns 404.</p>");
    return;
  }

  if (url.pathname === "/server-error") {
    send(res, 500, "<!doctype html><title>Server error</title><p>This fixture intentionally returns 500.</p>");
    return;
  }

  if (url.pathname === "/slow") {
    setTimeout(() => {
      if (!res.headersSent) send(res, 200, "<!doctype html><title>Slow response</title>");
    }, 11000);
    return;
  }

  send(res, 404, "<!doctype html><title>Not found</title>");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CheckLinks capture fixture: http://127.0.0.1:${port}/`);
});
