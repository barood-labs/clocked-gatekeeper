#!/usr/bin/env node
// Record live Clocked responses for the built-in samples.
// Writes fixtures/recorded/<id>.json. Never prints the API key.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RECORDED_DIR, textHash } from "../src/fixtures.js";
import { SAMPLES } from "../src/samples.js";
import { screen } from "../src/screen.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const probe = args.includes("--probe");

if (!process.env.CLOCKED_API_KEY) {
  console.error("CLOCKED_API_KEY is not set. Nothing was sent.");
  process.exit(1);
}

const selected = SAMPLES.filter((sample) => !only || sample.id === only);
if (!selected.length) {
  console.error("No matching sample.");
  process.exit(1);
}

fs.mkdirSync(RECORDED_DIR, { recursive: true });
let credits = 0;
let failed = 0;

for (const sample of selected) {
  if (sample.text.includes(process.env.CLOCKED_API_KEY)) {
    console.error(`${sample.id}: refused, the sample contains the API key.`);
    process.exit(1);
  }
  const result = await screen({ text: sample.text, kind: sample.kind }, { mode: "live", includeRaw: true, timeoutMs: 90_000 });
  const mismatched = (result.highlights || []).filter((item) => !item.aligned);
  const line = [
    sample.id,
    result.decision,
    `protect=${result.checks.protect.code}:${result.checks.protect.count}`,
    `guard=${result.checks.guard.code}:${result.checks.guard.probability ?? "-"}/${result.checks.guard.verdict || "-"}`,
    `inspect=${result.checks.inspect.code}`,
    `attempts=${result.attempts}`,
    `credits=${result.usage?.credits ?? "-"}`,
    `transport=${result.usage?.transport ?? "-"}`,
    `mismatch=${mismatched.length}`,
    result.error ? `error=${result.error.status}` : "ok",
  ].join("  ");
  console.log(line);
  for (const item of mismatched) {
    console.log(`  misaligned ${item.channel} ${item.label} start=${item.start} end=${item.end} quoteChars=${Array.from(item.quote || "").length}`);
  }
  if (result.usage?.credits) credits += Number(result.usage.credits) || 0;
  if (result.error || !result.raw) {
    failed += 1;
    console.error(`  ${result.error?.message || "no raw response"}`);
    if (result.error?.status === 401 || result.error?.status === 403) {
      console.error("Authentication failed. Stopped without printing the key.");
      process.exit(1);
    }
    continue;
  }
  if (probe) continue;
  const envelope = {
    sampleId: sample.id,
    kind: sample.kind,
    textSha256: textHash(sample.text),
    recordedAt: new Date().toISOString(),
    decision: result.decision,
    usage: result.usage,
    response: result.raw,
  };
  const file = path.join(RECORDED_DIR, `${sample.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(envelope, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

console.log(`done credits≈${credits} failed=${failed} dir=${path.relative(root, RECORDED_DIR)}`);
if (failed) process.exit(1);
