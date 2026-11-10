import assert from "node:assert/strict";
import test from "node:test";
import { loadRecorded, textHash } from "../src/fixtures.js";
import { SAMPLES } from "../src/samples.js";
import { screen } from "../src/screen.js";

const EXPECTED = {
  "benign-email": "pass",
  "pii-email": "pass",
  "injection-page": "quarantine",
  "benign-script": "pass",
  "sketchy-script": "quarantine",
  "arabic-pii": "pass",
  "borderline-note": "ask",
};

test("recorded Clocked responses drive the built-in samples", async () => {
  for (const sample of SAMPLES) {
    const recorded = loadRecorded(sample.id);
    assert.ok(recorded?.response, sample.id);
    assert.equal(recorded.textSha256, textHash(sample.text));
    assert.equal(recorded.response.model, "clocked-1.0");
    const endpoints = recorded.response.steps.map((step) => step.endpoint);
    assert.ok(endpoints.includes("pii"));
    assert.ok(endpoints.includes("injection"));
    assert.equal(endpoints.includes("script"), sample.kind === "script");
    const result = await screen({ text: sample.text, kind: sample.kind }, { mode: "fixture" });
    assert.equal(result.assessment, "recorded-fixture");
    assert.equal(result.decision, EXPECTED[sample.id]);
    assert.equal(result.decision, recorded.decision);
    for (const highlight of result.highlights) {
      if (highlight.quote) assert.equal(highlight.aligned, true, `${sample.id} ${highlight.channel}`);
    }
  }
});
