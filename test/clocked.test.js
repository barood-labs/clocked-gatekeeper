import assert from "node:assert/strict";
import test from "node:test";
import { clockedPost, scrub } from "../src/clocked.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = "test-key-do-not-leak";

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test("retries reuse one idempotency key and never log the bearer token", async () => {
  const keys = [];
  const log = [];
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    keys.push(init.headers["Idempotency-Key"]);
    assert.equal(init.headers.Authorization, `Bearer ${SECRET}`);
    assert.equal(url, "https://clocked.rezolve.ai/clocked/pipeline");
    if (calls === 1) return response(500, { error: `upstream ${SECRET}` });
    return response(200, { ok: true }, { "x-clocked-credits": "4", "x-clocked-model-ms": "80" });
  };
  const result = await clockedPost({
    path: "/pipeline",
    body: { text: "hi", steps: [] },
    apiKey: SECRET,
    fetchImpl,
    sleep: async () => {},
    log: (entry) => log.push(entry),
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(keys[0], keys[1]);
  assert.match(keys[0], UUID_V4);
  assert.equal(result.usage.credits, "4");
  assert.equal(JSON.stringify(log).includes(SECRET), false);
  assert.equal(scrub(`upstream ${SECRET} failed`, SECRET).includes(SECRET), false);
});

test("terminal statuses and retryAsNew stop the loop", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(401, { error: "Unauthorized" });
  };
  const denied = await clockedPost({ path: "/pii", body: {}, apiKey: SECRET, fetchImpl, sleep: async () => {} });
  assert.equal(denied.ok, false);
  assert.equal(denied.attempts, 1);
  assert.equal(calls, 1);

  calls = 0;
  const ended = await clockedPost({
    path: "/pii",
    body: {},
    apiKey: SECRET,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return response(503, { error: "attempt ended", retryAsNew: true });
    },
  });
  assert.equal(ended.attempts, 1);
  assert.equal(ended.retryAsNew, true);
  assert.equal(calls, 1);
});

test("timeouts retry with the same key until the budget is spent", async () => {
  const keys = [];
  const result = await clockedPost({
    path: "/injection",
    body: { text: "hi" },
    apiKey: SECRET,
    maxAttempts: 3,
    sleep: async () => {},
    fetchImpl: async (_url, init) => {
      keys.push(init.headers["Idempotency-Key"]);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.equal(result.message, "The Clocked request timed out.");
  assert.equal(keys[0], keys[1]);
  assert.equal(keys[1], keys[2]);
});

test("a 400 is not retried", async () => {
  let calls = 0;
  const result = await clockedPost({
    path: "/script",
    body: {},
    apiKey: SECRET,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return response(422, { detail: [{ msg: "Field required", loc: ["body", "script"] }] });
    },
  });
  assert.equal(calls, 1);
  assert.match(result.message, /Field required/);
});
