import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type SmokeCheck = {
  path: string;
  ok: boolean;
  status?: number;
  ms?: number;
  error?: string;
  attempts?: number;
};

function canRunWithSecret(request: NextRequest) {
  const expected = process.env.NEXA_IMPORT_TICK_SECRET?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-nexa-import-tick-secret")?.trim();
  return Boolean(provided && provided === expected);
}

function appOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return request.nextUrl.origin;
}

function isTransientStatus(status: number) {
  return status === 502 || status === 503 || status === 504 || status === 520 || status === 522 || status === 524;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkPath(origin: string, path: string, acceptStatuses: number[]): Promise<SmokeCheck> {
  const maxAttempts = 4;
  let last: SmokeCheck = { path, ok: false, error: "not attempted" };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(`${origin}${path}`, {
        method: "GET",
        redirect: "manual",
        headers: { accept: "text/html,application/json,*/*" },
        cache: "no-store",
      });
      const ms = Date.now() - started;
      const ok = acceptStatuses.includes(response.status);
      last = {
        path,
        ok,
        status: response.status,
        ms,
        attempts: attempt,
        error: ok ? undefined : `expected ${acceptStatuses.join("|")}, got ${response.status}`,
      };
      if (ok) return last;
      if (!isTransientStatus(response.status) || attempt === maxAttempts) return last;
    } catch (error) {
      last = {
        path,
        ok: false,
        ms: Date.now() - started,
        attempts: attempt,
        error: error instanceof Error ? error.message : "fetch failed",
      };
      if (attempt === maxAttempts) return last;
    }
    await sleep(1500 * attempt);
  }

  return last;
}

async function runSmoke(origin: string) {
  const coreModulePaths = ["/jobs", "/quotes", "/leads", "/setup", "/reports", "/people", "/schedule", "/invoices"];
  const checks = await Promise.all([
    checkPath(origin, "/api/health", [200]),
    checkPath(origin, "/login", [200]),
    checkPath(origin, "/", [200, 302, 307]),
    ...coreModulePaths.map((path) => checkPath(origin, path, [200, 302, 307])),
    checkPath(origin, "/field", [200, 302, 307]),
    checkPath(origin, "/sw-field.js", [200]),
    checkPath(origin, "/field/sw.js", [200]),
    checkPath(origin, "/api/manifest/field", [200]),
    checkPath(origin, "/heat-design", [200]),
    checkPath(origin, "/survey", [200, 302, 307]),
    checkPath(origin, "/ai-intake", [200, 302, 307]),
    checkPath(origin, "/ai-first", [200, 302, 307, 308]),
    checkPath(origin, "/api/branding", [200]),
  ]);

  const health = checks.find((check) => check.path === "/api/health");
  let healthDetail: Record<string, unknown> | null = null;
  if (health?.ok) {
    try {
      const response = await fetch(`${origin}/api/health`, { cache: "no-store" });
      healthDetail = (await response.json()) as Record<string, unknown>;
    } catch {
      healthDetail = null;
    }
  }

  const deployment =
    healthDetail && typeof healthDetail === "object" && "deployment" in healthDetail
      ? (healthDetail.deployment as Record<string, unknown> | null)
      : null;
  const coreRoutesOk = deployment?.coreRoutes === "url-modules-v1";
  if (health?.ok && !coreRoutesOk) {
    checks.push({
      path: "/api/health#coreRoutes",
      ok: false,
      error: `coreRoutes=${String(deployment?.coreRoutes)}, expected url-modules-v1`,
    });
  }

  const failed = checks.filter((check) => !check.ok);
  const transientOnly =
    failed.length > 0 &&
    failed.every((check) => typeof check.status === "number" && isTransientStatus(check.status));

  return {
    ok: failed.length === 0,
    /** Informational: failures look like deploy/proxy blips; outer cron should retry. */
    deployWindow: transientOnly,
    origin,
    checkedAt: new Date().toISOString(),
    failed: failed.map((check) => check.path),
    checks,
    deployment,
  };
}

/** Cron / secret-protected self smoke. Public GET returns 403 without secret. */
export async function GET(request: NextRequest) {
  if (!canRunWithSecret(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await runSmoke(appOrigin(request));
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
