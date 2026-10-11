// Minimal static file server for the repo (the render page and the app data are served from it).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

export function serve(root, port) {
  return http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }).end(fs.readFileSync(p));
  }).listen(port);
}
