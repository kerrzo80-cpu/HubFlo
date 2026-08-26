#!/usr/bin/env node
/**
 * Record edit lock deep test — two users, acquire/viewer/block/release.
 * Env: NEXA_E2E_BASE_URL, NEXA_E2E_USER, NEXA_E2E_PASSWORD
 * Optional second user: NEXA_E2E_USER_B / NEXA_E2E_PASSWORD_B (created on the fly if admin).
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const BASE = (process.env.NEXA_E2E_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const USER_A = process.env.NEXA_E2E_USER || "brian.kerr";
const PASS_A = process.env.NEXA_E2E_PASSWORD || process.env.NEXA_ADMIN_PASSWORD || "";
const USER_B = process.env.NEXA_E2E_USER_B || "test.lockviewer";
const PASS_B = process.env.NEXA_E2E_PASSWORD_B || "LockViewerPass123!X";
const OUT = process.env.NEXA_E2E_OUT || "/opt/cursor/artifacts/e2e-record-locks";
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
const note = (level, message, extra = {}) => {
  findings.push({ at: new Date().toISOString(), level, message, ...extra });
  console.log(`[${level}] ${message}${extra.detail ? ` — ${extra.detail}` : ""}`);
};

function request(method, urlPath, body, cookie) {
  const url = new URL(urlPath, BASE);
  const lib = url.protocol === "https:" ? https : http;
  const payload = body ? JSON.stringify(body) : null;
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
            json = { raw: text.slice(0, 400) };
          }
          resolve({
            status: res.statusCode || 0,
            json,
            setCookie: res.headers["set-cookie"] || [],
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

async function login(username, password) {
  const res = await request("POST", "/api/auth/login", { username, password });
  if (res.status >= 400) {
    throw new Error(`Login failed for ${username}: ${JSON.stringify(res.json)}`);
  }
  let cookie = cookieFrom(res.setCookie);
  let user = res.json?.user;
  if (user?.mustChangePassword) {
    const newPassword = `${password}X`;
    const changed = await request(
      "POST",
      "/api/auth/change-password",
      { currentPassword: password, newPassword },
      cookie,
    );
    if (changed.status >= 400) {
      throw new Error(`Password change failed for ${username}: ${JSON.stringify(changed.json)}`);
    }
    cookie = cookieFrom(changed.setCookie) || cookie;
    user = changed.json?.user || user;
    note("info", "Cleared mustChangePassword gate", { detail: username });
    return { cookie, user, password: newPassword };
  }
  return { cookie, user, password };
}

async function ensureSecondUser(adminCookie) {
  const list = await request("GET", "/api/auth/users", null, adminCookie);
  const users = Array.isArray(list.json) ? list.json : list.json?.users;
  if (list.status === 200 && Array.isArray(users)) {
    const existing = users.find((u) => u.username === USER_B);
    if (existing) return note("info", "Second user already exists", { detail: USER_B });
  }
  const created = await request(
    "POST",
    "/api/auth/users",
    {
      name: "Lock Viewer Test",
      username: USER_B,
      password: PASS_B,
      role: "Manager",
      employeeId: "emp-lock-test",
    },
    adminCookie,
  );
  if (created.status >= 400) {
    throw new Error(`Could not create second user: ${JSON.stringify(created.json)}`);
  }
  note("info", "Created second test user", { detail: USER_B });
}

async function lockAcquire(cookie, recordType, recordId) {
  return request(
    "POST",
    "/api/record-locks",
    { action: "acquire", recordType, recordId },
    cookie,
  );
}

async function main() {
  if (!PASS_A) throw new Error("NEXA_E2E_PASSWORD or NEXA_ADMIN_PASSWORD required");
  note("info", `Record lock E2E on ${BASE}`);

  const sessionA = await login(USER_A, PASS_A);
  note("info", "User A logged in", { detail: sessionA.user?.name || USER_A });

  await ensureSecondUser(sessionA.cookie);
  const sessionB = await login(USER_B, PASS_B);
  note("info", "User B logged in", { detail: sessionB.user?.name || USER_B });

  const recordId = `lock-e2e-${Date.now()}`;
  const recordType = "quote";

  const first = await lockAcquire(sessionA.cookie, recordType, recordId);
  if (first.status !== 200 || first.json?.mode !== "editor") {
    throw new Error(`User A should be editor: ${JSON.stringify(first.json)}`);
  }
  note("pass", "User A acquired editor lock");

  const second = await lockAcquire(sessionB.cookie, recordType, recordId);
  if (second.status !== 200 || second.json?.mode !== "viewer") {
    throw new Error(`User B should be viewer: ${JSON.stringify(second.json)}`);
  }
  note("pass", "User B got viewer mode", { detail: second.json?.lock?.holderName });

  const blocked = await request(
    "PUT",
    "/api/hub-state",
    {
      recordLockContext: { recordType, recordId },
      businessSettings: { companyName: "Lock test should fail" },
    },
    sessionB.cookie,
  );
  if (blocked.status !== 409 || blocked.json?.code !== "RECORD_LOCKED") {
    throw new Error(`Viewer hub PUT should 409 RECORD_LOCKED, got ${blocked.status} ${blocked.text.slice(0, 200)}`);
  }
  note("pass", "Server blocked viewer hub-state write", { detail: blocked.json?.holderName });

  const requestAccess = await request(
    "POST",
    "/api/record-locks",
    { action: "request-access", key: `${recordType}:${recordId}` },
    sessionB.cookie,
  );
  if (requestAccess.status !== 200) {
    throw new Error(`Request access failed: ${JSON.stringify(requestAccess.json)}`);
  }
  note("pass", "Request access succeeded");

  const release = await request(
    "POST",
    "/api/record-locks",
    { action: "release", key: `${recordType}:${recordId}` },
    sessionA.cookie,
  );
  if (release.status !== 200) throw new Error("Release failed");
  note("pass", "User A released lock");

  const third = await lockAcquire(sessionB.cookie, recordType, recordId);
  if (third.status !== 200 || third.json?.mode !== "editor") {
    throw new Error(`User B should become editor after release: ${JSON.stringify(third.json)}`);
  }
  note("pass", "User B became editor after release");

  const unauth = await lockAcquire(null, recordType, "x");
  if (unauth.status !== 401) {
    throw new Error(`Unauthenticated acquire should 401, got ${unauth.status}`);
  }
  note("pass", "Unauthenticated acquire returns 401");

  const report = { base: BASE, findings, passed: findings.filter((f) => f.level === "pass").length };
  const reportPath = path.join(OUT, "record-locks-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  note("info", "Report written", { detail: reportPath });

  const failures = findings.filter((f) => f.level === "issue");
  if (failures.length) process.exit(2);
  console.log("\n✅ All record lock E2E checks passed");
}

main().catch((error) => {
  note("issue", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
