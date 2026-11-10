import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAudit } from "./audit.js";
import { scrub } from "./clocked.js";
import { bandEdges } from "./policy.js";
import { TEXT_LIMIT } from "./pipeline.js";
import { listSamples, resolveMode, screen } from "./screen.js";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SRC, "..");
const PUBLIC_DIR = path.join(SRC, "public");

const FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/app.js": "app.js",
  "/favicon.svg": "favicon.svg",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

function readBody(req, limit = 1_500_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (req.destroyed) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Send a JSON object."), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(options = {}) {
  const env = options.env || process.env;
  const mode = options.mode || resolveMode(env);
  const audit =
    options.audit || createAudit(options.auditPath === undefined ? path.join(ROOT, "data", "audit.jsonl") : options.auditPath);

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathName = url.pathname;
    try {
      if (req.method === "GET" && pathName === "/api/health") {
        send(res, 200, {
          product: "Gatekeeper",
          challenge: "Clocked Build Challenge 2026",
          mode,
          liveConfigured: Boolean(env.CLOCKED_API_KEY),
          textLimit: TEXT_LIMIT,
          band: bandEdges(),
          endpoints: [
            { name: "Protect", path: "/pii", via: "/pipeline" },
            { name: "Guard", path: "/injection", via: "/pipeline" },
            { name: "Inspect", path: "/script", via: "/pipeline" },
          ],
        });
      } else if (req.method === "GET" && pathName === "/api/samples") {
        send(res, 200, { samples: listSamples() });
      } else if (req.method === "GET" && pathName === "/api/audit") {
        send(res, 200, { entries: audit.list() });
      } else if (req.method === "DELETE" && pathName === "/api/audit") {
        audit.clear();
        send(res, 200, { entries: [] });
      } else if (req.method === "POST" && pathName === "/api/screen") {
        const body = await readBody(req);
        const result = await screen(
          { text: body.text, kind: body.kind, drill: body.drill },
          {
            env,
            mode,
            fetchImpl: options.fetchImpl,
            sleep: options.sleep,
            timeoutMs: options.timeoutMs,
            maxAttempts: options.maxAttempts,
            fixtureDir: options.fixtureDir,
          },
        );
        audit.add(result);
        send(res, 200, result);
      } else if (req.method === "GET" && FILES[pathName]) {
        const fileName = FILES[pathName];
        const filePath = path.join(PUBLIC_DIR, fileName);
        const ext = path.extname(fileName);
        const contents = fs.readFileSync(filePath);
        res.writeHead(200, {
          "content-type": TYPES[ext] || "application/octet-stream",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(contents);
      } else {
        send(res, 404, { error: "Not found." });
      }
      console.log(`${req.method} ${pathName} ${res.statusCode} ${Date.now() - started}ms`);
    } catch (error) {
      const status = error.statusCode || 500;
      const message = scrub(error.message || "Gatekeeper failed.", env.CLOCKED_API_KEY);
      if (status >= 500) console.error(scrub(error.stack || message, env.CLOCKED_API_KEY));
      if (!res.headersSent) send(res, status, { error: message });
      console.log(`${req.method} ${pathName} ${status} ${Date.now() - started}ms`);
    }
  });
}

export function startServer(options = {}) {
  const port = Number(options.port || process.env.PORT || 8787);
  const host = options.host || "127.0.0.1";
  const server = createServer(options);
  server.listen(port, host, () => {
    const mode = options.mode || resolveMode(options.env || process.env);
    console.log(`Gatekeeper listening on http://${host}:${port} (${mode})`);
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) startServer();
