import crypto from "node:crypto";
import { toAudit } from "./audit.js";
import { clockedPost, scrub } from "./clocked.js";
import { fixtureFor, textHash } from "./fixtures.js";
import { collectHighlights, isMostlyRtl } from "./highlight.js";
import { assess } from "./policy.js";
import { buildPipelineRequest, normalizePipeline, TEXT_LIMIT } from "./pipeline.js";
import { sampleById, SAMPLES } from "./samples.js";
import { standInResponse } from "./standin.js";

export const KINDS = ["message", "email", "retrieved", "script"];
const KIND_SET = new Set(KINDS);

export function resolveMode(env = process.env) {
  const forced = String(env.CLOCKED_MODE || "").toLowerCase();
  if (forced === "fixture" || forced === "offline") return "fixture";
  if (forced === "live") {
    if (!env.CLOCKED_API_KEY) {
      const error = new Error("CLOCKED_MODE=live requires CLOCKED_API_KEY.");
      error.statusCode = 500;
      throw error;
    }
    return "live";
  }
  return env.CLOCKED_API_KEY ? "live" : "fixture";
}

export function normalizeNewlines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sampleIdFor(text, kind) {
  return SAMPLES.find((sample) => sample.text === text && sample.kind === kind)?.id || null;
}

function publicChecks(view) {
  const protectStatus = view.protect.code === "failed" || view.protect.code === "missing" ? "error" : "ok";
  const guardStatus = view.guard.code === "failed" || view.guard.code === "missing" ? "error" : "ok";
  let inspectStatus = "ok";
  if (view.inspect.outcome === "skip") inspectStatus = "skipped";
  else if (view.inspect.code === "failed" || view.inspect.code === "missing") inspectStatus = "error";
  return {
    protect: {
      status: protectStatus,
      endpoint: "/pii",
      via: "/pipeline",
      outcome: view.protect.outcome,
      code: view.protect.code,
      count: view.protect.count,
      types: view.protect.types,
      detail: view.protect.detail,
      entities: view.protect.entities,
    },
    guard: {
      status: guardStatus,
      endpoint: "/injection",
      via: "/pipeline",
      outcome: view.guard.outcome,
      code: view.guard.code,
      probability: view.guard.probability,
      threshold: view.guard.threshold,
      band: view.guard.band,
      zone: view.guard.zone,
      verdict: view.guard.verdict,
      category: view.guard.category,
      categories: view.guard.categories,
      severity: view.guard.severity,
      severityExpected: view.guard.severityExpected,
      residual: view.guard.residual,
      residualVerdict: view.guard.residualVerdict,
      evidence: view.guard.evidence,
      detail: view.guard.detail,
    },
    inspect: {
      status: inspectStatus,
      endpoint: "/script",
      via: "/pipeline",
      outcome: view.inspect.outcome,
      code: view.inspect.code,
      malicious: view.inspect.malicious,
      suspicious: view.inspect.suspicious,
      drivenBy: view.inspect.drivenBy,
      probability: view.inspect.probability,
      threshold: view.inspect.threshold,
      band: view.inspect.band,
      zone: view.inspect.zone,
      verdict: view.inspect.verdict,
      category: view.inspect.category,
      categories: view.inspect.categories,
      severity: view.inspect.severity,
      evidence: view.inspect.evidence,
      detail: view.inspect.detail,
    },
  };
}

function present({ text, kind, mode, assessment, sampleId, norm, attempts, usage, model, requestId, error }) {
  const view = assess({ text, kind, protect: norm.protect, guard: norm.guard, inspect: norm.inspect });
  return {
    id: `gk_${crypto.randomUUID()}`,
    at: new Date().toISOString(),
    text,
    mode,
    assessment,
    kind,
    sampleId,
    direction: isMostlyRtl(text) ? "rtl" : "ltr",
    decision: view.decision,
    summary: view.summary,
    reasons: view.reasons,
    forwardText: view.forwardText,
    forwardLabel: view.forwardLabel,
    proposedText: view.proposedText,
    highlights: collectHighlights(text, norm),
    checks: publicChecks(view),
    attempts,
    usage: usage || null,
    model: model || norm.model || null,
    requestId: requestId || null,
    error: error || null,
    stopped: norm.stopped || null,
  };
}

function presentFailure({ text, kind, mode, res, secret }) {
  const message = scrub(res.message || "Clocked did not return a usable read.", secret);
  const failed = { ok: false, error: { error: message }, status: res.status };
  const norm = {
    model: null,
    stopped: null,
    protect: failed,
    guard: failed,
    inspect: kind === "script" ? failed : { ok: true, notApplicable: true, result: null },
  };
  const body = present({
    text,
    kind,
    mode,
    assessment: mode === "fixture" ? "drill" : "live",
    sampleId: sampleIdFor(text, kind),
    norm,
    attempts: res.attempts || 0,
    usage: res.usage,
    model: null,
    requestId: res.requestId,
    error: { status: res.status || 0, message, attempts: res.attempts || 0 },
  });
  const attempts = res.attempts || 0;
  if (res.status === 401 || res.status === 403) {
    body.summary = "Ask a human. Clocked rejected the API key. Nothing is released.";
  } else if (res.status === 402) {
    body.summary = "Ask a human. The Clocked account is out of credits. Nothing is released.";
  } else if (attempts > 1) {
    body.summary = `Ask a human. Clocked did not answer after ${attempts} attempts. Nothing is released.`;
    body.reasons.unshift("The same Idempotency-Key was reused for every attempt. Gatekeeper did not open a second logical request.");
  } else {
    body.summary = "Ask a human. The Clocked read failed, so nothing is released.";
  }
  return body;
}

function cannedClear(kind) {
  const steps = [
    {
      endpoint: "pii",
      name: "protect",
      status: 200,
      result: {
        model: "clocked-1.0",
        entities: [],
        counts: {},
        threshold: 0.5,
        instructions_used: "custom",
      },
    },
    {
      endpoint: "injection",
      name: "guard",
      status: 200,
      result: {
        model: "clocked-1.0",
        injection: 0.04,
        verdict: "benign",
        threshold: 0.5,
        source: kind === "message" ? "user" : "content",
        instructions_used: "custom",
        category: "benign",
        categories: { benign: 0.96, "instruction override": 0.04 },
        severity: "none",
        evidence: [],
      },
    },
  ];
  if (kind === "script") {
    steps.push({
      endpoint: "script",
      name: "inspect",
      status: 200,
      result: {
        model: "clocked-1.0",
        malicious: 0.03,
        suspicious: 0.08,
        verdict: "benign",
        threshold: 0.5,
        instructions_used: "custom",
        category: "benign administration",
        categories: { "benign administration": 0.97 },
        severity: "none",
        evidence: [],
      },
    });
  }
  return { model: "clocked-1.0", steps, stopped: null };
}

function drillFetch(drill, text, kind) {
  let calls = 0;
  if (drill === "timeout") {
    return async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
  }
  if (drill === "unauthorized") {
    return async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  if (drill === "retry-as-new") {
    return async () =>
      new Response(JSON.stringify({ error: "This attempt ended.", retryAsNew: true }), { status: 503 });
  }
  if (drill === "flaky") {
    return async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: "upstream" }), { status: 500 });
      return new Response(JSON.stringify(standInResponse(text, kind)), {
        status: 200,
        headers: { "x-clocked-credits": "0", "x-clocked-transport": "drill" },
      });
    };
  }
  if (drill === "guard-failed") {
    return async () => {
      const body = cannedClear(kind);
      body.steps[1] = { endpoint: "injection", name: "guard", status: 503, error: { error: "Guard upstream failed" } };
      return new Response(JSON.stringify(body), { status: 200 });
    };
  }
  return null;
}

async function runDrill({ text, kind, drill, mode, options }) {
  const fetchImpl = drillFetch(drill, text, kind);
  if (!fetchImpl) {
    throw httpError("Unknown drill. Use timeout, unauthorized, flaky, retry-as-new, or guard-failed.", 400);
  }
  const secret = "drill-key";
  const res = await clockedPost({
    path: "/pipeline",
    body: buildPipelineRequest({ text, kind }),
    apiKey: secret,
    fetchImpl,
    timeoutMs: options.timeoutMs || 50,
    maxAttempts: options.maxAttempts || 3,
    sleep: options.sleep || (async () => {}),
    log: options.log,
  });
  if (!res.ok) return presentFailure({ text, kind, mode, res, secret });
  const norm = normalizePipeline(res.json, { kind });
  const body = present({
    text,
    kind,
    mode,
    assessment: "drill",
    sampleId: sampleIdFor(text, kind),
    norm,
    attempts: res.attempts,
    usage: res.usage,
    model: norm.model,
    requestId: res.requestId,
  });
  if (options.includeRaw) body.raw = res.json;
  return body;
}

export async function screen(input, options = {}) {
  const env = options.env || process.env;
  const mode = options.mode || resolveMode(env);
  const text = normalizeNewlines(input?.text);
  const kind = input?.kind;
  if (!KIND_SET.has(kind)) throw httpError("Kind must be message, email, retrieved, or script.", 400);
  if (!text.trim()) throw httpError("Paste some text before screening.", 400);
  if (Array.from(text).length > TEXT_LIMIT) {
    throw httpError(`Gatekeeper accepts ${TEXT_LIMIT.toLocaleString("en-US")} characters, the Protect and Guard admission limit.`, 400);
  }
  if (input?.drill) {
    if (mode !== "fixture") {
      throw httpError("Resilience drills run only in fixture mode, so a drill cannot spend credits.", 400);
    }
    return runDrill({ text, kind, drill: String(input.drill), mode, options });
  }
  if (mode === "fixture") {
    const fixture = fixtureFor(text, kind, options.fixtureDir);
    const norm = normalizePipeline(fixture.response, { kind });
    const body = present({
      text,
      kind,
      mode,
      assessment: fixture.assessment,
      sampleId: fixture.sampleId,
      norm,
      attempts: fixture.assessment === "recorded-fixture" ? 1 : 0,
      usage: fixture.usage,
      model: fixture.response?.model || norm.model,
    });
    if (options.includeRaw) body.raw = fixture.response;
    return body;
  }
  const requestBody = buildPipelineRequest({ text, kind });
  const res = await clockedPost({
    path: "/pipeline",
    body: requestBody,
    apiKey: env.CLOCKED_API_KEY,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxAttempts: options.maxAttempts,
    sleep: options.sleep,
    log: options.log,
    baseUrl: options.baseUrl,
  });
  if (!res.ok) {
    const body = presentFailure({ text, kind, mode, res, secret: env.CLOCKED_API_KEY });
    if (options.includeRaw) body.raw = res.json || null;
    return body;
  }
  const norm = normalizePipeline(res.json, { kind });
  const body = present({
    text,
    kind,
    mode,
    assessment: "live",
    sampleId: sampleIdFor(text, kind),
    norm,
    attempts: res.attempts,
    usage: res.usage,
    model: norm.model,
    requestId: res.requestId,
  });
  if (options.includeRaw) body.raw = res.json;
  return body;
}

export function auditShape(result) {
  return toAudit(result);
}

export function hashText(text) {
  return textHash(normalizeNewlines(text));
}

export function listSamples() {
  return SAMPLES.map((sample) => ({
    id: sample.id,
    kind: sample.kind,
    title: sample.title,
    blurb: sample.blurb,
    text: sample.text,
  }));
}

export function sampleText(id) {
  const sample = sampleById(id);
  if (!sample) return null;
  return sample;
}
