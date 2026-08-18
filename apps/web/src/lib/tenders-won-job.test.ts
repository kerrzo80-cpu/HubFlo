import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("Won tender creates Pending Core job and can reopen without deleting it", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-tender-won-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");
  writeServerStore("nexa-tenders-v1", { tenders: [] });
  writeServerStore("workflow-store", { jobs: [], quotes: [], purchaseRequests: [] });
  writeServerStore("hub-detail-store", { invoices: [], jobCostCentres: {}, jobSections: {} });
  writeServerStore("people-store", {
    clients: [],
    clientSites: [],
    employees: [],
    contacts: [],
    contractors: [],
    auditEvents: [],
  });

  const { convertTenderToPendingJob, getTender, rebuildTenderJobCostCentres, updateTender, upsertTender } =
    await import("./tenders-data");
  const { getJobs, getJob } = await import("./workflow-data");
  const { getHubDetailState } = await import("./hub-detail-store");

  function seedTender(id: string) {
    return upsertTender({
      id,
      name: "Queens Terrace Heating",
      client: "Matt McDonald",
      category: "Heating",
      area: "Aberdeen",
      status: "In Progress",
      owner: "Office",
      materialsNote: "3 Queens Terrace",
      boqTitle: "Ground Floor Heating",
      boqLines: [
        {
          id: "l1",
          kind: "measured",
          ref: "1/A",
          description: "Radiator",
          quantity: 2,
          unit: "nr",
          rate: 150,
          value: 300,
        },
      ],
    });
  }

  const converted = convertTenderToPendingJob(seedTender("tender-won-1").id);
  assert.equal(converted.alreadyConverted, false);
  assert.ok(converted.job);
  assert.equal(converted.job?.status, "Pending");
  assert.equal(converted.job?.customer, "Matt McDonald");
  assert.equal(converted.job?.value, 300);
  assert.equal(converted.job?.sourceTenderId, "tender-won-1");
  assert.match(converted.job?.site || "", /Aberdeen/);
  assert.equal(converted.tender.status, "Won");
  assert.equal(converted.tender.convertedJobId, converted.job?.id);
  // Quote-like convert: job + link only — centres come from Rebuild, not Mark Won.
  assert.equal(converted.jobCostCentres.length, 0);
  assert.equal(converted.documentsCopied, 0);

  const viaStatus = updateTender(seedTender("tender-won-2").id, { status: "Won" });
  assert.equal(viaStatus.status, "Won");
  assert.ok(viaStatus.convertedJobId);
  assert.ok(getJobs().find((row) => row.id === viaStatus.convertedJobId));

  const won = convertTenderToPendingJob(seedTender("tender-won-3").id);
  const reopened = updateTender("tender-won-3", { status: "In Progress" });
  assert.equal(reopened.status, "In Progress");
  assert.equal(reopened.convertedJobId, won.job?.id);
  assert.ok(getJob(won.job!.id));

  writeServerStore("nexa-tenders-v1", {
    tenders: [
      {
        id: "tender-won-orphan",
        name: "Orphan Won",
        client: "Client",
        category: "Plumbing",
        area: "Aberdeen",
        status: "Won",
        owner: "Office",
        bidValue: 50,
        tenderSum: 50,
        materialsNote: "",
        qualifications: [],
        daywork: { labourPerHour: 45, materialsUpliftPercent: 15, plantUpliftPercent: 15 },
        boqTitle: "",
        boqLines: [
          {
            id: "l1",
            kind: "measured",
            ref: "1",
            description: "Valve",
            quantity: 1,
            unit: "nr",
            rate: 50,
            value: 50,
          },
        ],
        documents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  assert.equal(getTender("tender-won-orphan")?.convertedJobId, undefined);
  const orphan = convertTenderToPendingJob("tender-won-orphan");
  assert.equal(orphan.alreadyConverted, false);
  assert.ok(orphan.job);

  const first = convertTenderToPendingJob(seedTender("tender-won-4").id);
  const countBefore = getJobs().length;
  const second = convertTenderToPendingJob("tender-won-4");
  assert.equal(second.alreadyConverted, true);
  assert.equal(second.job, null);
  assert.equal(second.tender.convertedJobId, first.job?.id);
  assert.equal(getJobs().length, countBefore);

  const rebuilt = rebuildTenderJobCostCentres("tender-won-4");
  assert.equal(rebuilt.job.id, first.job?.id);
  assert.ok(rebuilt.jobCostCentres.length >= 1);
  const hub = getHubDetailState();
  assert.ok(((hub.jobCostCentres as Record<string, unknown[]>)?.[first.job!.id] || []).length >= 1);
});

test("rebuild from job works when tender.convertedJobId is stale or missing", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-tender-rebuild-job-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");
  writeServerStore("nexa-tenders-v1", { tenders: [] });
  writeServerStore("workflow-store", { jobs: [], quotes: [], purchaseRequests: [] });
  writeServerStore("hub-detail-store", { invoices: [], jobCostCentres: {}, jobSections: {} });
  writeServerStore("people-store", {
    clients: [],
    clientSites: [],
    employees: [],
    contacts: [],
    contractors: [],
    auditEvents: [],
  });

  const { upsertTender, rebuildJobCostCentresFromSourceTender } = await import("./tenders-data");
  const { createJob, getJob } = await import("./workflow-data");
  const { getHubDetailState } = await import("./hub-detail-store");

  const tender = upsertTender({
    id: "tender-stale-link",
    name: "Queens Terrace",
    client: "Matt",
    category: "Heating",
    area: "Aberdeen",
    status: "Won",
    owner: "Office",
    // Intentionally no convertedJobId — Jobs UI only has sourceTenderId.
    boqLines: [
      {
        id: "l1",
        kind: "measured",
        description: "Radiator",
        quantity: 2,
        rate: 150,
        value: 300,
        note: "Ground · guide",
        sheet: "Heating",
      },
    ],
  });

  const job = createJob({
    customer: "Matt",
    site: "3 Queens",
    description: "Heating",
    manager: "Office",
    status: "Pending",
    value: 1,
    next: "Schedule",
    due: "2026-08-13",
    sourceTenderId: tender.id,
    sourceTenderName: tender.name,
  });

  const rebuilt = rebuildJobCostCentresFromSourceTender(job.id);
  assert.equal(rebuilt.job.id, job.id);
  assert.ok(rebuilt.jobCostCentres.length >= 1);
  assert.equal(rebuilt.tender.boqLines.length, 0, "response tender must be lean (no BoQ dump)");
  assert.ok(
    rebuilt.jobCostCentres.every((centre) => centre.materials.length === 0),
    "rebuild response must not dump BoQ line arrays",
  );
  assert.equal(rebuilt.notice, "Rebuilt lean centres (no line dump)");
  assert.equal(rebuilt.documentsCopied, 0, "rebuild must not copy tender PDFs (OOM path)");
  // Job-only rebuild must not rewrite tenders meta (convertedJobId patch removed — crash path).
  assert.equal(rebuilt.tender.convertedJobId, job.id);
  assert.equal(getJob(job.id)?.value, 300);
  const hub = getHubDetailState();
  assert.ok(((hub.jobCostCentres as Record<string, unknown[]>)?.[job.id] || []).length >= 1);
});

test("rebuild from a large BoQ stays lean and does not dump line arrays onto the job", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-tender-rebuild-large-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");
  writeServerStore("nexa-tenders-v1", { tenders: [] });
  writeServerStore("workflow-store", { jobs: [], quotes: [], purchaseRequests: [] });
  writeServerStore("hub-detail-store", { invoices: [], jobCostCentres: {}, jobSections: {} });
  writeServerStore("people-store", {
    clients: [],
    clientSites: [],
    employees: [],
    contacts: [],
    contractors: [],
    auditEvents: [],
  });

  const { upsertTender, rebuildJobCostCentresFromSourceTender, listTendersLean } = await import("./tenders-data");
  const { createJob } = await import("./workflow-data");
  const { getHubDetailState } = await import("./hub-detail-store");

  const boqLines = Array.from({ length: 2500 }, (_, index) => ({
    id: `line-${index}`,
    kind: "measured" as const,
    description: `BoQ measured item ${index} with longer wording for realism`,
    quantity: 2,
    unit: "nr",
    rate: 12.5,
    value: 25,
    sheet: index % 2 === 0 ? "Ground Floor Heating" : "First Floor Hot & cold",
    note: index % 2 === 0 ? "Ground · guide" : "First · guide",
  }));

  const tender = upsertTender({
    id: "tender-large-boq",
    name: "Large BoQ",
    client: "Matt",
    category: "Heating",
    area: "Aberdeen",
    status: "Won",
    owner: "Office",
    boqLines,
  });

  const job = createJob({
    customer: "Matt",
    site: "Site",
    description: "Heating",
    manager: "Office",
    status: "Pending",
    value: 1,
    next: "Schedule",
    due: "2026-08-13",
    sourceTenderId: tender.id,
    sourceTenderName: tender.name,
  });

  const rebuilt = rebuildJobCostCentresFromSourceTender(job.id);
  assert.ok(rebuilt.jobCostCentres.length >= 1);
  assert.ok(
    rebuilt.jobCostCentres.every((centre) => centre.materials.length === 0),
    "large rebuild must stay lean (empty materials)",
  );
  assert.equal(rebuilt.usedSummary, true, "rebuild must use summary, not reload 2500 lines");
  assert.equal(rebuilt.notice, "Rebuilt lean centres (no line dump)");
  const materialCount = rebuilt.jobCostCentres.reduce((sum, centre) => sum + centre.materials.length, 0);
  assert.equal(materialCount, 0);
  assert.equal(listTendersLean().every((row) => row.boqLines.length === 0), true);

  const hub = getHubDetailState();
  const stored = ((hub.jobCostCentres as Record<string, Array<{ materials?: unknown[] }>>)?.[job.id] || []);
  assert.ok(stored.every((centre) => (centre.materials?.length || 0) === 0));

  // Meta store must not retain the 2500-line Bill after upsert/rebuild.
  const { loadServerStore } = await import("./server-store");
  const meta = loadServerStore<{ tenders?: Array<{ id?: string; boqLines?: unknown[] }> }>("nexa-tenders-v1", {
    tenders: [],
  });
  const metaRow = (meta.tenders || []).find((row) => row.id === tender.id);
  assert.equal(metaRow?.boqLines?.length || 0, 0, "tender meta must not store BoQ lines");
  const side = loadServerStore<{ lines?: unknown[] }>(`nexa-tender-boq-v1:${tender.id}`, { lines: [] });
  assert.equal(side.lines?.length || 0, 2500, "BoQ must live in the side store");
});

test("rebuild stays job-only even when tenders meta store is wiped", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-tender-rebuild-jobonly-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");
  writeServerStore("nexa-tenders-v1", { tenders: [] });
  writeServerStore("workflow-store", { jobs: [], quotes: [], purchaseRequests: [] });
  writeServerStore("hub-detail-store", { invoices: [], jobCostCentres: {}, jobSections: {} });
  writeServerStore("people-store", {
    clients: [],
    clientSites: [],
    employees: [],
    contacts: [],
    contractors: [],
    auditEvents: [],
  });

  const { upsertTender, rebuildJobCostCentresFromSourceTender } = await import("./tenders-data");
  const { createJob, getJob } = await import("./workflow-data");
  const { getHubDetailState } = await import("./hub-detail-store");

  const tender = upsertTender({
    id: "tender-job-only",
    name: "Job only",
    client: "Matt",
    category: "Heating",
    area: "Aberdeen",
    status: "Won",
    owner: "Office",
    boqLines: [
      {
        id: "l1",
        kind: "measured",
        description: "Radiator",
        quantity: 4,
        rate: 100,
        value: 400,
        note: "Ground · guide",
        sheet: "Heating",
      },
    ],
  });

  const job = createJob({
    customer: "Matt",
    site: "Site",
    description: "Heating",
    manager: "Office",
    status: "Pending",
    value: 1,
    next: "Schedule",
    due: "2026-08-13",
    sourceTenderId: tender.id,
    sourceTenderName: tender.name,
  });

  // Wipe tenders meta — rebuild must still work from summary + job fields only.
  writeServerStore("nexa-tenders-v1", { tenders: [] });

  const rebuilt = rebuildJobCostCentresFromSourceTender(job.id);
  assert.equal(rebuilt.job.id, job.id);
  assert.ok(rebuilt.jobCostCentres.length >= 1);
  assert.equal(rebuilt.usedSummary, true);
  assert.equal(getJob(job.id)?.value, 400);
  const hub = getHubDetailState();
  assert.ok(((hub.jobCostCentres as Record<string, unknown[]>)?.[job.id] || []).length >= 1);
  const sideCc = (await import("./server-store")).loadServerStore<{ centres?: unknown[] }>(
    `nexa-job-cc-v1:${job.id}`,
    { centres: [] },
  );
  assert.ok((sideCc.centres || []).length >= 1, "rebuild must write per-job side store");
});

test("Won convert is quote-like; Sync drawings copies tender PDFs afterwards", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-tender-docs-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");
  writeServerStore("nexa-tenders-v1", { tenders: [] });
  writeServerStore("workflow-store", { jobs: [], quotes: [], purchaseRequests: [] });
  writeServerStore("hub-detail-store", { invoices: [], jobCostCentres: {}, jobSections: {} });
  writeServerStore("record-documents-store", { documents: [] });
  writeServerStore("people-store", {
    clients: [],
    clientSites: [],
    employees: [],
    contacts: [],
    contractors: [],
    auditEvents: [],
  });

  const { saveUploadedRecordDocument, listRecordDocuments } = await import("./record-documents");
  const { convertTenderToPendingJob, upsertTender, syncTenderDocumentsToLinkedJob } = await import("./tenders-data");

  const uploaded = saveUploadedRecordDocument({
    scope: "tender",
    recordRef: "tender-docs-1",
    folderId: "drawing",
    visibility: "Engineer",
    fileName: "Ground Floor Heating.pdf",
    mimeType: "application/pdf",
    bytes: Buffer.from("%PDF-1.4 tender drawing"),
  });

  const tender = upsertTender({
    id: "tender-docs-1",
    name: "Queens Terrace",
    client: "Matt",
    category: "Heating",
    area: "Aberdeen",
    status: "In Progress",
    owner: "Office",
    documents: [
      {
        id: "tdoc-1",
        kind: "drawing",
        name: "Ground Floor Heating.pdf",
        mimeType: "application/pdf",
        url: uploaded.fileUrl,
        uploadedAt: new Date().toISOString(),
        folderId: "folder-heating",
      },
    ],
    documentFolders: [{ id: "folder-heating", name: "Heating", parentId: "drawing" }],
    boqLines: [
      {
        id: "l1",
        kind: "measured",
        description: "Radiator",
        quantity: 1,
        rate: 100,
        value: 100,
      },
    ],
  });

  const converted = convertTenderToPendingJob(tender.id);
  assert.ok(converted.job);
  assert.equal(converted.documentsCopied, 0, "Mark Won must not copy PDFs (OOM path)");
  assert.equal(listRecordDocuments("job", converted.job!.ref).length, 0);

  const synced = syncTenderDocumentsToLinkedJob(tender.id);
  assert.equal(synced.copied, 1);
  const jobDocs = listRecordDocuments("job", converted.job!.ref);
  assert.equal(jobDocs.length, 1);
  assert.match(jobDocs[0]!.name, /Heating/);
  assert.equal(jobDocs[0]!.folderId, "drawings");

  const syncedAgain = syncTenderDocumentsToLinkedJob(tender.id);
  assert.equal(syncedAgain.copied, 0);
  assert.equal(syncedAgain.skippedDuplicate, 1);
});

test("Mark Won never loads BoQ line arrays even when side store is huge", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-tender-won-light-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");
  writeServerStore("nexa-tenders-v1", { tenders: [] });
  writeServerStore("workflow-store", { jobs: [], quotes: [], purchaseRequests: [] });
  writeServerStore("hub-detail-store", { invoices: [], jobCostCentres: {}, jobSections: {} });
  writeServerStore("people-store", {
    clients: [],
    clientSites: [],
    employees: [],
    contacts: [],
    contractors: [],
    auditEvents: [],
  });

  const { upsertTender, convertTenderToPendingJob } = await import("./tenders-data");

  const boqLines = Array.from({ length: 3000 }, (_, index) => ({
    id: `line-${index}`,
    kind: "measured" as const,
    description: `Heavy BoQ line ${index}`,
    quantity: 1,
    rate: 10,
    value: 10,
  }));
  const tender = upsertTender({
    id: "tender-light-won",
    name: "Heavy",
    client: "Matt",
    category: "Heating",
    area: "Aberdeen",
    status: "In Progress",
    owner: "Office",
    tenderSum: 30000,
    bidValue: 30000,
    boqLines,
  });

  const converted = convertTenderToPendingJob(tender.id);
  assert.ok(converted.job);
  assert.equal(converted.job?.status, "Pending");
  assert.equal(converted.job?.value, 30000);
  assert.equal(converted.jobCostCentres.length, 0);
  assert.equal(converted.tender.boqLines.length, 0);
});
