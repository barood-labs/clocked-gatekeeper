// Gatekeeper's decision sits on top of Clocked. The endpoints report
// probabilities and spans; this module decides what is allowed to move.

export const DEFAULT_THRESHOLD = 0.5;
export const BORDER = 0.15;
export const LOW_CONFIDENCE = 0.6;

export function round3(value) {
  return Math.round(value * 1000) / 1000;
}

export function bandEdges(threshold = DEFAULT_THRESHOLD) {
  return [round3(threshold - BORDER), round3(threshold + BORDER)];
}

export function formatProb(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "missing";
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function zone(probability, threshold = DEFAULT_THRESHOLD) {
  if (typeof probability !== "number" || !Number.isFinite(probability)) return "missing";
  const [low, high] = bandEdges(threshold);
  const rounded = round3(probability);
  if (rounded < low) return "low";
  if (rounded > high) return "high";
  return "uncertain";
}

export function classifyVerdict(verdict) {
  const value = String(verdict || "").toLowerCase().trim();
  if (!value) return "missing";
  if (value.startsWith("benign")) return "benign";
  if (value.includes("inject") || value.includes("malicious") || value.includes("suspicious")) return "risky";
  return "unknown";
}

export function fromSignal({ zone: zoneName, verdictClass }) {
  if (zoneName === "missing" || zoneName === "uncertain") return "ask";
  if (zoneName === "high" && verdictClass === "benign") return "ask";
  if (zoneName === "high") return "quarantine";
  if (zoneName === "low" && verdictClass === "benign") return "pass";
  return "ask";
}

export function signalCode(outcome, zoneName, verdictClass, riskyCode) {
  if (outcome === "pass") return "benign";
  if (zoneName === "uncertain") return "borderline";
  if (outcome === "quarantine") return riskyCode;
  if (zoneName === "missing") return "missing";
  if ((verdictClass === "benign" && zoneName === "high") || (verdictClass === "risky" && zoneName === "low")) {
    return "conflict";
  }
  return "unclear";
}

export function errorMessage(error) {
  if (!error) return "The check failed.";
  if (typeof error === "string") return error;
  if (typeof error.error === "string") return error.error;
  if (typeof error.message === "string") return error.message;
  if (typeof error.detail === "string") return error.detail;
  if (Array.isArray(error.detail)) {
    const parts = error.detail.map((item) => item?.msg || item?.message).filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return "The check failed.";
}

function entityList(result) {
  if (Array.isArray(result?.entities)) return result.entities;
  if (result?.entities == null && result?.counts && Object.keys(result.counts).length === 0) return [];
  return null;
}

export function judgeProtect(part, text) {
  const empty = { forward: null, masked: false, count: 0, types: [], entities: [] };
  if (!part || part.notApplicable) {
    return { outcome: "ask", code: "missing", ...empty, detail: "Protect result was missing. Nothing is released." };
  }
  if (!part.ok) {
    return {
      outcome: "ask",
      code: "failed",
      ...empty,
      detail: `Protect did not answer (${errorMessage(part.error)}). Nothing is released, because the raw text was not cleared.`,
    };
  }
  const result = part.result || {};
  const entities = entityList(result);
  if (!entities) {
    return { outcome: "ask", code: "missing", ...empty, detail: "Protect did not return an entity list. Nothing is released." };
  }
  const view = entities.map((entity) => ({
    type: entity.type || "unknown",
    value: typeof entity.value === "string" ? entity.value : "",
    start: Number.isInteger(entity.start) ? entity.start : null,
    end: Number.isInteger(entity.end) ? entity.end : null,
    confidence: typeof entity.confidence === "number" ? entity.confidence : null,
  }));
  const types = [...new Set(view.map((entity) => entity.type).filter(Boolean))];
  if (view.length === 0) {
    return {
      outcome: "pass",
      code: "clean",
      forward: text,
      masked: false,
      count: 0,
      types: [],
      entities: [],
      detail: "Protect found no personal data. The original text can be released.",
    };
  }
  const maskedText = typeof result.anonymized_text === "string" ? result.anonymized_text : "";
  const base = { count: view.length, types, entities: view, masked: false, forward: null };
  if (!maskedText || maskedText === text) {
    return {
      outcome: "ask",
      code: "missing-mask",
      ...base,
      detail: "Protect found personal data but did not return a masked copy that differs from the source. Nothing is released.",
    };
  }
  const leaked = view.filter((entity) => entity.value.length >= 4 && maskedText.includes(entity.value));
  if (leaked.length) {
    return {
      outcome: "ask",
      code: "missing-mask",
      ...base,
      detail: "Protect found personal data, and the masked copy still contains a finding. Nothing is released.",
    };
  }
  const low = view.filter((entity) => entity.confidence === null || entity.confidence < LOW_CONFIDENCE);
  if (low.length) {
    return {
      outcome: "ask",
      code: "uncertain-span",
      ...base,
      forward: maskedText,
      masked: true,
      detail: `Protect found ${view.length} span${view.length === 1 ? "" : "s"} (${types.join(", ")}), and ${low.length} need a person to confirm the mask before release.`,
    };
  }
  return {
    outcome: "pass",
    code: "masked",
    ...base,
    forward: maskedText,
    masked: true,
    detail: `Protect found ${view.length} span${view.length === 1 ? "" : "s"} (${types.join(", ")}). The released text is the masked copy.`,
  };
}

function evidenceView(items, quoteKey) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    quote: item?.[quoteKey] || item?.quote || item?.line || "",
    start: Number.isInteger(item?.start) ? item.start : null,
    end: Number.isInteger(item?.end) ? item.end : null,
    confidence: typeof item?.confidence === "number" ? item.confidence : null,
  }));
}

export function judgeGuard(part) {
  const blank = {
    probability: null,
    threshold: DEFAULT_THRESHOLD,
    band: bandEdges(),
    zone: "missing",
    verdict: null,
    category: null,
    categories: {},
    severity: null,
    severityExpected: null,
    residual: null,
    residualVerdict: null,
    residualNote: null,
    evidence: [],
  };
  if (!part || part.notApplicable) {
    return { outcome: "ask", code: "missing", ...blank, detail: "Guard result was missing. The text cannot be cleared." };
  }
  if (!part.ok) {
    return {
      outcome: "ask",
      code: "failed",
      ...blank,
      detail: `Guard did not answer (${errorMessage(part.error)}). The text cannot be cleared.`,
    };
  }
  const result = part.result || {};
  const threshold = typeof result.threshold === "number" ? result.threshold : DEFAULT_THRESHOLD;
  const probability = typeof result.injection === "number" ? result.injection : null;
  const zoneName = zone(probability, threshold);
  const verdict = result.verdict ? String(result.verdict) : "";
  const verdictClass = classifyVerdict(verdict);
  let outcome = fromSignal({ zone: zoneName, verdictClass });
  const category = result.category ? String(result.category) : "";
  const severity = result.severity ? String(result.severity) : "";
  const bandText = bandEdges(threshold).map((edge) => edge.toFixed(2)).join("–");
  let detail;
  if (outcome === "pass") {
    detail = `Guard injection probability ${formatProb(probability)} is below the uncertain band (${bandText}). Verdict ${verdict}.`;
  } else if (zoneName === "uncertain") {
    detail = `Guard injection probability ${formatProb(probability)} is inside the uncertain band (${bandText}) around threshold ${threshold.toFixed(2)}. A person makes this call.`;
  } else if (outcome === "quarantine") {
    const bits = [`Guard injection probability ${formatProb(probability)}`];
    if (verdict) bits.push(`verdict ${verdict}`);
    if (category) bits.push(`category ${category}`);
    if (severity) bits.push(`severity ${severity}`);
    detail = `${bits.join(", ")}. The text is held.`;
  } else if (zoneName === "missing") {
    detail = "Guard probability was missing. The text cannot be cleared.";
  } else if (verdict && zoneName !== "missing") {
    detail = `Guard verdict and probability disagree (verdict ${verdict}, probability ${formatProb(probability)}). A person makes this call.`;
  } else {
    detail = `Guard did not produce a clear benign read (probability ${formatProb(probability)}). A person makes this call.`;
  }
  const evidence = evidenceView(result.evidence, "quote");
  const benignMass = typeof result.categories?.benign === "number" ? result.categories.benign : 0;
  let disagreed = false;
  if (
    outcome === "quarantine" &&
    evidence.length === 0 &&
    classifyVerdict(category) === "benign" &&
    benignMass >= 0.8
  ) {
    outcome = "ask";
    disagreed = true;
    detail = `Guard injection probability ${formatProb(probability)} and verdict ${verdict} disagree with category ${category} (${formatProb(benignMass)}) and no evidence span was returned. A person makes this call.`;
  }
  let residualNote = null;
  const residual = typeof result.residual === "number" ? result.residual : null;
  const residualVerdict = result.residual_verdict ? String(result.residual_verdict) : "";
  if (residual !== null && zone(residual, threshold) === "high" && classifyVerdict(residualVerdict) === "risky") {
    residualNote = `Guard residual probability after the evidence spans is ${formatProb(residual)} (${residualVerdict}).`;
    if (outcome === "pass") outcome = "ask";
  }
  return {
    outcome,
    code: disagreed ? "conflict" : signalCode(outcome, zoneName, verdictClass, "injection"),
    probability,
    threshold,
    band: bandEdges(threshold),
    zone: zoneName,
    verdict: verdict || null,
    category: category || null,
    categories: result.categories && typeof result.categories === "object" ? result.categories : {},
    severity: severity || null,
    severityExpected: typeof result.severity_expected === "number" ? result.severity_expected : null,
    residual,
    residualVerdict: residualVerdict || null,
    residualNote,
    evidence,
    detail,
  };
}

export function judgeInspect(part, applicable) {
  const band = bandEdges();
  if (!applicable) {
    return {
      outcome: "skip",
      code: "not-applicable",
      malicious: null,
      suspicious: null,
      drivenBy: null,
      probability: null,
      threshold: DEFAULT_THRESHOLD,
      band,
      zone: "skip",
      verdict: null,
      category: null,
      categories: {},
      severity: null,
      evidence: [],
      detail: "Inspect does not run on this intake. Only scripts are inspected.",
    };
  }
  if (!part || part.notApplicable) {
    return {
      outcome: "ask",
      code: "missing",
      malicious: null,
      suspicious: null,
      drivenBy: null,
      probability: null,
      threshold: DEFAULT_THRESHOLD,
      band,
      zone: "missing",
      verdict: null,
      category: null,
      categories: {},
      severity: null,
      evidence: [],
      detail: "Inspect result was missing. A script cannot be cleared without it.",
    };
  }
  if (!part.ok) {
    return {
      outcome: "ask",
      code: "failed",
      malicious: null,
      suspicious: null,
      drivenBy: null,
      probability: null,
      threshold: DEFAULT_THRESHOLD,
      band,
      zone: "missing",
      verdict: null,
      category: null,
      categories: {},
      severity: null,
      evidence: [],
      detail: `Inspect did not answer (${errorMessage(part.error)}). A script cannot be cleared without it.`,
    };
  }
  const result = part.result || {};
  const threshold = typeof result.threshold === "number" ? result.threshold : DEFAULT_THRESHOLD;
  const malicious = typeof result.malicious === "number" ? result.malicious : null;
  const suspicious = typeof result.suspicious === "number" ? result.suspicious : null;
  let probability = null;
  let drivenBy = null;
  if (malicious === null && suspicious !== null) {
    probability = suspicious;
    drivenBy = "suspicious";
  } else if (suspicious === null && malicious !== null) {
    probability = malicious;
    drivenBy = "malicious";
  } else if (malicious !== null && suspicious !== null) {
    if (suspicious > malicious) {
      probability = suspicious;
      drivenBy = "suspicious";
    } else {
      probability = malicious;
      drivenBy = "malicious";
    }
  }
  const zoneName = zone(probability, threshold);
  const verdict = result.verdict ? String(result.verdict) : "";
  const verdictClass = classifyVerdict(verdict);
  const outcome = fromSignal({ zone: zoneName, verdictClass });
  const category = result.category ? String(result.category) : "";
  const severity = result.severity ? String(result.severity) : "";
  const bandText = bandEdges(threshold).map((edge) => edge.toFixed(2)).join("–");
  const numbers = `malicious ${formatProb(malicious)}, suspicious ${formatProb(suspicious)}`;
  let detail;
  if (outcome === "pass") {
    detail = `Inspect ${numbers}. ${drivenBy} ${formatProb(probability)} is below the uncertain band (${bandText}). Verdict ${verdict}.`;
  } else if (zoneName === "uncertain") {
    detail = `Inspect ${drivenBy} probability ${formatProb(probability)} is inside the uncertain band (${bandText}). A person makes this call.`;
  } else if (outcome === "quarantine") {
    const bits = [`Inspect ${numbers}`];
    if (verdict) bits.push(`verdict ${verdict}`);
    if (category) bits.push(`category ${category}`);
    if (severity) bits.push(`severity ${severity}`);
    detail = `${bits.join(", ")}. The script is held.`;
  } else if (zoneName === "missing") {
    detail = "Inspect probability was missing. A script cannot be cleared.";
  } else {
    detail = `Inspect verdict and probability disagree (verdict ${verdict || "missing"}, probability ${formatProb(probability)}). A person makes this call.`;
  }
  return {
    outcome,
    code: signalCode(outcome, zoneName, verdictClass, "risky-script"),
    malicious,
    suspicious,
    drivenBy,
    probability,
    threshold,
    band: bandEdges(threshold),
    zone: zoneName,
    verdict: verdict || null,
    category: category || null,
    categories: result.categories && typeof result.categories === "object" ? result.categories : {},
    severity: severity || null,
    evidence: evidenceView(result.evidence, "line"),
    detail,
  };
}

export function combine(outcomes) {
  let decision = "pass";
  for (const outcome of outcomes) {
    if (outcome === "quarantine") return "quarantine";
    if (outcome === "ask") decision = "ask";
  }
  return decision;
}

export function assess({ text, kind, protect, guard, inspect }) {
  const protectJudgment = judgeProtect(protect, text);
  const guardJudgment = judgeGuard(guard);
  const inspectJudgment = judgeInspect(inspect, kind === "script");
  const decision = combine([protectJudgment.outcome, guardJudgment.outcome, inspectJudgment.outcome]);
  const reasons = [protectJudgment.detail, guardJudgment.detail, inspectJudgment.detail];
  if (guardJudgment.residualNote) reasons.push(guardJudgment.residualNote);
  let summary = "Ask a human. Nothing is released.";
  let forwardText = null;
  let forwardLabel = "held";
  let proposedText = null;
  if (decision === "pass") {
    forwardText = protectJudgment.forward;
    forwardLabel = protectJudgment.masked ? "masked" : "original";
    summary = protectJudgment.masked
      ? "Pass. The assistant receives the masked copy."
      : "Pass. The assistant receives the original text.";
  } else if (decision === "quarantine") {
    summary = "Quarantine. Nothing is released.";
  } else if (protectJudgment.masked && typeof protectJudgment.forward === "string") {
    proposedText = protectJudgment.forward;
  }
  return {
    decision,
    summary,
    reasons,
    forwardText,
    forwardLabel,
    proposedText,
    protect: protectJudgment,
    guard: guardJudgment,
    inspect: inspectJudgment,
  };
}
