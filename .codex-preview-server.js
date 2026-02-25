const http = require("http");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const port = 5500;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

const server = http.createServer((req, res) => {
  const rawPath = decodeURIComponent((req.url || "/").split("?")[0]);

  if (rawPath === "/favicon.ico") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const normalizedPath = rawPath === "/" ? "/index.html" : rawPath;
  const rootResolved = path.resolve(root);
  const filePath = path.resolve(rootResolved, `.${normalizedPath}`);

  if (!filePath.startsWith(rootResolved)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
    res.end(data);
  });
});

server.listen(port, "127.0.0.1");
