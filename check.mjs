// Headless reproduction — starts the dev server, performs the SPA navigation
// with a real (headless) Chromium, and reports the failure.
//
//   pnpm repro
//
// The race depends on Qwik's internal chore scheduling (perturbed by its
// probabilistic chunk preloader), so a single navigation doesn't always hit
// it. Each attempt loads "/" fresh and SPA-navigates once; the script stops
// at the first crash. In our runs it typically fires within a few attempts.
//
// Chromium resolution: set PLAYWRIGHT_CHROMIUM_PATH to a Chromium binary, or
// install one with `pnpm exec playwright-core install chromium` first.
// Exits non-zero when the bug is present.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { utimesSync } from "node:fs";

const PORT = 5198;
const BASE = `http://localhost:${PORT}`;
const ATTEMPTS = Number(process.env.ATTEMPTS ?? 3);
// MODE=race  (default) — bug 1: resolveValue() returns undefined in head()
// MODE=crash          — bug 2 in isolation: head() that throws removes <head>
const MODE = process.env.MODE === "crash" ? "crash" : "race";

// --- start the dev server -------------------------------------------------
// detached: own process group, so we can kill vite itself (not just the
// wrapper) — a leaked warm server masks the bug on subsequent runs.
const server = spawn(
  "npx",
  ["vite", "--mode", "ssr", "--port", String(PORT), "--strictPort"],
  { stdio: "ignore", detached: true },
);
const stopServer = () => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
};
process.on("exit", stopServer);

const deadline = Date.now() + 30_000;
for (;;) {
  try {
    const res = await fetch(BASE + "/");
    if (res.ok) break;
  } catch {
    /* not up yet */
  }
  if (Date.now() > deadline) {
    console.error("dev server did not start within 30s");
    process.exit(2);
  }
  await new Promise((r) => setTimeout(r, 250));
}

// --- drive the browser ----------------------------------------------------
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(
  executablePath ? { executablePath } : {},
);

let reproduced = false;

for (let attempt = 1; attempt <= ATTEMPTS && !reproduced; attempt++) {
  if (MODE === "race") {
    // The race only fires when the route's client modules need a fresh
    // transform during the SPA navigation (cold dev-server cache). Touching
    // the files invalidates the transform cache between attempts — exactly
    // what editing a file (or restarting the server) does in real usage.
    const now = new Date();
    utimesSync("src/routes/other/index.tsx", now, now);
    utimesSync("src/routes/index.tsx", now, now);
    await new Promise((r) => setTimeout(r, 300));
  }

  const page = await browser.newPage();
  const errors = [];
  let sawUndefined = false;
  page.on("pageerror", (err) => errors.push(String(err).split("\n")[0]));
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("head]") && text.includes("undefined")) {
      sawUndefined = true;
    }
    if (msg.type() === "error" && !text.startsWith("Failed to load resource")) {
      errors.push(text.split("\n")[0]);
    }
  });

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  await page.evaluate(() => ((window.__spa_marker = true), undefined));
  if (MODE === "crash") {
    // Bug 2 in isolation: a single SPA navigation to a route whose head()
    // throws. Deterministic — no timing involved.
    await page
      .evaluate(() => document.querySelector('a[href="/crash/"]')?.click())
      .catch(() => {});
    await page.waitForTimeout(2000);
  } else {
    // Navigate back and forth — every SPA navigation in either direction is
    // one chance to hit the scheduling race. Click WITHOUT hovering first
    // (like a tap on a touch device); hovering triggers the Link's "intent"
    // data-prefetch, which can mask the race.
    for (let nav = 0; nav < 6 && !sawUndefined; nav++) {
      const href = nav % 2 === 0 ? "/other/" : "/";
      await page
        .evaluate((h) => document.querySelector(`a[href="${h}"]`)?.click(), href)
        .catch(() => {});
      await page.waitForTimeout(1200);
    }
  }

  const wasSpaNav = await page
    .evaluate(() => window.__spa_marker === true)
    .catch(() => false);
  const headNull = await page
    .evaluate(() => document.head === null)
    .catch(() => false);
  const title = await page.title().catch(() => "(unavailable)");

  const crashed =
    headNull === true ||
    sawUndefined ||
    errors.some((e) => e.includes("Invalid URL")) ||
    errors.some((e) => e.includes("deliberate error in head()")) ||
    errors.some((e) => e.includes("appendChild"));

  console.log(
    `attempt ${attempt}: spaNav=${wasSpaNav} resolveValueUndefined=${sawUndefined} ` +
      `headNull=${headNull} errors=${errors.length} title=${JSON.stringify(title)}`,
  );

  if (crashed && wasSpaNav) {
    reproduced = true;
    console.log("\n  unique errors:");
    for (const e of [...new Set(errors)].slice(0, 5)) {
      console.log("   -", e);
    }
  }
  await page.close();
}

await browser.close();
stopServer();

console.log(
  reproduced
    ? MODE === "crash"
      ? "\nBUG REPRODUCED: an exception thrown in head() during SPA navigation removed <head> and wedged QRL loading."
      : "\nBUG REPRODUCED: resolveValue() returned undefined in head() during SPA navigation; the resulting exception removed <head> and wedged QRL loading."
    : `\nNo failure in ${ATTEMPTS} attempts — bug appears fixed in these versions.`,
);
process.exit(reproduced ? 1 : 0);
