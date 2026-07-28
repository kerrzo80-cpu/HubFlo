#!/usr/bin/env node
/**
 * Live API full-loop: lead → quote → convert job → schedule → site asset → stock receive.
 * Env: NEXA_E2E_USER / NEXA_E2E_PASSWORD
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const BASE = process.env.NEXA_E2E_BASE_URL || "https://nexa-live.onrender.com";
const USER = process.env.NEXA_E2E_USER || "brian.kerr";
const PASS = process.env.NEXA_E2E_PASSWORD || "";
const OUT = process.env.NEXA_E2E_OUT || "/opt/cursor/artifacts/e2e-full";
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
const note = (level, message, extra = {}) => {
  findings.push({ at: new Date().toISOString(), level, message, ...extra });
  console.log(`[${level}] ${message}${extra.detail ? ` — ${extra.detail}` : ""}`);
};

function request(method, path, body, cookie) {
  const url = new URL(path, BASE);
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
          "x-hubflo-role": "Owner/Admin",
          "x-hubflo-employee": "emp-brian",
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
          const setCookie = res.headers["set-cookie"] || [];
          resolve({ status: res.statusCode || 0, json, setCookie, text });
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
  if (!PASS) throw new Error("NEXA_E2E_PASSWORD required");
  note("info", `Base ${BASE}`);

  const login = await request("POST", "/api/auth/login", { username: USER, password: PASS });
  if (login.status >= 400) {
    note("issue", "Login failed", { detail: JSON.stringify(login.json) });
    process.exit(2);
  }
  const cookie = cookieFrom(login.setCookie);
  note("info", "Logged in", { detail: login.json?.user?.name || USER });

  const clients = (await request("GET", "/api/clients", null, cookie)).json;
  const sites = (await request("GET", "/api/client-sites", null, cookie)).json;
  const client = clients.find((c) => sites.some((s) => s.clientId === c.id)) || clients[0];
  const site = sites.find((s) => s.clientId === client.id);
  if (!client || !site) {
    note("issue", "No client/site pair available");
    process.exit(2);
  }
  note("info", "Using customer", { detail: `${client.name} / ${site.name}` });

  // 1) Lead with unique survey slot (avoid clash with prior E2E runs)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const surveyDate = tomorrow.toISOString().slice(0, 10);
  const slotMinute = String((Date.now() % 50) + 8).padStart(2, "0");
  const surveyTime = `${String(8 + (Date.now() % 8)).padStart(2, "0")}:${slotMinute}`;
  const jobScheduleTime = `${String(14 + (Date.now() % 4)).padStart(2, "0")}:${slotMinute}`;
  const leadRes = await request(
    "POST",
    "/api/leads",
    {
      customerName: client.name,
      clientId: client.id,
      siteId: site.id,
      phone: client.phone || "01224 000000",
      email: client.email || "office@example.com",
      address: site.address || "Aberdeen",
      description: `E2E full loop boiler service ${Date.now()}`,
      source: "Phone call",
      status: "Survey booked",
      surveyor: "Brian Kerr",
      surveyDate,
      surveyTime,
      createdBy: "Brian Kerr",
      next: "Survey booked for E2E loop",
    },
    cookie,
  );
  if (leadRes.status === 409) {
    note("warn", "Survey clash — creating lead without booking", { detail: leadRes.json?.message });
    const retry = await request(
      "POST",
      "/api/leads",
      {
        customerName: client.name,
        clientId: client.id,
        siteId: site.id,
        phone: client.phone || "01224 000000",
        email: client.email || "office@example.com",
        address: site.address || "Aberdeen",
        description: `E2E full loop boiler service ${Date.now()}`,
        source: "Phone call",
        status: "Needs scheduling",
        surveyor: "",
        surveyDate: "",
        surveyTime: "",
        createdBy: "Brian Kerr",
        next: "Needs survey booking",
      },
      cookie,
    );
    if (retry.status >= 400) {
      note("issue", "Lead create failed", { detail: JSON.stringify(retry.json) });
      process.exit(1);
    }
    var lead = retry.json.lead;
  } else if (leadRes.status >= 400) {
    note("issue", "Lead create failed", { detail: JSON.stringify(leadRes.json) });
    process.exit(1);
  } else {
    var lead = leadRes.json.lead;
  }
  note("info", "Lead created", { detail: lead.ref });

  // 1b) Lost-reason persistence smoke (create throwaway lead and archive)
  {
    const lostLeadRes = await request(
      "POST",
      "/api/leads",
      {
        customerName: client.name,
        clientId: client.id,
        siteId: site.id,
        phone: client.phone || "01224 000000",
        email: client.email || "office@example.com",
        address: site.address || "Aberdeen",
        description: `E2E lost-reason check ${Date.now()}`,
        source: "Phone call",
        status: "Needs scheduling",
        surveyor: "",
        surveyDate: "",
        surveyTime: "",
        createdBy: "Brian Kerr",
        next: "Lost-reason smoke",
      },
      cookie,
    );
    if (lostLeadRes.status < 400 && lostLeadRes.json?.lead?.id) {
      const lostId = lostLeadRes.json.lead.id;
      const patchLost = await request(
        "PATCH",
        `/api/leads/${lostId}`,
        { status: "Lost", lostReason: "Price", next: "Archived as lost · Price." },
        cookie,
      );
      if (patchLost.status >= 400 || patchLost.json?.lostReason !== "Price") {
        note("issue", "Lost reason not persisted", { detail: JSON.stringify(patchLost.json).slice(0, 300) });
      } else {
        note("info", "Lost reason persisted", { detail: patchLost.json.ref });
      }
    } else {
      note("warn", "Could not create throwaway lead for lost-reason check");
    }
  }

  // 2) Quote from lead
  const quoteRes = await request(
    "POST",
    "/api/quotes",
    {
      clientId: client.id,
      siteId: site.id,
      customer: client.name,
      description: lead.description,
      owner: "Brian Kerr",
      status: "Draft",
      value: 1250,
      next: "Build cost centres / takeoff",
      due: "This week",
      sourceLeadId: lead.id,
      sourceLeadRef: lead.ref,
    },
    cookie,
  );
  if (quoteRes.status >= 400) {
    note("issue", "Quote create failed", { detail: JSON.stringify(quoteRes.json) });
    process.exit(1);
  }
  const quote = quoteRes.json;
  note("info", "Quote created", { detail: `${quote.ref} £${quote.value}` });

  // Mark lead quoted
  await request("PATCH", `/api/leads/${lead.id}`, { status: "Quoted", next: `Quoted as ${quote.ref}` }, cookie);

  // Accept quote then convert
  const acceptRes = await request(
    "PATCH",
    `/api/quotes/${quote.id}`,
    { status: "Accepted", next: "Accepted — converting to job" },
    cookie,
  );
  if (acceptRes.status >= 400) {
    note("issue", "Quote accept failed", { detail: JSON.stringify(acceptRes.json) });
    process.exit(1);
  }
  note("info", "Quote accepted", { detail: acceptRes.json.ref || quote.ref });

  // 3) Convert quote → job
  const convertRes = await request(
    "POST",
    `/api/quotes/${quote.id}/convert`,
    { actor: "Brian Kerr", chargeValue: quote.value },
    cookie,
  );
  if (convertRes.status >= 400) {
    note("issue", "Quote convert failed", { detail: JSON.stringify(convertRes.json) });
    process.exit(1);
  }
  const job = convertRes.json.job || convertRes.json;
  note("info", "Job created from quote", { detail: job.ref || JSON.stringify(convertRes.json).slice(0, 200) });

  // 4) Schedule job
  const jobId = job.id;
  if (jobId) {
    const sched = await request(
      "PATCH",
      `/api/jobs/${jobId}`,
      {
        manager: "Brian Kerr",
        scheduledDate: surveyDate,
        scheduledTime: jobScheduleTime,
        status: "In progress",
        next: "Engineer scheduled for E2E loop",
      },
      cookie,
    );
    if (sched.status >= 400) {
      note("warn", "Job schedule patch failed", { detail: JSON.stringify(sched.json) });
    } else {
      note("info", "Job scheduled", { detail: `${surveyDate} ${jobScheduleTime} Brian Kerr` });
    }
  }

  // 5) Site asset
  const assetRes = await request(
    "POST",
    "/api/site-assets",
    {
      action: "upsert",
      siteId: site.id,
      clientId: client.id,
      type: "Gas appliance",
      name: `Kitchen boiler ${Date.now()}`,
      make: "Worcester",
      model: "Greenstar",
      nextServiceDate: "2027-07-28",
    },
    cookie,
  );
  if (assetRes.status >= 400) note("issue", "Asset create failed", { detail: JSON.stringify(assetRes.json) });
  else note("info", "Site asset saved", { detail: assetRes.json.assets?.[0]?.name || "ok" });

  // 6) Stock receive
  const stockRes = await request(
    "POST",
    "/api/stock",
    {
      action: "receive-po",
      receipt: {
        lines: [{ sku: `E2E-${Date.now()}`, name: "E2E copper fitting", quantity: 5, unitCost: 4.5 }],
        poNumber: `PO-E2E-${Date.now()}`,
        jobRef: job.ref,
        actor: "Brian Kerr",
      },
    },
    cookie,
  );
  if (stockRes.status >= 400) note("issue", "Stock receive failed", { detail: JSON.stringify(stockRes.json) });
  else note("info", "Stock received", { detail: `${stockRes.json.items?.length || 0} items` });

  // 7) Recurring plan
  const rec = await request(
    "POST",
    "/api/recurring",
    {
      action: "upsert",
      kind: "Job",
      name: `Annual service ${client.name}`,
      customer: client.name,
      site: site.name,
      description: "Annual boiler service",
      frequency: "Yearly",
      nextDueDate: "2027-07-28",
    },
    cookie,
  );
  if (rec.status >= 400) note("issue", "Recurring plan failed", { detail: JSON.stringify(rec.json) });
  else note("info", "Recurring plan saved", { detail: String(rec.json.plans?.length || 0) });


  // 8) Mark job ready to invoice + create draft invoice into hub-state
  if (jobId) {
    await request("PATCH", `/api/jobs/${jobId}`, {
      status: "Ready to invoice",
      next: "Raise and email final invoice.",
    }, cookie);
    const hubGet = await request("GET", "/api/hub-state", null, cookie);
    if (hubGet.status < 400) {
      const issued = new Date().toISOString().slice(0, 10);
      const invoice = {
        id: `inv-e2e-${Date.now()}`,
        ref: `INV-E2E-${Date.now().toString().slice(-4)}`,
        status: "Draft",
        sourceType: "job",
        sourceId: jobId,
        sourceRef: job.ref,
        sourceName: `Job ${job.ref}`,
        customer: client.name,
        issuedDate: issued,
        dueDate: issued,
        clientId: client.id,
        siteId: site.id,
        title: `Invoice for ${job.ref}`,
        lines: [{
          id: `line-${Date.now()}`,
          description: job.description || lead.description,
          category: "Other",
          costToUs: 0,
          chargeToClient: Number(job.value) || Number(quote.value) || 1250,
          note: "E2E full-loop invoice",
        }],
        costTotal: 0,
        chargeTotal: Number(job.value) || Number(quote.value) || 1250,
        vatRate: 20,
        vatTreatment: "Standard 20%",
        notes: "Created by E2E full-loop",
        claimType: "full",
        accountsStatus: "Not sent",
        paymentStatus: "Unpaid",
        paidAmount: 0,
      };
      const hub = hubGet.json || {};
      const invoices = [invoice, ...(hub.invoices || [])];
      const put = await request("PUT", "/api/hub-state", { ...hub, invoices }, cookie);
      if (put.status >= 400) note("issue", "Invoice hub save failed", { detail: JSON.stringify(put.json).slice(0, 300) });
      else note("info", "Invoice created", { detail: invoice.ref });

      // Xero export
      const xero = await request("POST", "/api/integrations/xero/export", {
        invoice: {
          id: invoice.id,
          ref: invoice.ref,
          customer: invoice.customer,
          issuedDate: invoice.issuedDate,
          dueDate: invoice.dueDate,
          chargeTotal: invoice.chargeTotal,
          vatRate: invoice.vatRate,
          notes: invoice.notes,
          lines: invoice.lines,
        },
      }, cookie);
      if (xero.status >= 400) note("issue", "Xero export failed", { detail: JSON.stringify(xero.json).slice(0, 300) });
      else note("info", "Xero export ok", { detail: `${xero.json.export?.mode} / ${xero.json.accountsStatus}` });
    } else {
      note("warn", "Could not load hub-state for invoice create");
    }
  }

  // Stock transfer + issue to job
  if (job.ref) {
    const stockGet = await request("GET", "/api/stock", null, cookie);
    const items = stockGet.json?.items || [];
    const locations = stockGet.json?.locations || [];
    const warehouse = locations.find((l) => l.kind === "Warehouse") || locations[0];
    const van = locations.find((l) => l.kind === "Van") || locations[1] || warehouse;
    const item = items[0];
    if (item && warehouse && van) {
      const transfer = await request("POST", "/api/stock", {
        action: "move",
        movement: {
          itemId: item.id,
          quantity: 1,
          reason: "Transfer",
          fromLocationId: warehouse.id,
          toLocationId: van.id,
        },
      }, cookie);
      if (transfer.status >= 400) note("warn", "Stock transfer failed", { detail: JSON.stringify(transfer.json).slice(0, 200) });
      else note("info", "Stock transferred to van", { detail: `${item.sku} → ${van.name}` });

      const issue = await request("POST", "/api/stock", {
        action: "move",
        movement: {
          itemId: item.id,
          quantity: 1,
          reason: "Issue to job",
          fromLocationId: van.id,
          jobRef: job.ref,
        },
      }, cookie);
      if (issue.status >= 400) note("issue", "Stock issue to job failed", { detail: JSON.stringify(issue.json).slice(0, 200) });
      else note("info", "Stock issued to job", { detail: `${item.sku} → ${job.ref}` });
    } else {
      note("warn", "Skipped stock transfer/issue — missing item or locations");
    }
  }

  // Summary counts
  const leads = (await request("GET", "/api/leads", null, cookie)).json;
  const quotes = (await request("GET", "/api/quotes", null, cookie)).json;
  const jobs = (await request("GET", "/api/jobs", null, cookie)).json;
  note("info", "Counts", {
    detail: JSON.stringify({ leads: leads.length, quotes: quotes.length, jobs: jobs.length }),
  });

  fs.writeFileSync(`${OUT}/findings.json`, JSON.stringify({ findings, lead, quote, job }, null, 2));
  const issues = findings.filter((f) => f.level === "issue");
  console.log(`\nDone. ${issues.length} issues. Artifacts ${OUT}`);
  process.exit(issues.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
