import assert from "node:assert/strict";
import test from "node:test";

const liveHealth = "https://nexa-live.onrender.com/api/health";
const requiredCommit = "ae0d399a3973bb6fccd518b621869e978f20be4d";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function snapshot() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(liveHealth, { signal: controller.signal, cache: "no-store" });
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

test("live has deployed the Ask Ayla OpenAI failover commit", { timeout: 300_000 }, async () => {
  let last: Awaited<ReturnType<typeof snapshot>> = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    last = await snapshot();
    if (
      last?.ok === true
      && last.deployment?.service === "nexa-live"
      && last.deployment.branch === "codex/ai-surveyor-estimator-takeoff"
      && last.deployment.commit === requiredCommit
    ) return;
    await sleep(10_000);
  }
  assert.fail(`Live did not deploy ${requiredCommit}. Last health: ${JSON.stringify(last)}`);
});
