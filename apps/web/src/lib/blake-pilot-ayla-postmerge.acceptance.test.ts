import assert from "node:assert/strict";
import test from "node:test";

const pilotHealth = "https://nexa-pilot.onrender.com/api/health";
const requiredCommit = "9f0c99765090090a441f4c9717dfd5a130286497";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function snapshot() {
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

test("pilot has deployed the post-fix Ayla commit", { timeout: 300_000 }, async () => {
  let last: Awaited<ReturnType<typeof snapshot>> = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    last = await snapshot();
    if (
      last?.ok === true
      && last.deployment?.service === "nexa-pilot"
      && last.deployment.branch === "codex/ai-surveyor-estimator-takeoff"
      && last.deployment.commit === requiredCommit
    ) return;
    await sleep(10_000);
  }
  assert.fail(`Pilot did not deploy ${requiredCommit}. Last health: ${JSON.stringify(last)}`);
});
