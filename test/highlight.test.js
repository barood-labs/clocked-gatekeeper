import assert from "node:assert/strict";
import test from "node:test";
import { applyMask, findCodePoint, isMostlyRtl, locateSpan, segments, sliceCodePoints } from "../src/highlight.js";

test("code point slices keep Arabic names and emoji intact", () => {
  const text = "هاتف فاطمة 😀";
  const span = findCodePoint(text, "فاطمة");
  assert.ok(span);
  assert.equal(sliceCodePoints(text, span.start, span.end), "فاطمة");
  const emoji = findCodePoint(text, "😀");
  assert.equal(sliceCodePoints(text, emoji.start, emoji.end), "😀");
  assert.notEqual(text.slice(emoji.start, emoji.start + 1), "😀");
  assert.equal(isMostlyRtl("مرحباً، أنا فاطمة"), true);
  assert.equal(isMostlyRtl("Hello Jordan"), false);
});

test("segments split overlapping channels and the mask keeps two trailing characters", () => {
  const text = "ab SECRET cd";
  const parts = segments(text, [
    { start: 3, end: 9, channel: "pii", aligned: true },
    { start: 7, end: 12, channel: "injection", aligned: true },
  ]);
  const tagged = parts.filter((part) => part.tags.length);
  assert.equal(tagged[0].text, "SECR");
  assert.equal(tagged[0].tags.length, 1);
  assert.equal(tagged[1].text, "ET");
  assert.equal(tagged[1].tags.length, 2);
  assert.equal(applyMask("Name Jordan Hale", [{ start: 5, end: 16 }], 2), "Name •••••••••le");
});

test("a unique quote is relocated when the offset was counted in the wrong units", () => {
  const text = "مرحبا فاطمة";
  const span = findCodePoint(text, "فاطمة");
  const utf16Start = text.indexOf("فاطمة");
  const located = locateSpan(text, utf16Start, utf16Start + "فاطمة".length, "فاطمة");
  assert.equal(located.aligned, true);
  assert.deepEqual([located.start, located.end], [span.start, span.end]);
});
