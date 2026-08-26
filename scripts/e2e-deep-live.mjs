#!/usr/bin/env node
/**
 * Deep live ops walk: login → clients/sites → open quote/job → schedule → invoice Xero → stock/recurring.
 * Credentials via env only.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.NEXA_E2E_BASE_URL || "https://nexa-live.onrender.com";
const USER = process.env.NEXA_E2E_USER || "brian.kerr";
const PASS = process.env.NEXA_E2E_PASSWORD || "";
const OUT = process.env.NEXA_E2E_OUT || "/opt/cursor/artifacts/e2e-deep";
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
const note = (level, message, extra = {}) => {
  findings.push({ at: new Date().toISOString(), level, message, ...extra });
  console.log(`[${level}] ${message}${extra.detail ? ` — ${extra.detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(page, name) {
  const file = path.join(OUT, `${String(findings.length).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  note("shot", name, { file });
}
async function bodyText(page) {
  return page.evaluate(() => document.body?.innerText || "");
}
async function clickText(page, text, timeout = 15000) {
  const handle = await page.waitForFunction(
    (needle) => {
      const nodes = Array.from(document.querySelectorAll("button, a, [role='tab'], .module-link, .module-dropdown-trigger"));
      return nodes.find((el) => ((el.textContent || "").replace(/\s+/g, " ").trim().includes(needle))) || null;
    },
    { timeout },
    text,
  );
  await (await handle.asElement()).click();
}
async function typeReact(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.focus(selector);
  await page.evaluate((sel) => {
    const input = document.querySelector(sel);
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, selector);
  await page.type(selector, value, { delay: 12 });
}

async function main() {
  if (!PASS) throw new Error("NEXA_E2E_PASSWORD required");
  const browser = await puppeteer.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,1100"],
    defaultViewport: { width: 1440, height: 1100 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (err) => note("issue", "Page error", { detail: err.message.slice(0, 300) }));

  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await typeReact(page, 'input[autocomplete="username"]', USER);
    await typeReact(page, 'input[type="password"]', PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {}),
    ]);
    await page.waitForFunction(() => !(document.body?.innerText || "").includes("Loading NeXa workspace"), { timeout: 120000 });
    await sleep(1500);
    await shot(page, "01-dashboard");

    // Clients / sites
    await clickText(page, "People");
    await sleep(300);
    await clickText(page, "Clients");
    await sleep(1500);
    await shot(page, "02-clients");
    const clientsText = await bodyText(page);
    const sitesMatch = clientsText.match(/(\d+)\s+client accounts and\s+(\d+)\s+live sites/);
    if (!sitesMatch || Number(sitesMatch[2]) < 1) note("issue", "Clients still show zero live sites", { detail: sitesMatch?.join(",") || "no match" });
    else note("info", "Clients/sites OK", { detail: `${sitesMatch[1]} clients / ${sitesMatch[2]} sites` });

    // Open first client
    const openedClient = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").includes("Open client record"));
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (openedClient) {
      await sleep(1500);
      await shot(page, "03-client-record");
      const t = await bodyText(page);
      if (!/site/i.test(t)) note("issue", "Client record missing sites section cues");
    } else note("issue", "Could not open a client record");

    // Quotes directory + open first
    await clickText(page, "Quotes");
    await sleep(1500);
    await shot(page, "04-quotes");
    let opened = await page.evaluate(() => {
      const row = document.querySelector(".quote-row.clickable, article.quote-row.clickable");
      if (!row) return false;
      row.click();
      return true;
    });
    if (!opened) {
      // try any quote ref button
      opened = await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll("button, a, .quote-row")).find((n) => /Q-\d+|Open/i.test(n.textContent || ""));
        el?.click();
        return Boolean(el);
      });
    }
    if (opened) {
      await sleep(2000);
      await shot(page, "05-quote-record");
      const tabs = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button, [role='tab']"))
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 50),
      );
      note("info", "Quote UI sample", { detail: tabs.slice(0, 30).join(" | ") });
      // Try cost centre / takeoff related controls
      for (const label of ["Cost build", "Takeoff", "Survey", "Catalogue", "Convert", "Create job", "Accept"]) {
        const has = tabs.some((t) => t.toLowerCase().includes(label.toLowerCase())) || (await bodyText(page)).toLowerCase().includes(label.toLowerCase());
        if (has) note("info", `Quote has control cue: ${label}`);
      }
    } else {
      note("issue", "No quote available to open on live");
    }

    // Jobs
    await clickText(page, "Jobs");
    await sleep(1500);
    await shot(page, "06-jobs");
    opened = await page.evaluate(() => {
      const row = document.querySelector(".quote-row.clickable, article.quote-row.clickable");
      if (!row) return false;
      row.click();
      return true;
    });
    if (opened) {
      await sleep(2000);
      await shot(page, "07-job-record");
      // Assets tab via cost centre if present
      const hasAssets = (await bodyText(page)).includes("Assets") || (await bodyText(page)).includes("Customer Assets");
      note("info", hasAssets ? "Job UI mentions Assets" : "Job UI has no Assets cue yet");
    } else note("warn", "No job row to open");

    // Schedule
    await clickText(page, "Schedules");
    await sleep(1500);
    await shot(page, "08-schedule");

    // Invoices
    await clickText(page, "Invoices");
    await sleep(1500);
    await shot(page, "09-invoices");
    opened = await page.evaluate(() => {
      const row = document.querySelector(".quote-row.clickable, article.quote-row.clickable");
      if (!row) return false;
      row.click();
      return true;
    });
    if (opened) {
      await sleep(2000);
      await shot(page, "10-invoice-record");
      const t = await bodyText(page);
      if (!t.includes("Xero")) note("issue", "Invoice missing Xero section");
      if (!t.includes("Export to Xero") && !t.includes("Re-export to Xero")) note("issue", "Invoice missing Export to Xero");
      if (!t.includes("Payment amount") && !t.includes("Mark part paid")) note("issue", "Invoice payment controls incomplete");
    } else note("warn", "No invoice row to open");

    // Stock / Recurring / Reports WIP
    await clickText(page, "Stock");
    await sleep(2000);
    await shot(page, "11-stock");
    {
      const t = await bodyText(page);
      if (!t.includes("Warehouse")) note("issue", "Stock panel missing Warehouse");
      else note("info", "Stock Warehouse visible");
    }

    await clickText(page, "Recurring");
    await sleep(2000);
    await shot(page, "12-recurring");

    await clickText(page, "Reports");
    await sleep(1500);
    await shot(page, "13-reports");
    try {
      await clickText(page, "WIP", 8000);
      await sleep(1000);
      await shot(page, "14-wip");
      note("info", "WIP tab opened");
    } catch (error) {
      note("issue", "WIP tab failed", { detail: String(error.message || error) });
    }

    // Lead create: open, verify Save not covered, cancel
    await clickText(page, "Leads");
    await sleep(1000);
    await clickText(page, "New lead");
    await sleep(1200);
    await shot(page, "15-lead-create");
    const saveOk = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const save = buttons.find((b) => /^\s*Save\s*$/i.test((b.textContent || "").trim()));
      if (!save) return { found: false };
      const r = save.getBoundingClientRect();
      const center = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        found: true,
        topElement: center ? `${center.tagName}.${center.className}`.slice(0, 120) : null,
        coveredByBlake: Boolean(center?.closest?.(".buddy-dock, .buddy-launcher, .blake-character")),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      };
    });
    note("info", "Save hit-test", { detail: JSON.stringify(saveOk) });
    if (saveOk.coveredByBlake) note("issue", "Save still covered by Blake dock");
    await clickText(page, "Cancel");
    await sleep(800);

    // Add-ons
    for (const route of ["/takeoff", "/survey"]) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await sleep(1500);
      await shot(page, `addon-${route.replace(/\W+/g, "_")}`);
      note("info", `Opened ${route}`, { detail: await page.title() });
    }
  } catch (error) {
    note("issue", "Fatal", { detail: String(error.stack || error).slice(0, 800) });
    try {
      await shot(page, "fatal");
    } catch {
      /* ignore */
    }
  } finally {
    fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify(findings, null, 2));
    await browser.close();
  }
  const issues = findings.filter((f) => f.level === "issue");
  console.log(`\nDone. ${issues.length} issues.`);
  process.exit(issues.length ? 1 : 0);
}

main();
