const http = require("http");
const fs = require("fs");
const path = require("path");

const port = 4173;
const demoPath = path.join(process.cwd(), "store-assets", "capture", "demo.html");
const shotsPath = path.join(process.cwd(), "store-assets", "capture", "shots.html");
const promoPath = path.join(process.cwd(), "store-assets", "capture", "promo.html");
const socialPath = path.join(process.cwd(), "store-assets", "capture", "social.html");
const siteRoot = path.join(process.cwd(), "docs");
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

  if (url.pathname === "/social.html") {
    send(res, 200, fs.readFileSync(socialPath, "utf8"));
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

  if (url.pathname === "/checklinks-results.jpg") {
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(path.join(process.cwd(), "docs", "images", "checklinks-results.jpg")));
    return;
  }

  if (url.pathname.startsWith("/site/")) {
    const relativePath = decodeURIComponent(url.pathname.slice("/site/".length)) || "index.html";
    const resolvedPath = path.resolve(siteRoot, relativePath);
    if (!resolvedPath.startsWith(path.resolve(siteRoot) + path.sep) || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      send(res, 404, "<!doctype html><title>Not found</title>");
      return;
    }

    const contentTypes = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".txt": "text/plain; charset=utf-8",
      ".xml": "application/xml; charset=utf-8"
    };
    const contentType = contentTypes[path.extname(resolvedPath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    res.end(fs.readFileSync(resolvedPath));
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
