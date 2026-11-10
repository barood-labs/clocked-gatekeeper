#!/usr/bin/env node
import fs from "node:fs";
import { SAMPLES } from "./src/samples.js";
import { screen } from "./src/screen.js";

const args = process.argv.slice(2);
const command = args[0] || "help";

function flag(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? true;
}

function optionsFromArgs() {
  const mode = flag("--mode");
  const options = {};
  if (mode === "fixture" || mode === "live" || mode === "offline") options.mode = mode === "offline" ? "fixture" : mode;
  return options;
}

function printHuman(result) {
  const lines = [
    `decision: ${String(result.decision || "").toUpperCase()}`,
    `summary: ${result.summary}`,
    `mode: ${result.mode} (${result.assessment})`,
    `kind: ${result.kind}`,
    ...result.reasons.map((reason) => `• ${reason}`),
    `attempts: ${result.attempts}`,
  ];
  if (result.usage?.credits) lines.push(`credits: ${result.usage.credits}`);
  if (result.model) lines.push(`model: ${result.model}`);
  if (result.decision === "pass") {
    lines.push(`forward (${result.forwardLabel}):`);
    lines.push(result.forwardText ?? "");
  } else if (result.proposedText) {
    lines.push("proposed mask (not released):");
    lines.push(result.proposedText);
  }
  console.log(lines.join("\n"));
}

function emit(result, asJson) {
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
}

function codeFor(decision) {
  if (decision === "pass") return 0;
  if (decision === "ask") return 3;
  if (decision === "quarantine") return 4;
  return 1;
}

function help() {
  console.log(`Gatekeeper — screen text before it reaches an assistant.

Usage
  node cli.js samples
  node cli.js scan --sample benign-email
  node cli.js scan --kind email --file note.txt
  node cli.js scan --kind message --text "hello"
  node cli.js batch --samples
  node cli.js batch --file batch.json
  node cli.js serve

Flags
  --mode fixture|live   Override CLOCKED_MODE
  --json                Print the full operator result

Exit codes
  0 pass, 3 ask a human, 4 quarantine, 1 error

Live mode is the default when CLOCKED_API_KEY is set. The key is read from the
environment and is never printed.`);
}

async function scanOne(input, options, asJson) {
  const result = await screen(input, options);
  emit(result, asJson);
  return codeFor(result.decision);
}

async function main() {
  const asJson = args.includes("--json");
  const options = optionsFromArgs();
  if (command === "help" || command === "--help" || command === "-h") {
    help();
    return;
  }
  if (command === "samples") {
    const rows = SAMPLES.map((sample) => ({
      id: sample.id,
      kind: sample.kind,
      title: sample.title.en,
    }));
    console.log(asJson ? JSON.stringify(rows, null, 2) : rows.map((row) => `${row.id}\t${row.kind}\t${row.title}`).join("\n"));
    return;
  }
  if (command === "serve") {
    const { startServer } = await import("./src/server.js");
    startServer({ ...options });
    return;
  }
  if (command === "scan") {
    const sampleId = flag("--sample");
    const kindFlag = flag("--kind");
    const file = flag("--file");
    const textFlag = flag("--text");
    let text = null;
    let kind = kindFlag;
    if (sampleId) {
      const sample = SAMPLES.find((item) => item.id === sampleId);
      if (!sample) throw new Error(`Unknown sample ${sampleId}.`);
      text = sample.text;
      kind = sample.kind;
    } else if (typeof file === "string") {
      text = fs.readFileSync(file, "utf8");
    } else if (typeof textFlag === "string") {
      text = textFlag;
    }
    if (!text || !kind || kind === true) throw new Error("scan needs --sample, or --kind with --file or --text.");
    process.exitCode = await scanOne({ text, kind }, options, asJson);
    return;
  }
  if (command === "batch") {
    let items = [];
    if (args.includes("--samples")) {
      items = SAMPLES.map((sample) => ({ id: sample.id, text: sample.text, kind: sample.kind }));
    } else if (typeof flag("--file") === "string") {
      const parsed = JSON.parse(fs.readFileSync(flag("--file"), "utf8"));
      items = Array.isArray(parsed) ? parsed : parsed.items;
    }
    if (!Array.isArray(items) || !items.length) throw new Error("batch needs --samples or --file.");
    let exit = 0;
    const rows = [];
    for (const item of items) {
      const result = await screen({ text: item.text, kind: item.kind }, options);
      rows.push({ id: item.id || null, kind: item.kind, decision: result.decision, summary: result.summary });
      if (!asJson) console.log(`${item.id || item.kind}\t${result.decision}\t${result.summary}`);
      exit = Math.max(exit, codeFor(result.decision));
    }
    if (asJson) console.log(JSON.stringify(rows, null, 2));
    process.exitCode = exit;
    return;
  }
  throw new Error(`Unknown command ${command}.`);
}

main().catch((error) => {
  console.error(error.message || "Gatekeeper failed.");
  process.exitCode = 1;
});
