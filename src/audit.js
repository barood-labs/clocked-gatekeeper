import fs from "node:fs";
import path from "node:path";

const MAX_ENTRIES = 200;

export function toAudit(result) {
  return {
    id: result.id,
    at: result.at,
    kind: result.kind,
    sampleId: result.sampleId,
    decision: result.decision,
    assessment: result.assessment,
    mode: result.mode,
    direction: result.direction,
    summary: result.summary,
    reasons: result.reasons,
    protect: {
      outcome: result.checks.protect.outcome,
      code: result.checks.protect.code,
      count: result.checks.protect.count,
      types: result.checks.protect.types,
    },
    guard: {
      outcome: result.checks.guard.outcome,
      code: result.checks.guard.code,
      probability: result.checks.guard.probability,
      verdict: result.checks.guard.verdict,
      category: result.checks.guard.category,
      severity: result.checks.guard.severity,
    },
    inspect: {
      outcome: result.checks.inspect.outcome,
      code: result.checks.inspect.code,
      malicious: result.checks.inspect.malicious,
      suspicious: result.checks.inspect.suspicious,
      verdict: result.checks.inspect.verdict,
      category: result.checks.inspect.category,
    },
    attempts: result.attempts,
    usage: result.usage,
    error: result.error,
  };
}

export function createAudit(filePath) {
  const entries = [];
  if (filePath && fs.existsSync(filePath)) {
    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Ignore a torn line rather than refusing to boot.
      }
    }
  }
  function persist() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const trimmed = entries.slice(-MAX_ENTRIES);
    const body = trimmed.map((entry) => JSON.stringify(entry)).join("\n");
    fs.writeFileSync(filePath, body.length ? `${body}\n` : "");
  }
  return {
    add(result) {
      entries.push(toAudit(result));
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      persist();
    },
    list() {
      return [...entries].reverse();
    },
    clear() {
      entries.length = 0;
      persist();
    },
  };
}
