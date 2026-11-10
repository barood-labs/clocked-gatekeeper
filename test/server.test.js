import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SAMPLES } from "../src/samples.js";
import { createServer } from "../src/server.js";

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gk-"));
  const auditPath = path.join(dir, "audit.jsonl");
  const server = createServer({
    mode: "fixture",
    env: { CLOCKED_API_KEY: "test-key-do-not-leak", CLOCKED_MODE: "fixture" },
    auditPath,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base, auditPath);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("health, screen, and audit hide the key and the raw values", async () => {
  await withServer(async (base, auditPath) => {
    const health = await fetch(`${base}/api/health`).then((res) => res.json());
    assert.equal(health.mode, "fixture");
    assert.equal(health.liveConfigured, true);
    assert.equal(JSON.stringify(health).includes("test-key-do-not-leak"), false);
    assert.equal(health.endpoints.map((item) => item.path).join(","), "/pii,/injection,/script");

    const sample = SAMPLES.find((item) => item.id === "pii-email");
    const screened = await fetch(`${base}/api/screen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: sample.text, kind: sample.kind }),
    });
    const body = await screened.json();
    assert.equal(screened.status, 200);
    assert.equal(body.decision, "pass");
    assert.equal(body.raw, undefined);
    assert.equal(JSON.stringify(body).includes("test-key-do-not-leak"), false);

    const audit = await fetch(`${base}/api/audit`).then((res) => res.json());
    const serialized = JSON.stringify(audit);
    assert.equal(serialized.includes("jordan.hale@example.com"), false);
    assert.equal(serialized.includes("219-09-9999"), false);
    assert.equal(audit.entries.length, 1);
    assert.equal(fs.readFileSync(auditPath, "utf8").includes("jordan.hale@example.com"), false);

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Gatekeeper/);
  });
});

test("empty text is a client error", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/screen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "   ", kind: "email" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Paste/);
  });
});
