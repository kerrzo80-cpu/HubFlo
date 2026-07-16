const baseUrl = process.env.NEXA_SMOKE_BASE_URL ?? "http://127.0.0.1:3010";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers,
    },
  });
  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyExistingWorkflow() {
  const [leads, quotes, jobs, purchaseOrders, auditEvents] = await Promise.all([
    request("/api/leads"),
    request("/api/quotes"),
    request("/api/jobs"),
    request("/api/purchase-requests"),
    request("/api/audit"),
  ]);
  const lead = leads.find((item) => item.ref === "L-1001");
  const quote = quotes.find((item) => item.ref === "Q-SMOKE");
  const job = jobs.find((item) => item.sourceQuoteId === quote?.id);
  const purchaseOrder = purchaseOrders.find((item) => item.jobId === job?.id);

  assert(lead?.status === "Quoted", "Restart lost the converted lead state");
  assert(quote?.status === "Converted", "Restart lost the accepted quote state");
  assert(job?.status === "In progress", "Restart lost the scheduled job state");
  assert(/^PO-\d+$/.test(purchaseOrder?.poNumber ?? ""), "Restart lost the approved PO number");
  assert(purchaseOrder?.actualCost === 725, "Restart lost the actual supplier cost");
  assert(purchaseOrder?.invoiceFileName === "INV-100.pdf", "Restart lost the supplier invoice evidence");
  assert(auditEvents.some((event) => event.action === "received"), "Restart lost the PO receipt audit event");

  console.log(JSON.stringify({
    passed: true,
    persistence: "verified after restart",
    lead: lead.ref,
    quote: quote.ref,
    job: job.ref,
    purchaseOrder: purchaseOrder.poNumber,
    auditEvents: auditEvents.length,
  }, null, 2));
}

async function run() {
  await request("/api/workflow-reset", { method: "POST", body: "{}" });

  const leadResult = await request("/api/leads", {
    method: "POST",
    body: JSON.stringify({
      source: "Phone call",
      customerName: "Workflow Test Customer",
      phone: "07700 900123",
      email: "workflow-test@example.com",
      address: "1 Test Street, Aberdeen, AB10 1AA",
      addressParts: {
        line1: "1 Test Street",
        line2: "",
        town: "Aberdeen",
        county: "Aberdeenshire",
        postcode: "AB10 1AA",
      },
      description: "Replace boiler and controls",
      status: "Survey booked",
      surveyor: "Brian Kerr",
      surveyDate: "2026-08-03",
      surveyTime: "09:00",
      createdBy: "Carol",
    }),
  });
  const lead = leadResult.lead;
  assert(lead?.id && lead?.clientId && lead?.siteId, "Lead did not create linked client and site records");

  const quote = await request("/api/quotes", {
    method: "POST",
    body: JSON.stringify({
      ref: "Q-SMOKE",
      sourceLeadId: lead.id,
      sourceLeadRef: lead.ref,
      clientId: lead.clientId,
      siteId: lead.siteId,
      customer: lead.customerName,
      description: lead.description,
      owner: "Brian Kerr",
      status: "Sent",
      value: 5000,
      next: "Await acceptance",
      due: "07 Aug",
      portalToken: "workflow-smoke-token",
      portalUrl: "/quote/workflow-smoke-token",
      sentAt: new Date().toISOString(),
    }),
  });

  await request(`/api/leads/${lead.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Quoted", next: `Quote ${quote.ref} sent` }),
  });

  const viewed = await request("/api/quote-portal/workflow-smoke-token");
  assert(viewed.viewedAt, "Opening the customer portal did not record the first view");

  const accepted = await request("/api/quote-portal/workflow-smoke-token", {
    method: "POST",
    body: JSON.stringify({ response: "Accepted" }),
  });
  assert(accepted.quote?.status === "Converted", "Accepted quote was not moved out of the quote workflow");
  assert(accepted.job?.status === "Pending", "Accepted quote did not create a pending job");
  assert(accepted.job?.sourceQuoteId === quote.id, "Pending job lost its source quote link");

  const scheduled = await request(`/api/jobs/${accepted.job.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      manager: "Errol Watson",
      scheduledDate: "2026-08-10",
      scheduledTime: "08:00",
      scheduledDurationHours: 8,
    }),
  });
  assert(scheduled.status === "In progress", "Scheduled pending job did not move to in progress");

  let clashStatus = 0;
  try {
    await request("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        customer: "Clash Test Customer",
        site: "2 Test Street, Aberdeen",
        description: "This booking must be rejected",
        manager: "Errol Watson",
        scheduledDate: "2026-08-10",
        scheduledTime: "12:00",
        scheduledDurationHours: 1,
        status: "Pending",
        value: 100,
        next: "Attend",
        due: "10 Aug",
      }),
    });
  } catch (error) {
    clashStatus = Number(String(error.message).match(/returned (\d+)/)?.[1] ?? 0);
  }
  assert(clashStatus === 409, "An overlapping booking was allowed during an eight-hour job");

  const purchaseRequest = await request("/api/purchase-requests", {
    method: "POST",
    body: JSON.stringify({
      jobId: accepted.job.id,
      jobRef: accepted.job.ref,
      costCentreId: "cc-boiler",
      costCentreName: "Boiler replacement",
      requestedBy: "Chris Lawson",
      supplier: "Plumbase",
      item: "Open PO",
      estimatedCost: 0,
      reason: "Materials to follow",
      status: "Requested",
    }),
  });
  assert(!purchaseRequest.poNumber, "Engineer request received a PO number before office approval");

  const approved = await request(`/api/purchase-requests/${purchaseRequest.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Approved" }),
  });
  assert(/^PO-\d+$/.test(approved.poNumber), "Approved purchase request did not receive a PO number");

  const received = await request(`/api/purchase-requests/${purchaseRequest.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "Received",
      actualCost: 725,
      invoiceFileName: "INV-100.pdf",
      lines: [
        {
          id: "line-1",
          description: "Boiler",
          quantity: 1,
          estimatedCost: 700,
          actualCost: 725,
          receivedPercent: 100,
        },
      ],
    }),
  });
  assert(received.actualCost === 725, "Received PO did not retain the actual supplier cost");
  assert(received.invoiceFileName === "INV-100.pdf", "Received PO did not retain its invoice evidence");

  const auditEvents = await request("/api/audit");
  const requiredActions = ["created", "viewed", "accepted", "converted", "scheduled", "approved", "received"];
  const missingActions = requiredActions.filter(
    (action) => !auditEvents.some((event) => event.action === action),
  );
  assert(!missingActions.length, `Audit trail is missing: ${missingActions.join(", ")}`);

  console.log(JSON.stringify({
    passed: true,
    lead: lead.ref,
    quote: accepted.quote.ref,
    job: accepted.job.ref,
    purchaseOrder: approved.poNumber,
    auditEvents: auditEvents.length,
  }, null, 2));
}

const action = process.env.NEXA_SMOKE_VERIFY_EXISTING === "1" ? verifyExistingWorkflow : run;

action().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
