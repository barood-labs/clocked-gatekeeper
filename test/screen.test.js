import assert from "node:assert/strict";
import test from "node:test";
import { buildPipelineRequest } from "../src/pipeline.js";
import { SAMPLES } from "../src/samples.js";
import { auditShape, screen } from "../src/screen.js";

const fixture = { mode: "fixture", env: { CLOCKED_API_KEY: "test-key-do-not-leak" } };

function sample(id) {
  return SAMPLES.find((item) => item.id === id);
}

test("pipeline steps name protect, guard, and inspect without stop", () => {
  const email = buildPipelineRequest({ text: "hi", kind: "email" });
  assert.deepEqual(
    email.steps.map((step) => Object.keys(step).find((key) => ["pii", "injection", "script"].includes(key))),
    ["pii", "injection"],
  );
  assert.equal(email.steps[0].pii.anonymize, "mask");
  assert.equal(email.steps[1].injection.source, "content");
  assert.equal(email.on_error, "continue");
  assert.equal(email.steps.some((step) => step.stop), false);

  const message = buildPipelineRequest({ text: "hi", kind: "message" });
  assert.equal(message.steps[1].injection.source, "user");

  const script = buildPipelineRequest({ text: "ls", kind: "script" });
  assert.equal(script.steps.length, 3);
  assert.equal(script.steps[2].script.evidence, true);
  assert.equal(script.steps[2].name, "inspect");
});

test("built-in samples take the three decisions in fixture mode", async () => {
  const benign = await screen({ text: sample("benign-email").text, kind: "email" }, fixture);
  assert.equal(benign.decision, "pass");
  assert.equal(benign.forwardLabel, "original");
  assert.equal(benign.checks.inspect.status, "skipped");

  const pii = await screen({ text: sample("pii-email").text, kind: "email" }, fixture);
  assert.equal(pii.decision, "pass");
  assert.equal(pii.forwardLabel, "masked");
  assert.equal(pii.checks.protect.count >= 4, true);
  assert.equal(pii.forwardText.includes("jordan.hale@example.com"), false);
  assert.equal(pii.forwardText.includes("219-09-9999"), false);
  assert.equal(pii.forwardText.includes("Jordan Hale"), false);
  assert.equal(pii.reasons.join("\n").includes("jordan.hale@example.com"), false);
  assert.equal(pii.highlights.some((item) => item.channel === "pii" && item.aligned), true);

  const injection = await screen({ text: sample("injection-page").text, kind: "retrieved" }, fixture);
  assert.equal(injection.decision, "quarantine");
  assert.equal(injection.forwardText, null);
  assert.equal(injection.highlights.some((item) => item.channel === "injection" && item.aligned), true);

  const safeScript = await screen({ text: sample("benign-script").text, kind: "script" }, fixture);
  assert.equal(safeScript.decision, "pass");
  assert.equal(safeScript.checks.inspect.outcome, "pass");

  const risky = await screen({ text: sample("sketchy-script").text, kind: "script" }, fixture);
  assert.equal(risky.decision, "quarantine");
  assert.equal(risky.checks.inspect.outcome, "quarantine");
  assert.equal(risky.highlights.some((item) => item.channel === "script" && item.aligned), true);

  const arabic = await screen({ text: sample("arabic-pii").text, kind: "message" }, fixture);
  assert.equal(arabic.decision, "pass");
  assert.equal(arabic.direction, "rtl");
  assert.equal(arabic.forwardLabel, "masked");
  assert.equal(arabic.forwardText.includes("فاطمة الحسن"), false);
  assert.equal(arabic.forwardText.includes("fatima.alhassan@example.com"), false);
  assert.equal(arabic.checks.guard.outcome, "pass");

  const borderline = await screen({ text: sample("borderline-note").text, kind: "email" }, fixture);
  assert.equal(borderline.decision, "ask");
  assert.equal(borderline.checks.guard.code, "borderline");
  assert.equal(borderline.forwardText, null);
});

test("the audit record keeps counts and drops raw values", async () => {
  const result = await screen({ text: sample("pii-email").text, kind: "email" }, fixture);
  const entry = auditShape(result);
  const serialized = JSON.stringify(entry);
  assert.equal(entry.text, undefined);
  assert.equal(serialized.includes("jordan.hale@example.com"), false);
  assert.equal(serialized.includes("219-09-9999"), false);
  assert.equal(serialized.includes("000998877665"), false);
  assert.equal(entry.protect.count >= 4, true);
  assert.equal(entry.decision, "pass");
});

test("a live call posts the pipeline and the response cannot carry the key", async () => {
  const secret = "test-key-do-not-leak";
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        model: "clocked-1.0",
        steps: [
          {
            endpoint: "pii",
            status: 200,
            result: { model: "clocked-1.0", entities: [], counts: {}, threshold: 0.5 },
          },
          {
            endpoint: "injection",
            status: 200,
            result: {
              model: "clocked-1.0",
              injection: 0.03,
              verdict: "benign",
              threshold: 0.5,
              category: "benign",
              evidence: [],
            },
          },
        ],
      }),
      { status: 200, headers: { "x-clocked-credits": "6" } },
    );
  };
  const result = await screen(
    { text: "Please book a room.", kind: "message" },
    { mode: "live", env: { CLOCKED_API_KEY: secret }, fetchImpl, sleep: async () => {} },
  );
  assert.equal(result.decision, "pass");
  assert.equal(result.mode, "live");
  assert.equal(seen.url, "https://clocked.rezolve.ai/clocked/pipeline");
  assert.equal(seen.headers.Authorization, `Bearer ${secret}`);
  assert.equal(seen.body.steps[1].injection.source, "user");
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.usage.credits, "6");
});

test("drills exercise bounded retries without a network call", async () => {
  const timedOut = await screen({ text: "hello", kind: "message", drill: "timeout" }, fixture);
  assert.equal(timedOut.decision, "ask");
  assert.equal(timedOut.attempts, 3);
  assert.match(timedOut.summary, /3 attempts/);
  assert.equal(JSON.stringify(timedOut).includes("drill-key"), false);

  const flaky = await screen({ text: sample("benign-email").text, kind: "email", drill: "flaky" }, fixture);
  assert.equal(flaky.attempts, 2);
  assert.equal(flaky.decision, "pass");

  const denied = await screen({ text: "hello", kind: "email", drill: "unauthorized" }, fixture);
  assert.equal(denied.attempts, 1);
  assert.match(denied.summary, /API key/);

  const guardDown = await screen({ text: "hello", kind: "email", drill: "guard-failed" }, fixture);
  assert.equal(guardDown.decision, "ask");
  assert.equal(guardDown.checks.protect.outcome, "pass");
  assert.equal(guardDown.checks.guard.status, "error");
  assert.equal(guardDown.forwardText, null);
});

test("live mode refuses drills so they cannot spend credits", async () => {
  await assert.rejects(
    () => screen({ text: "hello", kind: "email", drill: "timeout" }, { mode: "live", env: { CLOCKED_API_KEY: "x" } }),
    /fixture mode/,
  );
});
