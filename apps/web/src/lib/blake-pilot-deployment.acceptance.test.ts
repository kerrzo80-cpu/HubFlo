import assert from "node:assert/strict";
import test from "node:test";

const pilotHealth = "https://nexa-pilot.onrender.com/api/health";
const requiredAylaCommit = "3196a196b4a33d15cb9f3b5a7e5d1915132d6538";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function healthSnapshot() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(pilotHealth, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json() as {
      ok?: boolean;
      deployment?: { branch?: string; commit?: string; service?: string };
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function includesRequiredAylaCommit(deployedCommit: string) {
  if (deployedCommit === requiredAylaCommit) return true;
  try {
    const response = await fetch(
      `https://api.github.com/repos/kerrzo80-cpu/HubFlo/compare/${requiredAylaCommit}...${deployedCommit}`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!response.ok) return false;
    const body = await response.json() as { status?: string };
    return body.status === "ahead" || body.status === "identical";
  } catch {
    return false;
  }
}

test("pilot is healthy and deployed from the Blake branch with the Ayla acceptance commit", { timeout: 240_000 }, async () => {
  let last: Awaited<ReturnType<typeof healthSnapshot>> = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    last = await healthSnapshot();
    const deployment = last?.deployment;
    if (
      last?.ok === true
      && deployment?.service === "nexa-pilot"
      && deployment.branch === "codex/ai-surveyor-estimator-takeoff"
      && deployment.commit
      && await includesRequiredAylaCommit(deployment.commit)
    ) {
      return;
    }
    await sleep(5_000);
  }

  assert.fail(`Pilot did not report the required Ayla deployment. Last health: ${JSON.stringify(last)}`);
});
