import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SAMPLES } from "./samples.js";
import { standInResponse } from "./standin.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RECORDED_DIR = path.join(ROOT, "fixtures", "recorded");

export function textHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function loadRecorded(sampleId, dir = RECORDED_DIR) {
  const file = path.join(dir, `${sampleId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function fixtureFor(text, kind, dir = RECORDED_DIR) {
  const sample = SAMPLES.find((item) => item.text === text && item.kind === kind) || null;
  if (sample) {
    const recorded = loadRecorded(sample.id, dir);
    if (recorded?.response && recorded.textSha256 === textHash(text)) {
      return {
        assessment: "recorded-fixture",
        sampleId: sample.id,
        response: recorded.response,
        usage: recorded.usage || null,
      };
    }
  }
  const loose = SAMPLES.find((item) => item.text === text) || null;
  return {
    assessment: "offline-stand-in",
    sampleId: loose?.id || sample?.id || null,
    response: standInResponse(text, kind),
    usage: null,
  };
}
