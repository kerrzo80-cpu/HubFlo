#!/usr/bin/env node

const token = process.env.RENDER_API_KEY?.trim();
const serviceId = process.env.RENDER_SERVICE_ID?.trim();
if (!token || !serviceId) throw new Error("RENDER_API_KEY and RENDER_SERVICE_ID are required");
const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" };
const list = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=20`, { headers });
if (!list.ok) throw new Error(`Render deploy list failed (${list.status})`);
const payload = await list.json();
const deploys = Array.isArray(payload) ? payload.map((item) => item.deploy ?? item) : [];
const current = deploys[0];
const previousLive = deploys.find((deploy, index) => index > 0 && deploy.status === "live" && deploy.id);
if (!current?.id || !previousLive?.id) throw new Error("No previous live Render deploy is available for rollback");
if (current.id === previousLive.id) throw new Error("Refusing to roll back to the current deploy");
const rollback = await fetch(`https://api.render.com/v1/services/${serviceId}/rollback`, {
  method: "POST", headers, body: JSON.stringify({ deployId: previousLive.id }),
});
const text = await rollback.text();
if (!rollback.ok) throw new Error(`Render rollback failed (${rollback.status}): ${text.slice(0, 500)}`);
console.log(JSON.stringify({ rolledBack: true, failedDeployId: current.id, targetDeployId: previousLive.id, response: text.slice(0, 500) }, null, 2));
