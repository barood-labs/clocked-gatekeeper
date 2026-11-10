// Deterministic offline stand-in for text with no recorded Clocked response.
// It is labeled as such and is not a model judgment.

import { applyMask, findAllCodePoints, findCodePoint } from "./highlight.js";

const STRONG = /ignore (?:all |your |the )?(?:previous|prior) instructions|do not mention this|exfiltrat|disregard (?:your |the )?previous/i;
const TRAINING = /training|classroom|example lure|should not follow|do not follow|nobody should follow/i;

function addAt(list, text, type, raw, utf16Index) {
  const value = String(raw || "").trim().replace(/[.,،]+$/g, "");
  if (!value || !Number.isInteger(utf16Index) || utf16Index < 0) return;
  let start = Array.from(text.slice(0, utf16Index)).length;
  const chars = Array.from(text);
  if (chars.slice(start, start + Array.from(value).length).join("") !== value) {
    const relative = findCodePoint(chars.slice(start).join(""), value);
    if (!relative) return;
    start += relative.start;
  }
  const end = start + Array.from(value).length;
  if (chars.slice(start, end).join("") !== value) return;
  if (list.some((item) => item.start === start && item.end === end)) return;
  list.push({ type, value, start, end });
}

export function detectEntities(text) {
  const list = [];
  for (const match of text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) {
    addAt(list, text, "email", match[0], match.index);
  }
  for (const match of text.matchAll(/\+\d{1,3}(?:[\s.-]?\d{2,4}){2,4}/g)) {
    addAt(list, text, "phone", match[0], match.index);
  }
  for (const match of text.matchAll(/\b\d{3}-\d{2}-\d{4}\b/g)) {
    addAt(list, text, "ssn", match[0], match.index);
  }
  const bank = text.match(/bank account\s+([0-9]{6,})/i);
  if (bank) addAt(list, text, "bank_account", bank[1], bank.index + bank[0].indexOf(bank[1]));
  const dob = text.match(/date of birth:\s*([^\n]+)/i);
  if (dob) addAt(list, text, "date_of_birth", dob[1], dob.index + dob[0].indexOf(dob[1]));
  const person = text.match(/\b(?:I am|this is|I'm)\s+([A-Z][a-z]+ [A-Z][a-z]+)/);
  if (person) addAt(list, text, "person", person[1], person.index + person[0].indexOf(person[1]));
  const address = text.match(/address:\s*([^\n]+)/i);
  if (address) addAt(list, text, "address", address[1], address.index + address[0].indexOf(address[1]));
  const arabicName = text.match(/أنا\s+(\S+\s+\S+)/);
  if (arabicName) addAt(list, text, "person", arabicName[1], arabicName.index + arabicName[0].indexOf(arabicName[1]));
  const nationalId = text.match(/رقم الهوية[\s\S]{0,48}?(\d{8,})/);
  if (nationalId) addAt(list, text, "national_id", nationalId[1], nationalId.index + nationalId[0].lastIndexOf(nationalId[1]));
  const expanded = [];
  for (const entity of list) {
    const matches = findAllCodePoints(text, entity.value);
    const spans = matches.length ? matches : [{ start: entity.start, end: entity.end }];
    for (const span of spans) {
      if (expanded.some((item) => item.start === span.start && item.end === span.end)) continue;
      expanded.push({ ...entity, start: span.start, end: span.end });
    }
  }
  return expanded.sort((a, b) => a.start - b.start);
}

function countsOf(entities) {
  const counts = {};
  for (const entity of entities) counts[entity.type] = (counts[entity.type] || 0) + 1;
  return counts;
}

export function detectGuard(text, source = "content") {
  const strong = STRONG.test(text);
  const training = TRAINING.test(text);
  let injection = 0.04;
  let verdict = "benign";
  let category = "benign";
  if (strong && training) {
    injection = 0.52;
    verdict = "injection";
    category = "instruction override";
  } else if (strong) {
    injection = 0.97;
    verdict = "injection";
    category = "instruction override";
  }
  const evidence = [];
  if (strong) {
    const match = text.match(STRONG);
    if (match) {
      const spans = findAllCodePoints(text, match[0]);
      const span = spans[0];
      if (span) {
        evidence.push({ quote: match[0], start: span.start, end: span.end, confidence: 0.99 });
      }
    }
  }
  const benign = Number((1 - injection).toFixed(4));
  return {
    model: "gatekeeper-offline-stand-in",
    injection,
    verdict,
    threshold: 0.5,
    source,
    instructions_used: "custom",
    category,
    categories: {
      benign,
      "instruction override": injection,
    },
    severity: injection > 0.65 ? "high" : injection >= 0.35 ? "medium" : "none",
    evidence,
  };
}

function lineAt(text, index) {
  const start = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  let end = text.indexOf("\n", index);
  if (end < 0) end = text.length;
  const line = text.slice(start, end);
  const span = findCodePoint(text, line);
  if (!span) return null;
  return { line, start: span.start, end: span.end, confidence: 0.99 };
}

export function detectScript(text) {
  const rules = [
    { pattern: /curl[^\n|]*\|\s*(?:ba)?sh/i, category: "unsafe download or remote code execution" },
    { pattern: /AWS_SECRET_ACCESS_KEY/i, category: "credential theft or memory dumping" },
    { pattern: /\/etc\/cron\.d|chmod\s+777/i, category: "unauthorized persistence or access expansion" },
    { pattern: /DisableRealtimeMonitoring/i, category: "security blinding or EDR evasion" },
  ];
  const evidence = [];
  let category = "benign administration";
  for (const rule of rules) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    if (category === "benign administration") category = rule.category;
    const line = lineAt(text, match.index ?? 0);
    if (line && !evidence.some((item) => item.line === line.line)) evidence.push(line);
  }
  const risky = evidence.length > 0;
  return {
    model: "gatekeeper-offline-stand-in",
    malicious: risky ? 0.99 : 0.03,
    suspicious: risky ? 0.93 : 0.08,
    verdict: risky ? "malicious" : "benign",
    threshold: 0.5,
    instructions_used: "custom",
    category,
    categories: risky
      ? { "benign administration": 0.02, [category]: 0.98 }
      : { "benign administration": 0.97 },
    severity: risky ? "critical" : "none",
    evidence,
  };
}

export function standInResponse(text, kind) {
  const entities = detectEntities(text);
  const anonymized = entities.length ? applyMask(text, entities, 2) : undefined;
  const source = kind === "message" ? "user" : "content";
  const steps = [
    {
      step: 0,
      endpoint: "pii",
      name: "protect",
      status: 200,
      ms: 1,
      result: {
        model: "gatekeeper-offline-stand-in",
        entities: entities.map((entity) => ({ ...entity, confidence: 0.99, source: "stand-in" })),
        counts: countsOf(entities),
        threshold: 0.5,
        instructions_used: "custom",
        ...(anonymized ? { anonymized_text: anonymized } : {}),
      },
    },
    {
      step: 1,
      endpoint: "injection",
      name: "guard",
      status: 200,
      ms: 1,
      result: detectGuard(text, source),
    },
  ];
  if (kind === "script") {
    steps.push({
      step: 2,
      endpoint: "script",
      name: "inspect",
      status: 200,
      ms: 1,
      result: detectScript(text),
    });
  }
  return {
    model: "gatekeeper-offline-stand-in",
    steps,
    stopped: null,
    timing: { total_ms: 1, model_ms: 0 },
  };
}
