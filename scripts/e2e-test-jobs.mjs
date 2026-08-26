#!/usr/bin/env node
/**
 * Run numbered end-to-end pilot jobs: Test 1 … Test N
 * Paths rotate:
 *   A) lead → survey → estimate → quote → accept → job → schedule → invoice
 *   B) lead → heat design → takeoff → quote → accept → job → schedule → invoice
 *   C) lead → direct quote → accept → job → schedule → invoice
 *
 * Env:
 *   NEXA_E2E_BASE_URL (default http://127.0.0.1:3000)
 *   NEXA_E2E_USER / NEXA_E2E_PASSWORD (required when live users-auth)
 *   NEXA_E2E_COUNT (default 12)
 *   NEXA_E2E_OUT (artifact dir)
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const BASE = process.env.NEXA_E2E_BASE_URL || "http://127.0.0.1:3000";
const USER = process.env.NEXA_E2E_USER || "brian.kerr";
const PASS = process.env.NEXA_E2E_PASSWORD || "";
const COUNT = Math.max(1, Number(process.env.NEXA_E2E_COUNT || 12));
const OUT = process.env.NEXA_E2E_OUT || "/opt/cursor/artifacts/e2e-test-jobs";
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
const jobsReport = [];
const note = (level, message, extra = {}) => {
  findings.push({ at: new Date().toISOString(), level, message, ...extra });
  const suffix = extra.detail ? ` — ${extra.detail}` : "";
  console.log(`[${level}] ${message}${suffix}`);
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
          "x-hubflo-employee": "emp-brian",
          "x-hubflo-tenant-id": "pilot-ewg",
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
            json = { raw: text.slice(0, 800) };
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

function slotParts(n) {
  const day = new Date();
  day.setDate(day.getDate() + 1 + (n % 14));
  const surveyDate = day.toISOString().slice(0, 10);
  const surveyTime = `${String(8 + (n % 8)).padStart(2, "0")}:${String((n * 7) % 50).padStart(2, "0")}`;
  const jobDay = new Date(day);
  jobDay.setDate(jobDay.getDate() + 2 + (n % 5));
  const scheduledDate = jobDay.toISOString().slice(0, 10);
  const scheduledTime = `${String(9 + (n % 7)).padStart(2, "0")}:${String((n * 11) % 50).padStart(2, "0")}`;
  return { surveyDate, surveyTime, scheduledDate, scheduledTime };
}

function heatingLayoutFixture() {
  return {
    systemOptionId: "gas-system",
    emitterMode: "radiators",
    updatedAt: new Date().toISOString(),
    plants: [
      { id: "p1", kind: "boiler", label: "Gas boiler", x: 1, y: 1, floorLevel: "ground" },
      { id: "p2", kind: "cylinder", label: "210L cylinder", x: 1.8, y: 1, floorLevel: "ground" },
      { id: "p3", kind: "manifold", label: "Manifold", x: 2.6, y: 1, floorLevel: "ground" },
    ],
    emitters: [
      {
        id: "e1",
        kind: "radiator",
        label: "Living rad",
        roomId: "r1",
        x: 5,
        y: 3,
        widthM: 1.2,
        depthM: 0.1,
        rotationDeg: 0,
        floorLevel: "ground",
      },
    ],
    pipes: [
      {
        id: "pipe-primary",
        kind: "primary",
        label: "Boiler → cylinder",
        floorLevel: "ground",
        points: [
          { x: 1, y: 1 },
          { x: 1.8, y: 1 },
        ],
      },
      {
        id: "pipe-main",
        kind: "primary",
        label: "Cylinder → manifold",
        floorLevel: "ground",
        points: [
          { x: 1.8, y: 1 },
          { x: 2.6, y: 1 },
        ],
      },
      {
        id: "pipe-flow",
        kind: "flow",
        label: "Flow → Living rad",
        floorLevel: "ground",
        points: [
          { x: 2.6, y: 1 },
          { x: 5, y: 1 },
          { x: 5, y: 3 },
        ],
      },
      {
        id: "pipe-return",
        kind: "return",
        label: "Return ← Living rad",
        floorLevel: "ground",
        points: [
          { x: 5.1, y: 3 },
          { x: 5.1, y: 1.1 },
          { x: 2.7, y: 1.1 },
        ],
      },
    ],
  };
}

function surveyBody(label, client, site, lead) {
  const now = new Date().toISOString();
  const questions = [
    ["water-supply-stopcock", "Existing conditions"],
    ["drainage-waste-routes", "Existing conditions"],
    ["electrical-supply", "Existing conditions"],
    ["heating-drain-down", "Existing conditions"],
    ["access-construction", "Access and construction"],
    ["parking-restrictions", "Access and construction"],
    ["asbestos-safety", "Safety"],
    ["builders-work", "Access and construction"],
    ["existing-boiler", "Boiler"],
    ["gas-meter-supply", "Gas"],
    ["proposed-boiler-position", "Boiler"],
    ["flue-route", "Flue"],
    ["condensate-route", "Boiler"],
    ["controls", "Controls"],
  ];
  return {
    clientMutationId: `test-job-${label}-${Date.now()}`,
    customerName: client.name,
    customerId: client.id,
    siteId: site.id,
    siteAddress: site.address || "Aberdeen",
    primaryContact: {
      name: client.primaryContact || "Site contact",
      email: client.email || "office@example.com",
      phone: client.phone || "01224 000000",
    },
    jobLink: { type: "Lead", id: lead.id, reference: lead.ref },
    surveyorName: "Brian Kerr",
    surveyDate: lead.surveyDate || new Date().toISOString().slice(0, 10),
    customerRequirements: `${label}: boiler / heating works captured on site.`,
    occupancy: "Occupied",
    market: "Domestic",
    jobType: "Boiler replacement",
    answers: questions.map(([key, section], index) => ({
      id: `answer-${index}`,
      key,
      section,
      question: key,
      value: "Confirmed on site",
      status: "Confirmed",
      notes: "",
      photoIds: [],
      updatedAt: now,
    })),
    rooms: [
      {
        id: "room-kitchen",
        name: "Kitchen",
        lengthM: 4.2,
        widthM: 3.1,
        heightM: 2.4,
        wallConstruction: "Masonry",
        floorConstruction: "Suspended timber",
        ceilingConstruction: "Plasterboard",
        accessNotes: "Cupboard access",
        photoIds: [],
      },
    ],
    scopeItems: [
      {
        id: "scope-boiler",
        taskType: "Replace boiler",
        trade: "Plumbing/Heating",
        roomOrArea: "Kitchen",
        existingPosition: "Utility",
        proposedPosition: "Kitchen cupboard",
        quantity: 1,
        dimensions: "Recorded",
        status: "Confirmed",
        responsibility: "EWG",
        notes: label,
        photoIds: [],
      },
    ],
    pipeRuns: [
      {
        id: "pipe-gas",
        service: "Gas",
        fromLocation: "Gas meter",
        toLocation: "Kitchen cupboard",
        measuredLengthM: 12,
        pipeSize: "22mm",
        material: "Copper",
        route: "Measured route",
        insulationRequired: false,
        directionChanges: [{ type: "Bend", quantity: 4 }],
        accessDifficulty: "Standard",
        fireStopping: false,
        coreDrilling: false,
        makingGood: true,
        measurementStatus: "Measured",
        notes: "",
        photoIds: [],
      },
    ],
    equipmentItems: [
      {
        id: "equipment-boiler",
        category: "Boiler",
        roomOrArea: "Kitchen",
        description: "Combi boiler like-for-like",
        make: "Worcester",
        model: "Greenstar",
        supplierCode: "",
        quantity: 1,
        dimensions: "",
        outputOrCapacity: "30kW",
        connectionRequirements: "Gas + flue",
        rfqRequired: false,
        status: "Confirmed",
        tbcReason: "",
        notes: "Priced from guide rates",
        photoIds: [],
      },
    ],
    photos: [],
    workByOthers: ["Decoration beyond local making good"],
    assumptions: ["Existing pipework suitable for reuse where noted"],
  };
}

async function ensureCustomer(cookie) {
  let clients = (await request("GET", "/api/clients", null, cookie)).json || [];
  let sites = (await request("GET", "/api/client-sites", null, cookie)).json || [];
  let client = Array.isArray(clients) ? clients.find((c) => sites.some((s) => s.clientId === c.id)) : null;
  let site = client ? sites.find((s) => s.clientId === client.id) : null;
  if (client && site) return { client, site };

  const created = await request(
    "POST",
    "/api/clients",
    {
      name: "EWG Test Customer",
      primaryContact: "Brian Kerr",
      email: "office@ewg-test.example",
      phone: "01224 000111",
      address: "1 Test Yard, Aberdeen",
      siteName: "Test Yard",
      siteAddress: "1 Test Yard, Aberdeen, AB10 1AA",
      actor: "Brian Kerr",
      source: "e2e-test-jobs",
    },
    cookie,
  );
  if (created.status >= 400) {
    throw new Error(`Client create failed: ${JSON.stringify(created.json)}`);
  }
  client = created.json.client || created.json;
  sites = created.json.clientSites || (await request("GET", "/api/client-sites", null, cookie)).json || [];
  site = sites.find((s) => s.clientId === client.id);
  if (!site) {
    const siteRes = await request(
      "POST",
      "/api/client-sites",
      {
        clientId: client.id,
        name: "Test Yard",
        address: "1 Test Yard, Aberdeen, AB10 1AA",
        primaryContact: "Brian Kerr",
        actor: "Brian Kerr",
      },
      cookie,
    );
    if (siteRes.status >= 400) throw new Error(`Site create failed: ${JSON.stringify(siteRes.json)}`);
    site = siteRes.json.site || siteRes.json;
  }
  return { client, site };
}

async function createLead(cookie, client, site, label, slots) {
  const base = {
    customerName: client.name,
    clientId: client.id,
    siteId: site.id,
    phone: client.phone || "01224 000000",
    email: client.email || "office@example.com",
    address: site.address || "Aberdeen",
    description: `${label} — end-to-end pilot job`,
    source: "Phone call",
    createdBy: "Brian Kerr",
  };
  let res = await request(
    "POST",
    "/api/leads",
    {
      ...base,
      status: "Survey booked",
      surveyor: "Brian Kerr",
      surveyDate: slots.surveyDate,
      surveyTime: slots.surveyTime,
      next: `${label} survey booked`,
    },
    cookie,
  );
  if (res.status === 409) {
    res = await request(
      "POST",
      "/api/leads",
      {
        ...base,
        status: "Needs scheduling",
        surveyor: "",
        surveyDate: "",
        surveyTime: "",
        next: `${label} needs survey booking`,
      },
      cookie,
    );
  }
  if (res.status >= 400) throw new Error(`Lead create failed: ${JSON.stringify(res.json)}`);
  return res.json.lead || res.json;
}

async function pathSurveyToQuote(cookie, client, site, lead, label) {
  const created = await request("POST", "/api/surveys", surveyBody(label, client, site, lead), cookie);
  if (created.status >= 400) throw new Error(`Survey create failed: ${JSON.stringify(created.json)}`);
  const survey = created.json;
  const completed = await request(
    "POST",
    `/api/surveys/${survey.id}/complete`,
    { expectedVersion: survey.version },
    cookie,
  );
  if (completed.status >= 400) throw new Error(`Survey complete failed: ${JSON.stringify(completed.json)}`);
  const sent = await request(
    "POST",
    `/api/surveys/${survey.id}/send-to-estimator`,
    { expectedVersion: completed.json.survey.version },
    cookie,
  );
  if (sent.status >= 400) throw new Error(`Send to estimator failed: ${JSON.stringify(sent.json)}`);
  let estimate = sent.json.estimate;

  // Clear TBC blockers and stamp guide pricing so Price Ledger can show Guide/Firm.
  for (const line of estimate.materialLines || []) {
    if (line.status === "TBC" || line.unitCost === undefined) {
      const patched = await request(
        "PATCH",
        `/api/estimates/${estimate.id}`,
        {
          expectedVersion: estimate.version,
          lineType: "Material",
          lineId: line.id,
          patch: {
            unitCost: line.unitCost ?? 12.5,
            status: "Confirmed",
            notes: line.notes?.trim() || "Guide rate applied for Test job",
            pricingState: "guide",
          },
          correctionReason: `${label} guide price`,
        },
        cookie,
      );
      if (patched.status < 400) estimate = patched.json;
    }
  }

  const pushed = await request(
    "POST",
    `/api/estimates/${estimate.id}/push-to-quote`,
    { expectedVersion: estimate.version },
    cookie,
  );
  if (pushed.status >= 400) throw new Error(`Push to quote failed: ${JSON.stringify(pushed.json)}`);
  const quote = pushed.json.quote;
  await request("PATCH", `/api/leads/${lead.id}`, { status: "Quoted", next: `Quoted as ${quote.ref}` }, cookie);
  return {
    path: "survey→estimate→quote",
    surveyId: survey.id,
    estimateId: estimate.id,
    quote,
    pricingStates: (pushed.json.costCentres || [])
      .flatMap((c) => c.lines || [])
      .map((l) => l.pricingState)
      .filter(Boolean),
  };
}

async function pathHeatTakeoffToQuote(cookie, client, site, lead, label) {
  const heat = await request(
    "POST",
    "/api/heat-design/projects",
    {
      name: `${label} heat design`,
      customerName: client.name,
      address: site.address || "Aberdeen",
      postcode: "AB10 1AA",
      propertyType: "Detached",
      buildEra: "1990s",
      occupants: 4,
      currentFuel: "Gas",
      chosenSystemId: "gas-system",
      emitterMode: "radiators",
      heatingLayout: heatingLayoutFixture(),
      linkedLeadId: lead.id,
      linkedLeadRef: lead.ref,
    },
    cookie,
  );
  if (heat.status >= 400) throw new Error(`Heat design create failed: ${JSON.stringify(heat.json)}`);
  const project = heat.json;

  // Ensure layout persisted (some creates ignore nested layout until PUT)
  const put = await request(
    "PUT",
    `/api/heat-design/projects/${project.id}`,
    { ...project, heatingLayout: heatingLayoutFixture(), chosenSystemId: "gas-system" },
    cookie,
  );
  if (put.status >= 400) throw new Error(`Heat design put failed: ${JSON.stringify(put.json)}`);

  const send = await request(
    "POST",
    "/api/heat-design/send-to-takeoff",
    { projectId: project.id, createNew: true },
    cookie,
  );
  if (send.status >= 400) throw new Error(`Send to takeoff failed: ${JSON.stringify(send.json)}`);
  const takeoffId = send.json.takeoff?.id || send.json.takeoffId || send.json.project?.linkedTakeoffId;
  if (!takeoffId) throw new Error(`No takeoff id from send-to-takeoff: ${JSON.stringify(send.json).slice(0, 400)}`);

  const approved = await request("PATCH", `/api/takeoff-projects/${takeoffId}`, { status: "Approved" }, cookie);
  if (approved.status >= 400) throw new Error(`Takeoff approve failed: ${JSON.stringify(approved.json)}`);

  const push = await request(
    "POST",
    `/api/takeoff-projects/${takeoffId}/push`,
    { createNew: true, actor: "Brian Kerr", allowPendingAiReview: true },
    cookie,
  );
  if (push.status >= 400) throw new Error(`Takeoff push failed: ${JSON.stringify(push.json)}`);
  const quote = push.json.quote || push.json;
  await request("PATCH", `/api/leads/${lead.id}`, { status: "Quoted", next: `Quoted as ${quote.ref}` }, cookie);
  return {
    path: "heat→takeoff→quote",
    heatId: project.id,
    takeoffId,
    quote,
    pricingStates: [],
  };
}

async function pathDirectQuote(cookie, client, site, lead, label) {
  const quoteRes = await request(
    "POST",
    "/api/quotes",
    {
      clientId: client.id,
      siteId: site.id,
      customer: client.name,
      description: `${label} — ${lead.description}`,
      owner: "Brian Kerr",
      status: "Draft",
      value: 1450 + (label.match(/\d+/)?.[0] ? Number(label.match(/\d+/)[0]) * 10 : 0),
      next: "Build cost centres / takeoff",
      due: "This week",
      sourceLeadId: lead.id,
      sourceLeadRef: lead.ref,
    },
    cookie,
  );
  if (quoteRes.status >= 400) throw new Error(`Direct quote failed: ${JSON.stringify(quoteRes.json)}`);
  await request("PATCH", `/api/leads/${lead.id}`, { status: "Quoted", next: `Quoted as ${quoteRes.json.ref}` }, cookie);
  return { path: "lead→quote", quote: quoteRes.json, pricingStates: [] };
}

async function acceptConvertScheduleInvoice(cookie, client, site, quote, label, slots) {
  const accept = await request(
    "PATCH",
    `/api/quotes/${quote.id}`,
    { status: "Accepted", next: `${label} accepted — converting` },
    cookie,
  );
  if (accept.status >= 400) throw new Error(`Quote accept failed: ${JSON.stringify(accept.json)}`);

  const convert = await request(
    "POST",
    `/api/quotes/${quote.id}/convert`,
    { actor: "Brian Kerr", chargeValue: quote.value },
    cookie,
  );
  if (convert.status >= 400) throw new Error(`Convert failed: ${JSON.stringify(convert.json)}`);
  const job = convert.json.job || convert.json;

  let scheduled = false;
  for (let attempt = 0; attempt < 8 && !scheduled; attempt += 1) {
    const hour = 8 + ((attempt + label.length) % 9);
    const minute = String((attempt * 7 + label.length) % 50).padStart(2, "0");
    const tryTime = `${String(hour).padStart(2, "0")}:${minute}`;
    const day = new Date(slots.scheduledDate);
    day.setDate(day.getDate() + attempt);
    const scheduledDate = day.toISOString().slice(0, 10);
    const sched = await request(
      "PATCH",
      `/api/jobs/${job.id}`,
      {
        manager: "Brian Kerr",
        scheduledDate,
        scheduledTime: tryTime,
        status: "In progress",
        next: `${label} engineer scheduled`,
      },
      cookie,
    );
    if (sched.status < 400) {
      scheduled = true;
      slots.scheduledDate = scheduledDate;
      slots.scheduledTime = tryTime;
    }
  }
  if (!scheduled) note("warn", `${label} schedule clash — continuing to invoice`, { detail: job.ref });

  await request(
    "PATCH",
    `/api/jobs/${job.id}`,
    { status: "Ready to invoice", next: `${label} raise final invoice` },
    cookie,
  );

  const hubGet = await request("GET", "/api/hub-state", null, cookie);
  if (hubGet.status >= 400) throw new Error("hub-state get failed");
  const issued = new Date().toISOString().slice(0, 10);
  const invoice = {
    id: `inv-${label.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    ref: `INV-${label.replace(/\s+/g, "").toUpperCase()}`,
    status: "Draft",
    sourceType: "job",
    sourceId: job.id,
    sourceRef: job.ref,
    sourceName: `Job ${job.ref}`,
    customer: client.name,
    issuedDate: issued,
    dueDate: issued,
    clientId: client.id,
    siteId: site.id,
    title: `Invoice for ${label}`,
    lines: [
      {
        id: `line-${Date.now()}`,
        description: job.description || label,
        category: "Other",
        costToUs: 0,
        chargeToClient: Number(job.value) || Number(quote.value) || 1450,
        note: `${label} invoice`,
      },
    ],
    costTotal: 0,
    chargeTotal: Number(job.value) || Number(quote.value) || 1450,
    vatRate: 20,
    vatTreatment: "Standard 20%",
    notes: `Created by e2e-test-jobs · ${label}`,
    claimType: "full",
    accountsStatus: "Not sent",
    paymentStatus: "Unpaid",
    paidAmount: 0,
  };
  const hub = hubGet.json || {};
  const put = await request("PUT", "/api/hub-state", { ...hub, invoices: [invoice, ...(hub.invoices || [])] }, cookie);
  if (put.status >= 400) throw new Error(`Invoice save failed: ${JSON.stringify(put.json).slice(0, 300)}`);

  return { job, invoice, scheduled };
}

async function runOne(cookie, client, site, n) {
  const label = `Test ${n}`;
  const slots = slotParts(n);
  const pathKind = n % 3; // 1→A survey, 2→B heat, 0→C direct
  const lead = await createLead(cookie, client, site, label, slots);
  note("info", `${label} lead`, { detail: lead.ref });

  let built;
  if (pathKind === 1) {
    built = await pathSurveyToQuote(cookie, client, site, lead, label);
  } else if (pathKind === 2) {
    built = await pathHeatTakeoffToQuote(cookie, client, site, lead, label);
  } else {
    built = await pathDirectQuote(cookie, client, site, lead, label);
  }
  note("info", `${label} quote via ${built.path}`, { detail: built.quote.ref });

  const closed = await acceptConvertScheduleInvoice(cookie, client, site, built.quote, label, slots);
  note("info", `${label} job+invoice`, {
    detail: `${closed.job.ref} → ${closed.invoice.ref}${closed.scheduled ? "" : " (unscheduled)"}`,
  });

  return {
    label,
    path: built.path,
    leadRef: lead.ref,
    leadId: lead.id,
    quoteRef: built.quote.ref,
    quoteId: built.quote.id,
    jobRef: closed.job.ref,
    jobId: closed.job.id,
    invoiceRef: closed.invoice.ref,
    pricingStates: built.pricingStates,
    scheduled: closed.scheduled,
    ok: true,
  };
}

async function main() {
  note("info", `Base ${BASE} · count ${COUNT}`);

  let cookie = "";
  if (PASS) {
    const login = await request("POST", "/api/auth/login", { username: USER, password: PASS });
    if (login.status >= 400) {
      note("issue", "Login failed", { detail: JSON.stringify(login.json) });
      process.exit(2);
    }
    cookie = cookieFrom(login.setCookie);
    note("info", "Logged in", { detail: login.json?.user?.name || USER });
  } else {
    note("info", "No password — open/dev headers mode");
  }

  const health = await request("GET", "/api/health", null, cookie);
  note("info", "Health", {
    detail: `${health.json?.ok ? "ok" : "bad"} store=${health.json?.store} leadsFix=${health.json?.deployment?.leadsRecordFix || health.json?.features?.leadsRecordFix || "?"}`,
  });

  const { client, site } = await ensureCustomer(cookie);
  note("info", "Customer", { detail: `${client.name} / ${site.name || site.address}` });

  for (let n = 1; n <= COUNT; n += 1) {
    try {
      const row = await runOne(cookie, client, site, n);
      jobsReport.push(row);
    } catch (error) {
      const message = error?.message || String(error);
      note("issue", `Test ${n} failed`, { detail: message.slice(0, 500) });
      jobsReport.push({ label: `Test ${n}`, ok: false, error: message.slice(0, 800) });
    }
  }

  // Lead-record smoke: confirm leads list + a sample lead still load via API
  const leads = await request("GET", "/api/leads", null, cookie);
  const quotes = await request("GET", "/api/quotes", null, cookie);
  const jobs = await request("GET", "/api/jobs", null, cookie);
  const hub = await request("GET", "/api/hub-state", null, cookie);
  const testLeads = (leads.json || []).filter((l) => /Test \d+/i.test(l.description || ""));
  note("info", "Counts", {
    detail: JSON.stringify({
      leads: (leads.json || []).length,
      testLeads: testLeads.length,
      quotes: (quotes.json || []).length,
      jobs: (jobs.json || []).length,
      invoices: (hub.json?.invoices || []).length,
    }),
  });

  const summary = {
    base: BASE,
    count: COUNT,
    ok: jobsReport.filter((r) => r.ok).length,
    failed: jobsReport.filter((r) => !r.ok).length,
    jobs: jobsReport,
    findings,
  };
  fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(`\nDone. ${summary.ok}/${COUNT} ok, ${summary.failed} failed. Artifacts ${OUT}`);
  process.exit(summary.failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
