#!/usr/bin/env node
/**
 * Ops hardening drill against live (or local):
 *  login → readiness → openai status/smoke → backup export/verify → restore dry-run
 *
 * Env: NEXA_E2E_BASE_URL, NEXA_E2E_USER, NEXA_E2E_PASSWORD
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const BASE = process.env.NEXA_E2E_BASE_URL || "https://nexa-live.onrender.com";
const USER = process.env.NEXA_E2E_USER || "brian.kerr";
const PASS = process.env.NEXA_E2E_PASSWORD || "";
const OUT = process.env.NEXA_E2E_OUT || "/opt/cursor/artifacts/ops-harden-drill";
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
const note = (level, message, extra = {}) => {
  findings.push({ at: new Date().toISOString(), level, message, ...extra });
  console.log(`[${level}] ${message}${extra.detail ? ` — ${extra.detail}` : ""}`);
};

function request(method, path, body, cookie) {
  const url = new URL(path, BASE);
  const lib = url.protocol === "https:" ? https : http;
  const payload = body === undefined || body === null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-hubflo-role": "Owner/Admin",
          "x-hubflo-employee-id": "emp-brian",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text.slice(0, 500) };
          }
          resolve({
            status: res.statusCode || 0,
            json,
            setCookie: res.headers["set-cookie"] || [],
            headers: res.headers,
            text,
          });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieFrom(setCookie) {
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  note("info", `Base ${BASE}`);
  let cookie = "";
  if (PASS) {
    const login = await request("POST", "/api/auth/login", { username: USER, password: PASS });
    if (login.status >= 400) {
      note("issue", "Login failed", { detail: JSON.stringify(login.json) });
      process.exit(2);
    }
    cookie = cookieFrom(login.setCookie);
    note("info", "Logged in", { detail: login.json?.user?.name || USER });
  } else if (/onrender\.com|nexa-live/i.test(BASE)) {
    note("issue", "NEXA_E2E_PASSWORD required for live ops drill");
    process.exit(2);
  } else {
    note("info", "No password — open/dev headers mode");
  }

  const health = await request("GET", "/api/health", null, cookie);
  note("info", "Health", {
    detail: `ok=${health.json?.ok} openai=${JSON.stringify(health.json?.openai)} ops=${health.json?.deployment?.opsHarden}`,
  });

  // Dual-path: /ai-first should redirect
  const aiFirst = await request("GET", "/ai-first", null, cookie);
  const loc = aiFirst.headers.location || "";
  if (aiFirst.status === 307 || aiFirst.status === 308 || aiFirst.status === 302) {
    note(loc.includes("ai-intake") ? "info" : "warn", "/ai-first redirect", {
      detail: `${aiFirst.status} → ${loc}`,
    });
  } else if (aiFirst.status === 200 && /ai-intake|redirect/i.test(aiFirst.text || "")) {
    note("info", "/ai-first served redirect page", { detail: String(aiFirst.status) });
  } else {
    note("warn", "/ai-first unexpected", { detail: String(aiFirst.status) });
  }

  const openai = await request("GET", "/api/integrations/openai", null, cookie);
  note("info", "OpenAI status", {
    detail: JSON.stringify({
      connected: openai.json?.connected,
      source: openai.json?.source,
      hasInAppKey: openai.json?.hasInAppKey,
    }),
  });

  const smoke = await request("POST", "/api/integrations/openai/smoke", {}, cookie);
  if (smoke.status >= 400 || !smoke.json?.ok) {
    note("warn", "OpenAI smoke not green", {
      detail: JSON.stringify(smoke.json).slice(0, 300),
    });
  } else {
    note("info", "OpenAI smoke OK", { detail: `${smoke.json.ms}ms · ${smoke.json.source}` });
  }

  const backup = await request("GET", "/api/prototype-backup?format=json", null, cookie);
  if (backup.status >= 400) {
    note("issue", "Backup export failed", { detail: JSON.stringify(backup.json).slice(0, 300) });
    process.exit(1);
  }
  fs.writeFileSync(`${OUT}/backup-sample.json`, JSON.stringify(backup.json, null, 2));
  note("info", "Backup exported", {
    detail: `${backup.json?.verification?.presentStoreCount}/${backup.json?.verification?.storeCount} stores · ${Math.round((backup.json?.verification?.totalBytes || 0) / 1024)} KB`,
  });

  const dryRun = await request(
    "POST",
    "/api/prototype-backup/restore",
    { backup: backup.json, dryRun: true },
    cookie,
  );
  if (dryRun.status >= 400 || !dryRun.json?.verification?.ok) {
    note("issue", "Restore dry-run failed", { detail: JSON.stringify(dryRun.json).slice(0, 400) });
  } else {
    note("info", "Restore dry-run OK", {
      detail: `would write ${dryRun.json.written?.length || 0} · skip ${dryRun.json.skipped?.length || 0}`,
    });
  }

  const fireDrill = await request("POST", "/api/prototype-backup/fire-drill", {}, cookie);
  if (fireDrill.status >= 400 || !fireDrill.json?.ok) {
    note("issue", "Restore fire-drill failed", { detail: JSON.stringify(fireDrill.json).slice(0, 400) });
  } else {
    note("info", "Restore fire-drill OK", {
      detail: `${fireDrill.json.storesMatched}/${fireDrill.json.storesChecked} · ${fireDrill.json.ms}ms · cleaned ${fireDrill.json.cleaned}`,
    });
  }

  const readinessAfter = await request("GET", "/api/go-live/readiness", null, cookie);
  if (readinessAfter.status >= 400) {
    note("issue", "Readiness failed", { detail: JSON.stringify(readinessAfter.json).slice(0, 300) });
  } else {
    for (const check of readinessAfter.json?.checks || []) {
      // Simpro is optional — never treat as an issue for company production.
      const level =
        check.id === "simpro"
          ? "info"
          : check.status === "blocked"
            ? "issue"
            : check.status === "warning"
              ? "warn"
              : "info";
      note(level, `Check ${check.id}`, {
        detail: `${check.status} · ${check.label}`,
      });
    }
  }
  const company = readinessAfter.json?.companyProduction;
  if (company) {
    note(company.ready ? "info" : "warn", "Company production", {
      detail: `${company.ready ? "ready" : "not ready"} · blockers=${(company.blockers || []).join(",") || "none"} · ${company.posture || ""}`,
    });
  }

  // Safety: never apply real restore (confirm:RESTORE) in this drill
  const summary = {
    base: BASE,
    findings,
    readiness: readinessAfter.json,
    openai: openai.json,
    smoke: smoke.json,
    dryRun: dryRun.json,
    fireDrill: fireDrill.json,
  };
  fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
  const issues = findings.filter((f) => f.level === "issue");
  console.log(`\nDone. ${issues.length} issues. Artifacts ${OUT}`);
  process.exit(issues.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
