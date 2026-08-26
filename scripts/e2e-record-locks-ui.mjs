#!/usr/bin/env node
/** Puppeteer UI test: read-only banner when second user opens same quote (API cookie auth). */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = (process.env.NEXA_E2E_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const OUT = process.env.NEXA_E2E_OUT || "/opt/cursor/artifacts/e2e-record-locks-ui";
fs.mkdirSync(OUT, { recursive: true });

const USER_A = process.env.NEXA_E2E_USER || "brian.kerr";
const PASS_A = process.env.NEXA_E2E_PASSWORD || "TestAdminPass123!X";
const USER_B = process.env.NEXA_E2E_USER_B || "test.lockviewer";
const PASS_B = process.env.NEXA_E2E_PASSWORD_B || "LockViewerPass123!X";

function apiLogin(username, password) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ username, password });
    const req = http.request(
      `${BASE}/api/auth/login`,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const setCookie = res.headers["set-cookie"] || [];
          const match = setCookie.find((c) => c.startsWith("nexa_session="));
          if (!match) return reject(new Error(`No session cookie for ${username}`));
          resolve(match.split(";")[0]);
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function setSessionCookie(page, cookiePair) {
  const value = cookiePair.split("=")[1];
  await page.setCookie({
    name: "nexa_session",
    value,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
  });
}

async function main() {
  const cookieA = await apiLogin(USER_A, PASS_A);
  const cookieB = await apiLogin(USER_B, PASS_B);

  const browser = await puppeteer.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,1000"],
    defaultViewport: { width: 1440, height: 1000 },
  });

  const ctxA = await browser.createBrowserContext();
  const ctxB = await browser.createBrowserContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await setSessionCookie(pageA, cookieA);
  await setSessionCookie(pageB, cookieB);

  await pageA.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pageB.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });

  const quoteId = await pageA.evaluate(async (base) => {
    const res = await fetch(`${base}/api/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        customer: "Lock Test Client",
        description: "Record lock UI E2E quote",
        status: "Draft",
        owner: "Brian Kerr",
      }),
    });
    return (await res.json()).id;
  }, BASE);
  if (!quoteId) throw new Error("Could not create test quote");

  const quotePath = `/quotes?quoteId=${encodeURIComponent(quoteId)}`;
  await pageA.goto(`${BASE}${quotePath}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pageA.waitForFunction(
    () => !(document.body?.innerText || "").includes("Loading NeXa workspace"),
    { timeout: 120000 },
  );
  await new Promise((r) => setTimeout(r, 4000));

  await pageB.goto(`${BASE}${quotePath}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pageB.waitForFunction(
    () => !(document.body?.innerText || "").includes("Loading NeXa workspace"),
    { timeout: 120000 },
  );
  await pageB.waitForFunction(
    () => /read-only/i.test(document.body?.innerText || ""),
    { timeout: 30000 },
  );

  const editorShot = path.join(OUT, "01_editor_user_a.png");
  const viewerShot = path.join(OUT, "02_viewer_read_only_banner.png");
  await pageA.screenshot({ path: editorShot, fullPage: false });
  await pageB.screenshot({ path: viewerShot, fullPage: false });

  const viewerText = await pageB.evaluate(() => document.body?.innerText || "");
  if (!/read-only/i.test(viewerText) || !/Brian Kerr/i.test(viewerText)) {
    throw new Error(`Viewer banner missing. Snippet: ${viewerText.slice(0, 400)}`);
  }

  const finishDisabled = await pageB.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("Save and finish"),
    );
    return btn?.disabled === true;
  });
  if (!finishDisabled) throw new Error("Save and finish should be disabled for read-only viewer");

  const editorHasBanner = await pageA.evaluate(() => /read-only/i.test(document.body?.innerText || ""));
  if (editorHasBanner) throw new Error("Editor should not see read-only banner");

  console.log("✅ UI record lock test passed");
  console.log(JSON.stringify({ editorShot, viewerShot, quoteId }, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error("UI test failed:", error);
  process.exit(1);
});
