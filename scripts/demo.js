#!/usr/bin/env node
// Records a 1280x720 live walkthrough. Refuses to run unless the server is in live mode.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.GATEKEEPER_URL || "http://127.0.0.1:8787";
const videoDir = path.resolve("videos");
const shotDir = path.resolve("docs/screenshots");
fs.mkdirSync(videoDir, { recursive: true });
fs.mkdirSync(shotDir, { recursive: true });

const steps = [
  ["benign-email", "pass", 5500, null],
  ["pii-email", "pass", 8000, "pass-masked-email.png"],
  ["injection-page", "quarantine", 8500, "quarantine-injection.png"],
  ["benign-script", "pass", 5500, null],
  ["sketchy-script", "quarantine", 8500, "quarantine-script.png"],
  ["arabic-pii", "pass", 8000, null],
  ["borderline-note", "ask", 8500, "ask-human.png"],
];

const health = await fetch(`${base}/api/health`).then((res) => res.json());
if (health.mode !== "live") {
  console.error(`Refusing to record. Server mode is ${health.mode}. Start it with CLOCKED_API_KEY set and without CLOCKED_MODE=fixture.`);
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
let failed = null;
try {
  await page.goto(base, { waitUntil: "networkidle" });
  const badge = (await page.locator("#mode").innerText()).trim();
  if (!/live/i.test(badge)) throw new Error(`Badge is ${badge}, expected Live.`);
  await page.evaluate(() => fetch("/api/audit", { method: "DELETE" }));
  await page.waitForTimeout(2200);
  for (const [id, decision, hold, shot] of steps) {
    await page.click(`[data-sample="${id}"]`);
    await page.waitForTimeout(1000);
    await page.click("[data-action='screen']");
    await page.waitForSelector(`#stage[data-state="ready"] h2[data-decision="${decision}"]`, { timeout: 90_000 });
    const meta = await page.locator(".banner .meta").innerText();
    if (!/credit/i.test(meta)) throw new Error(`${id} finished without a credit line: ${meta}`);
    if (shot) {
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(shotDir, shot) });
    }
    console.log(`${id} ${decision} ${meta.replace(/\s+/g, " ")}`);
    await page.waitForTimeout(hold);
  }
  await page.waitForTimeout(2200);
} catch (error) {
  failed = error;
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) {
    const recorded = await video.path();
    const target = path.join(videoDir, "gatekeeper-live.webm");
    fs.copyFileSync(recorded, target);
    console.log(failed ? `kept failed recording at ${target}` : `webm ${target}`);
  }
}
if (failed) {
  console.error(failed.message || failed);
  process.exit(1);
}
