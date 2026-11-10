// Backend client for https://clocked.rezolve.ai/clocked
// The API key is sent as a bearer token and is never logged.

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function scrub(value, secret) {
  const text = String(value ?? "");
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

export function backoffMs(attempt) {
  const table = [200, 600, 1400];
  const base = table[Math.min(Math.max(attempt, 1) - 1, table.length - 1)];
  return base + Math.floor(Math.random() * 80);
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase());
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return found ? headers[found] : null;
}

function usageFrom(headers) {
  return {
    modelMs: headerGet(headers, "x-clocked-model-ms"),
    credits: headerGet(headers, "x-clocked-credits"),
    costUsd: headerGet(headers, "x-clocked-cost-usd"),
    costBasis: headerGet(headers, "x-clocked-cost-basis"),
    transport: headerGet(headers, "x-clocked-transport"),
  };
}

function messageFrom(json, status) {
  if (!json || typeof json !== "object") return `Clocked returned HTTP ${status}.`;
  if (typeof json.error === "string" && json.error) return json.error;
  if (typeof json.message === "string" && json.message) return json.message;
  if (typeof json.detail === "string" && json.detail) return json.detail;
  if (Array.isArray(json.detail)) {
    const parts = json.detail.map((item) => item?.msg || item?.message).filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return `Clocked returned HTTP ${status}.`;
}

export async function clockedPost({
  path,
  body,
  apiKey,
  baseUrl = "https://clocked.rezolve.ai/clocked",
  fetchImpl = globalThis.fetch,
  timeoutMs = 60_000,
  maxAttempts = 3,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  idempotencyKey = crypto.randomUUID(),
  log = () => {},
} = {}) {
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      attempts: 0,
      usage: null,
      requestId: null,
      message: "CLOCKED_API_KEY is not set.",
      error: "missing-key",
    };
  }
  if (!UUID_V4.test(idempotencyKey)) {
    return {
      ok: false,
      status: 0,
      attempts: 0,
      usage: null,
      requestId: null,
      message: "Idempotency-Key must be a UUID v4.",
      error: "bad-key",
    };
  }
  const payload = JSON.stringify(body);
  const url = `${baseUrl}${path}`;
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "User-Agent": "gatekeeper/1.0",
        },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await response.text();
      let json = {};
      if (raw) {
        try {
          json = JSON.parse(raw);
        } catch {
          json = { error: scrub(raw.slice(0, 300), apiKey) };
        }
      }
      log({ event: "response", attempt, status: response.status });
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          json,
          attempts: attempt,
          usage: usageFrom(response.headers),
          requestId: idempotencyKey,
        };
      }
      const retryAsNew = json?.retryAsNew === true;
      const retryable = !retryAsNew && (RETRY_STATUSES.has(response.status) || response.status === 409);
      last = {
        ok: false,
        status: response.status,
        json,
        attempts: attempt,
        retryAsNew,
        usage: usageFrom(response.headers),
        requestId: idempotencyKey,
        message: scrub(messageFrom(json, response.status), apiKey),
      };
      if (!retryable || attempt === maxAttempts) return last;
      const retryAfter = headerGet(response.headers, "retry-after");
      let wait = backoffMs(attempt);
      if (retryAfter && /^\d+$/.test(String(retryAfter).trim())) {
        wait = Math.min(Number(retryAfter) * 1000, 5000);
      }
      await sleep(wait);
    } catch (error) {
      const name = error?.name || "Error";
      log({ event: "transport-error", attempt, name });
      const timedOut = name === "TimeoutError" || name === "AbortError";
      last = {
        ok: false,
        status: 0,
        attempts: attempt,
        retryAsNew: false,
        usage: null,
        requestId: idempotencyKey,
        error: "transport",
        message: timedOut
          ? "The Clocked request timed out."
          : "The Clocked request failed before a response arrived.",
      };
      if (attempt === maxAttempts) return last;
      await sleep(backoffMs(attempt));
    }
  }
  return last;
}
