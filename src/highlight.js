// Clocked counts Unicode code points. String.slice counts UTF-16 code units.

export function sliceCodePoints(text, start, end) {
  return Array.from(text).slice(start, end).join("");
}

export function findAllCodePoints(text, quote) {
  const hay = Array.from(String(text ?? ""));
  const needle = Array.from(String(quote ?? ""));
  const found = [];
  if (!needle.length || needle.length > hay.length) return found;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    found.push({ start: i, end: i + needle.length });
    i += needle.length - 1;
  }
  return found;
}

export function findCodePoint(text, quote) {
  return findAllCodePoints(text, quote)[0] || null;
}

export function validSpan(text, start, end, expected) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return false;
  const chars = Array.from(text);
  if (end > chars.length) return false;
  if (typeof expected === "string" && expected.length > 0) {
    return chars.slice(start, end).join("") === expected;
  }
  return true;
}

export function locateSpan(text, start, end, expected) {
  const quote = typeof expected === "string" ? expected : "";
  if (quote && validSpan(text, start, end, quote)) {
    return { start, end, aligned: true, realigned: false };
  }
  if (!quote && validSpan(text, start, end)) {
    return { start, end, aligned: true, realigned: false };
  }
  if (quote && Number.isInteger(start) && Number.isInteger(end) && end > start && text.slice(start, end) === quote) {
    const cpStart = Array.from(text.slice(0, start)).length;
    const cpEnd = cpStart + Array.from(quote).length;
    return { start: cpStart, end: cpEnd, aligned: true, realigned: true };
  }
  if (quote) {
    const matches = findAllCodePoints(text, quote);
    if (matches.length === 1) {
      return { start: matches[0].start, end: matches[0].end, aligned: true, realigned: true };
    }
  }
  return { start: start ?? null, end: end ?? null, aligned: false, realigned: false };
}

export function isMostlyRtl(text) {
  let rtl = 0;
  let letters = 0;
  for (const ch of Array.from(text)) {
    if (!/\p{L}/u.test(ch)) continue;
    letters += 1;
    if (/\p{Script=Arabic}/u.test(ch)) rtl += 1;
  }
  return letters > 0 && rtl / letters >= 0.3;
}

export function segments(text, highlights) {
  const chars = Array.from(text);
  const n = chars.length;
  const points = new Set([0, n]);
  const usable = [];
  for (const highlight of highlights || []) {
    if (!highlight || highlight.aligned === false) continue;
    if (!Number.isInteger(highlight.start) || !Number.isInteger(highlight.end)) continue;
    if (highlight.start < 0 || highlight.end > n || highlight.start >= highlight.end) continue;
    points.add(highlight.start);
    points.add(highlight.end);
    usable.push(highlight);
  }
  const bounds = [...points].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    parts.push({
      start,
      end,
      text: chars.slice(start, end).join(""),
      tags: usable.filter((highlight) => highlight.start <= start && highlight.end >= end),
    });
  }
  if (!parts.length) parts.push({ start: 0, end: n, text: chars.join(""), tags: [] });
  return parts;
}

export function applyMask(text, spans, keep = 2) {
  const chars = Array.from(text);
  const ordered = [...spans]
    .filter((span) => Number.isInteger(span.start) && Number.isInteger(span.end) && span.end > span.start)
    .sort((a, b) => b.start - a.start);
  for (const span of ordered) {
    const slice = chars.slice(span.start, span.end);
    if (!slice.length) continue;
    const masked = slice.map((ch, index) => {
      if (slice.length <= keep) return "•";
      return index >= slice.length - keep ? ch : "•";
    });
    chars.splice(span.start, slice.length, ...masked);
  }
  return chars.join("");
}

export function collectHighlights(text, norm) {
  const highlights = [];
  const entities = norm.protect?.ok && Array.isArray(norm.protect.result?.entities) ? norm.protect.result.entities : [];
  for (const entity of entities) {
    const quote = typeof entity.value === "string" ? entity.value : "";
    const located = locateSpan(text, entity.start, entity.end, quote);
    highlights.push({
      channel: "pii",
      label: entity.type || "pii",
      confidence: typeof entity.confidence === "number" ? entity.confidence : null,
      quote,
      ...located,
    });
  }
  const guardEvidence = norm.guard?.ok && Array.isArray(norm.guard.result?.evidence) ? norm.guard.result.evidence : [];
  for (const item of guardEvidence) {
    const quote = item.quote || item.line || "";
    const located = locateSpan(text, item.start, item.end, quote);
    highlights.push({
      channel: "injection",
      label: "injection",
      confidence: typeof item.confidence === "number" ? item.confidence : null,
      quote,
      ...located,
    });
  }
  const scriptEvidence =
    norm.inspect?.ok && !norm.inspect.notApplicable && Array.isArray(norm.inspect.result?.evidence)
      ? norm.inspect.result.evidence
      : [];
  for (const item of scriptEvidence) {
    const quote = item.line || item.quote || "";
    const located = locateSpan(text, item.start, item.end, quote);
    highlights.push({
      channel: "script",
      label: "script",
      confidence: typeof item.confidence === "number" ? item.confidence : null,
      quote,
      ...located,
    });
  }
  return highlights;
}
