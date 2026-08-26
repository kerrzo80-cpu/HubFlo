#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.NEXA_E2E_BASE_URL || "http://127.0.0.1:3000";
const OUT = process.env.NEXA_E2E_OUT || "/opt/cursor/artifacts/e2e";
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
function note(level, message, extra = {}) {
  const row = { at: new Date().toISOString(), level, message, ...extra };
  findings.push(row);
  console.log(`[${level}] ${message}${extra.detail ? ` — ${extra.detail}` : ""}`);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function shot(page, name) {
  const file = path.join(OUT, `${String(findings.length).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  note("shot", name, { file });
  return file;
}

async function waitForText(page, text, timeout = 60000) {
  await page.waitForFunction(
    (needle) => (document.body?.innerText || "").includes(needle),
    { timeout },
    text,
  );
}

async function clickByText(page, text, { timeout = 12000 } = {}) {
  const handle = await page.waitForFunction(
    (needle) => {
      const nodes = Array.from(document.querySelectorAll("button, a, [role='tab'], label"));
      return (
        nodes.find((el) => ((el.textContent || "").replace(/\s+/g, " ").trim().includes(needle))) || null
      );
    },
    { timeout },
    text,
  );
  const el = await handle.asElement();
  await el.click();
}

async function setReactInput(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.focus(selector);
  await page.evaluate((sel) => {
    const input = document.querySelector(sel);
    if (!input) return;
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, selector);
  await page.type(selector, value, { delay: 15 });
}

async function dismiss(page) {
  await page.keyboard.press("Escape").catch(() => {});
}

async function main() {
  note("info", `Base URL ${BASE}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,1100"],
    defaultViewport: { width: 1440, height: 1100 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (err) => note("issue", "Page error", { detail: err.message.slice(0, 400) }));

  try {
    const user = process.env.NEXA_E2E_USER || "brian.kerr";
    const pass = process.env.NEXA_E2E_PASSWORD || "EWG2026";

    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
    await shot(page, "01-loading-or-login");

    // Secure /login gate (live)
    if (page.url().includes("/login") || (await page.content()).includes("Secure workspace")) {
      note("info", `Secure login as ${user}`);
      await setReactInput(page, 'input[autocomplete="username"]', user);
      await setReactInput(page, 'input[type="password"]', pass);
      await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {}),
      ]);
      await sleep(1500);
      await shot(page, "01b-after-secure-login");
    }

    // Wait past loading shell
    await page.waitForFunction(
      () => !(document.body?.innerText || "").includes("Loading NeXa workspace"),
      { timeout: 120000 },
    );
    await sleep(800);
    await shot(page, "02-after-load");

    if ((await page.content()).includes("Sign in to continue")) {
      note("info", "Employee login shell — selecting Brian Kerr card / credentials");
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const brian = buttons.find((b) => (b.textContent || "").includes("Brian Kerr"));
        brian?.click();
      });
      await sleep(300);
      const userField = await page.$('input[autocomplete="username"]');
      if (userField) {
        const current = await page.evaluate((el) => el.value, userField);
        if (!current) await setReactInput(page, 'input[autocomplete="username"]', user);
      }
      await setReactInput(page, 'input[type="password"]', pass);
      await page.click('button.primary-button[type="submit"], button[type="submit"]');
      await waitForText(page, "Dashboard", 90000).catch(() => {});
      await sleep(1200);
      await shot(page, "03-dashboard");
      if ((await page.content()).includes("Sign in to continue")) {
        note("issue", "Still on employee login after credentials");
        await setReactInput(page, 'input[autocomplete="username"]', user);
        await setReactInput(page, 'input[type="password"]', pass);
        await page.click('button.primary-button[type="submit"], button[type="submit"]');
        await sleep(2000);
        await shot(page, "03b-login-retry");
      }
    }

    const body = await page.evaluate(() => document.body.innerText);
    if (body.includes("Sign in to continue") || body.includes("Loading NeXa workspace")) {
      note("issue", "Could not enter Core workspace");
      throw new Error("Blocked at login/loading");
    }

    const modules = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".module-link, .module-dropdown-trigger")).map((el) =>
        (el.textContent || "").replace(/\s+/g, " ").trim(),
      ),
    );
    note("info", "Modules", { detail: modules.join(" | ") });
    for (const required of ["Dashboard", "Leads", "Quotes", "Jobs", "Invoices", "Stock", "Recurring", "Schedules", "POs", "Reports", "People", "Setup"]) {
      if (!modules.some((m) => m.includes(required))) note("issue", `Missing module: ${required}`);
    }

    // Probe jitter / overflow
    const metrics = await page.evaluate(async () => {
      const samples = [];
      const start = performance.now();
      while (performance.now() - start < 1000) {
        samples.push(performance.now());
        await new Promise((r) => requestAnimationFrame(r));
      }
      const deltas = [];
      for (let i = 1; i < samples.length; i++) deltas.push(samples[i] - samples[i - 1]);
      return {
        avgFrameMs: Number((deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2)),
        maxFrameMs: Number(Math.max(...deltas).toFixed(2)),
        longFrames: deltas.filter((d) => d > 32).length,
        overflow: document.body.scrollWidth - window.innerWidth,
        animated: Array.from(document.querySelectorAll("*")).filter((el) => {
          const s = getComputedStyle(el);
          return s.animationName !== "none" || (s.transitionDuration && s.transitionDuration !== "0s");
        }).length,
      };
    });
    note("info", "Jitter probe", { detail: JSON.stringify(metrics) });
    if (metrics.maxFrameMs > 50 || metrics.longFrames > 10) note("issue", "Jittery dashboard frames", { detail: JSON.stringify(metrics) });
    if (metrics.overflow > 8) note("issue", "Horizontal overflow", { detail: String(metrics.overflow) });

    async function openModule(label) {
      await dismiss(page);
      await clickByText(page, label);
      await sleep(900);
    }

    // Clients
    await openModule("People");
    await sleep(200);
    await clickByText(page, "Clients");
    await sleep(1000);
    await shot(page, "04-clients");

    // Create lead
    await openModule("Leads");
    await sleep(600);
    await shot(page, "05-leads");
    try {
      await clickByText(page, "New lead");
      await sleep(1000);
      await shot(page, "06-lead-create");
      // Fill customer if fields exist
      const filled = await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll("label"));
        const set = (labelText, value) => {
          const label = labels.find((l) => (l.textContent || "").toLowerCase().includes(labelText));
          if (!label) return false;
          const input = label.querySelector("input, textarea");
          if (!input) return false;
          const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          setter?.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        };
        return {
          customer: set("customer", "E2E Test Customer"),
          contact: set("contact", "Test Contact"),
          description: set("description", "E2E boiler replacement survey"),
        };
      });
      note("info", "Lead form fill", { detail: JSON.stringify(filled) });
      await shot(page, "07-lead-filled");
    } catch (error) {
      note("issue", "Lead create UI failed", { detail: String(error.message || error) });
    }

    // Quotes / takeoff entry
    await openModule("Quotes");
    await sleep(800);
    await shot(page, "08-quotes");
    // Open first quote if present
    const openedQuote = await page.evaluate(() => {
      const row = document.querySelector(".quote-row.clickable, article.quote-row.clickable, .record-folder-section .quote-row");
      if (!row) return false;
      row.click();
      return true;
    });
    if (openedQuote) {
      await sleep(1200);
      await shot(page, "09-quote-record");
      // Look for takeoff / survey tools tabs
      const tabs = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button, [role='tab']"))
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 40),
      );
      note("info", "Quote tabs/buttons sample", { detail: tabs.slice(0, 25).join(" | ") });
    } else {
      note("warn", "No quote rows to open");
    }

    // Jobs
    await openModule("Jobs");
    await sleep(800);
    await shot(page, "10-jobs");
    const openedJob = await page.evaluate(() => {
      const row = document.querySelector(".quote-row.clickable, article.quote-row.clickable");
      if (!row) return false;
      row.click();
      return true;
    });
    if (openedJob) {
      await sleep(1200);
      await shot(page, "11-job-record");
    }

    // Schedule
    await openModule("Schedules");
    await sleep(1000);
    await shot(page, "12-schedule");

    // Invoices + Xero
    await openModule("Invoices");
    await sleep(1000);
    await shot(page, "13-invoices");
    const openedInvoice = await page.evaluate(() => {
      const row = document.querySelector(".quote-row.clickable, article.quote-row.clickable");
      if (!row) return false;
      row.click();
      return true;
    });
    if (openedInvoice) {
      await sleep(1200);
      await shot(page, "14-invoice-record");
      const text = await page.evaluate(() => document.body.innerText);
      if (!text.includes("Xero")) note("issue", "Invoice missing Xero handoff");
      if (!text.includes("Export to Xero") && !text.includes("Xero export")) note("issue", "Invoice missing Export to Xero button");
      // Try part-paid amount field presence
      if (!text.includes("Payment amount") && !text.includes("Mark part paid")) {
        note("issue", "Invoice payment controls incomplete");
      }
    }

    // Stock / Recurring / Reports WIP / POs / Setup
    for (const [label, file] of [
      ["Stock", "15-stock"],
      ["Recurring", "16-recurring"],
      ["POs", "17-pos"],
      ["Reports", "18-reports"],
      ["Setup", "19-setup"],
    ]) {
      try {
        await openModule(label);
        await sleep(800);
        await shot(page, file);
        if (label === "Reports") {
          await clickByText(page, "WIP");
          await sleep(700);
          await shot(page, "18b-wip");
        }
        if (label === "Stock") {
          const text = await page.evaluate(() => document.body.innerText);
          if (!text.includes("Warehouse")) note("issue", "Stock module missing Warehouse location");
        }
        if (label === "Recurring") {
          const text = await page.evaluate(() => document.body.innerText);
          if (!text.includes("Recurring")) note("issue", "Recurring panel did not render");
        }
      } catch (error) {
        note("issue", `Module failed: ${label}`, { detail: String(error.message || error) });
      }
    }

    // Addon routes
    for (const route of ["/takeoff", "/survey", "/heat-design", "/ai-intake"]) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(1200);
      await shot(page, `addon-${route.replace(/\W+/g, "_")}`);
      note("info", `Opened ${route}`, { detail: await page.title() });
    }
  } catch (error) {
    note("issue", "Fatal e2e failure", { detail: String(error.stack || error).slice(0, 800) });
    try {
      await shot(page, "fatal");
    } catch {
      /* ignore */
    }
  } finally {
    await fs.promises.writeFile(path.join(OUT, "findings.json"), JSON.stringify(findings, null, 2));
    await browser.close();
  }

  const issues = findings.filter((f) => f.level === "issue");
  console.log(`\nDone. ${issues.length} issues. Artifacts in ${OUT}`);
  process.exit(issues.length ? 1 : 0);
}

main();
