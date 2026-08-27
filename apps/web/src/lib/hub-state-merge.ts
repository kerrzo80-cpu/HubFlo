import type { HubDetailState } from "@/lib/hub-detail-store";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function lineArrayHasDistinctCost(rows: unknown[]): boolean {
  let sawSell = false;
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const sell = Number(record.unitSell) || 0;
    const cost = Number(record.unitCost) || 0;
    if (sell > 0) sawSell = true;
    if (sell > 0 && cost > 0 && Math.abs(cost - sell) >= 0.005) return true;
  }
  // No sell lines → not a charge-only stamp to defend against.
  return !sawSell;
}

function preferRicherLineArray(serverArr: unknown[], clientArr: unknown[]): unknown[] | null {
  if (serverArr.length > clientArr.length) return serverArr;
  if (!serverArr.length) return null;
  if (serverArr.length === clientArr.length) {
    const serverDistinct = lineArrayHasDistinctCost(serverArr);
    const clientDistinct = lineArrayHasDistinctCost(clientArr);
    // Stale browser tab still holding cost===sell must not wipe a fresh import.
    if (serverDistinct && !clientDistinct) return serverArr;
  }
  return null;
}

function eventId(value: unknown) {
  const record = asRecord(value);
  return typeof record?.id === "string" && record.id.trim() ? record.id.trim() : "";
}

function isProtectedDeliveryEvent(value: unknown) {
  const record = asRecord(value);
  if (!record) return false;
  const id = String(record.id || "");
  return (
    record.formType === "daywork" ||
    id.startsWith("daywork-") ||
    record.source === "Engineer app" ||
    record.source === "Field"
  );
}

function isDayworkEvidenceKey(key: string) {
  return key.includes(":daywork-");
}

function evidenceCapturedAt(value: unknown) {
  const record = asRecord(value);
  const at = typeof record?.capturedAt === "string" ? Date.parse(record.capturedAt) : NaN;
  return Number.isFinite(at) ? at : 0;
}

function evidenceHasContent(value: unknown) {
  const record = asRecord(value);
  if (!record) return false;
  return Boolean(
    String(record.text || "").trim() ||
      String(record.numberValue || "").trim() ||
      String(record.photoName || "").trim(),
  );
}

function isSignatureDataUrl(value: unknown) {
  return String(asRecord(value)?.text || "").startsWith("data:image/");
}

/** Merge delivery events by id; keep Field/daywork signed events Core may not have loaded yet. */
export function mergeJobDeliveryEvents(serverValue: unknown, clientValue: unknown) {
  const server = Array.isArray(serverValue) ? serverValue : [];
  const client = Array.isArray(clientValue) ? clientValue : [];
  const byId = new Map<string, Record<string, unknown>>();

  for (const item of server) {
    const id = eventId(item);
    const record = asRecord(item);
    if (id && record) byId.set(id, record);
  }

  for (const item of client) {
    const id = eventId(item);
    const record = asRecord(item);
    if (!id || !record) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, record);
      continue;
    }

    if (isProtectedDeliveryEvent(existing) || isProtectedDeliveryEvent(record)) {
      const serverSigned = Boolean(
        String(existing.plumberSignature || "").trim() && String(existing.clientSignature || "").trim(),
      );
      const clientSigned = Boolean(
        String(record.plumberSignature || "").trim() && String(record.clientSignature || "").trim(),
      );
      byId.set(id, {
        ...existing,
        ...record,
        // Never drop Field signatures / hours / materials when Core is stale.
        plumberSignature: record.plumberSignature || existing.plumberSignature,
        clientSignature: record.clientSignature || existing.clientSignature,
        plumberSignerName: record.plumberSignerName || existing.plumberSignerName,
        clientSignerName: record.clientSignerName || existing.clientSignerName,
        hours: record.hours ?? existing.hours,
        materials: record.materials || existing.materials,
        formType: "daywork",
        source: existing.source || record.source || "Engineer app",
        status: serverSigned || clientSigned ? record.status || existing.status : record.status || existing.status,
        costValue:
          Number(record.costValue) > Number(existing.costValue || 0) ? record.costValue : existing.costValue ?? record.costValue,
        sellValue:
          Number(record.sellValue) > Number(existing.sellValue || 0) ? record.sellValue : existing.sellValue ?? record.sellValue,
      });
      continue;
    }

    byId.set(id, { ...existing, ...record });
  }

  // Preserve protected server events that the client omitted (stale Core tab).
  for (const item of server) {
    const id = eventId(item);
    const record = asRecord(item);
    if (!id || !record || !isProtectedDeliveryEvent(record)) continue;
    if (!client.some((entry) => eventId(entry) === id)) {
      byId.set(id, record);
    }
  }

  return Array.from(byId.values());
}

/** Prefer Field/daywork evidence over stale Core autosaves. */
export function mergeFlowStepEvidence(serverValue: unknown, clientValue: unknown) {
  const server = asRecord(serverValue) || {};
  const client = asRecord(clientValue) || {};
  const keys = new Set([...Object.keys(server), ...Object.keys(client)]);
  const merged: Record<string, unknown> = {};

  for (const key of keys) {
    const serverEntry = server[key];
    const clientEntry = client[key];
    if (serverEntry == null) {
      merged[key] = clientEntry;
      continue;
    }
    if (clientEntry == null) {
      merged[key] = serverEntry;
      continue;
    }

    if (isDayworkEvidenceKey(key)) {
      const serverContent = evidenceHasContent(serverEntry);
      const clientContent = evidenceHasContent(clientEntry);
      if (serverContent && !clientContent) {
        merged[key] = serverEntry;
        continue;
      }
      if (isSignatureDataUrl(serverEntry) && !isSignatureDataUrl(clientEntry)) {
        merged[key] = { ...(asRecord(clientEntry) || {}), ...(asRecord(serverEntry) || {}) };
        continue;
      }
      if (evidenceCapturedAt(serverEntry) >= evidenceCapturedAt(clientEntry) && serverContent) {
        merged[key] = { ...(asRecord(clientEntry) || {}), ...(asRecord(serverEntry) || {}) };
        continue;
      }
      // Client may hold newer office rates — keep server signatures/text where client emptied them.
      const serverRecord = asRecord(serverEntry) || {};
      const clientRecord = asRecord(clientEntry) || {};
      merged[key] = {
        ...serverRecord,
        ...clientRecord,
        text: String(clientRecord.text || "").trim() || serverRecord.text,
        numberValue: String(clientRecord.numberValue || "").trim() || serverRecord.numberValue,
        photoName: String(clientRecord.photoName || "").trim() || serverRecord.photoName,
        capturedAt:
          evidenceCapturedAt(serverEntry) >= evidenceCapturedAt(clientEntry)
            ? serverRecord.capturedAt || clientRecord.capturedAt
            : clientRecord.capturedAt || serverRecord.capturedAt,
      };
      continue;
    }

    merged[key] = { ...(asRecord(serverEntry) || {}), ...(asRecord(clientEntry) || {}) };
  }

  return merged;
}

function mergeStringKeyedRecords(serverValue: unknown, clientValue: unknown) {
  const server = asRecord(serverValue) || {};
  const client = asRecord(clientValue) || {};
  return { ...server, ...client };
}

function mergeJobCostCentres(serverValue: unknown, clientValue: unknown) {
  const server = asRecord(serverValue) || {};
  const client = asRecord(clientValue) || {};
  const jobIds = new Set([...Object.keys(server), ...Object.keys(client)]);
  const merged: Record<string, unknown[]> = {};

  for (const jobId of jobIds) {
    const serverCentres = Array.isArray(server[jobId]) ? (server[jobId] as unknown[]) : [];
    const clientCentres = Array.isArray(client[jobId]) ? (client[jobId] as unknown[]) : [];
    const byId = new Map<string, Record<string, unknown>>();

    for (const item of serverCentres) {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (id) byId.set(id, record!);
    }
    for (const item of clientCentres) {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (!id || !record) continue;
      byId.set(id, { ...(byId.get(id) || {}), ...record });
    }
    for (const item of serverCentres) {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (!id || !record) continue;
      const isDaywork =
        id.includes("daywork") ||
        /daywork/i.test(String(record.name || "")) ||
        /daywork/i.test(String(record.templateName || ""));
      if (isDaywork && !clientCentres.some((entry) => asRecord(entry)?.id === id)) {
        byId.set(id, record);
      }
    }
    merged[jobId] = Array.from(byId.values());
  }

  return merged;
}

function mergeJobVariationSections(serverValue: unknown, clientValue: unknown) {
  const server = asRecord(serverValue) || {};
  const client = asRecord(clientValue) || {};
  const jobIds = new Set([...Object.keys(server), ...Object.keys(client)]);
  const merged: Record<string, unknown[]> = {};

  for (const jobId of jobIds) {
    const serverSections = Array.isArray(server[jobId]) ? (server[jobId] as unknown[]) : [];
    const clientSections = Array.isArray(client[jobId]) ? (client[jobId] as unknown[]) : [];
    const byId = new Map<string, Record<string, unknown>>();

    for (const item of serverSections) {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (id) byId.set(id, record!);
    }
    for (const item of clientSections) {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (!id || !record) continue;
      byId.set(id, { ...(byId.get(id) || {}), ...record });
    }
    for (const item of serverSections) {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (!id || !record) continue;
      const isDaywork = id.includes("daywork") || /daywork/i.test(String(record.name || ""));
      if (isDaywork && !clientSections.some((entry) => asRecord(entry)?.id === id)) {
        byId.set(id, record);
      }
    }
    merged[jobId] = Array.from(byId.values());
  }

  return merged;
}

/** Durable Field daywork snapshots — always prefer newer signed server copies. */
export function mergeDayworkSheets(serverValue: unknown, clientValue: unknown) {
  const server = asRecord(serverValue) || {};
  const client = asRecord(clientValue) || {};
  const keys = new Set([...Object.keys(server), ...Object.keys(client)]);
  const merged: Record<string, unknown> = {};

  for (const key of keys) {
    const serverSheet = asRecord(server[key]);
    const clientSheet = asRecord(client[key]);
    if (!serverSheet) {
      merged[key] = clientSheet;
      continue;
    }
    if (!clientSheet) {
      merged[key] = serverSheet;
      continue;
    }
    const serverAt = Date.parse(String(serverSheet.updatedAt || serverSheet.completedAt || "")) || 0;
    const clientAt = Date.parse(String(clientSheet.updatedAt || clientSheet.completedAt || "")) || 0;
    const serverSigned = Boolean(
      String(serverSheet.plumberSignature || "").trim() && String(serverSheet.clientSignature || "").trim(),
    );
    const clientSigned = Boolean(
      String(clientSheet.plumberSignature || "").trim() && String(clientSheet.clientSignature || "").trim(),
    );

    if (serverSigned && !clientSigned) {
      merged[key] = {
        ...clientSheet,
        ...serverSheet,
        // Keep any newer office pricing from Core.
        labourRate: clientSheet.labourRate || serverSheet.labourRate,
        materialsCost: clientSheet.materialsCost || serverSheet.materialsCost,
        plantCost: clientSheet.plantCost || serverSheet.plantCost,
        markupPercent: clientSheet.markupPercent || serverSheet.markupPercent,
        materialsJson: mergeLineJsonPreferringUnitCosts(serverSheet.materialsJson, clientSheet.materialsJson),
        plantJson: mergeLineJsonPreferringUnitCosts(serverSheet.plantJson, clientSheet.plantJson),
      };
      continue;
    }

    const preferred = clientAt > serverAt ? { ...serverSheet, ...clientSheet } : { ...clientSheet, ...serverSheet };
    merged[key] = {
      ...preferred,
      description: preferred.description || serverSheet.description || clientSheet.description,
      weekEnding: preferred.weekEnding || serverSheet.weekEnding || clientSheet.weekEnding,
      labourName: preferred.labourName || serverSheet.labourName || clientSheet.labourName,
      labourTrade: preferred.labourTrade || serverSheet.labourTrade || clientSheet.labourTrade,
      labourDaysJson: preferred.labourDaysJson || serverSheet.labourDaysJson || clientSheet.labourDaysJson,
      labourHours: preferred.labourHours || serverSheet.labourHours || clientSheet.labourHours,
      materialsJson: mergeLineJsonPreferringUnitCosts(serverSheet.materialsJson, clientSheet.materialsJson),
      plantJson: mergeLineJsonPreferringUnitCosts(serverSheet.plantJson, clientSheet.plantJson),
      plumberSignature: preferred.plumberSignature || serverSheet.plumberSignature || clientSheet.plumberSignature,
      clientSignature: preferred.clientSignature || serverSheet.clientSignature || clientSheet.clientSignature,
      plumberSignerName: preferred.plumberSignerName || serverSheet.plumberSignerName || clientSheet.plumberSignerName,
      clientSignerName: preferred.clientSignerName || serverSheet.clientSignerName || clientSheet.clientSignerName,
    };
  }

  return merged;
}

/** Keep Field line descriptions/qty and prefer whichever side has unitCost. */
function mergeLineJsonPreferringUnitCosts(serverValue: unknown, clientValue: unknown) {
  const serverText = typeof serverValue === "string" ? serverValue : "";
  const clientText = typeof clientValue === "string" ? clientValue : "";
  if (!serverText.trim()) return clientText;
  if (!clientText.trim()) return serverText;
  try {
    const serverLines = JSON.parse(serverText) as unknown;
    const clientLines = JSON.parse(clientText) as unknown;
    if (!Array.isArray(serverLines) || !Array.isArray(clientLines)) {
      return clientText.length >= serverText.length ? clientText : serverText;
    }
    // Prefer the longer description/qty list (usually Field), overlay unit costs from either.
    const base = serverLines.length >= clientLines.length ? serverLines : clientLines;
    const other = base === serverLines ? clientLines : serverLines;
    const merged = base.map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const match = other[index] && typeof other[index] === "object" ? (other[index] as Record<string, unknown>) : {};
      const description = String(row.description || match.description || "").trim();
      const qty = String(row.qty ?? match.qty ?? "").trim();
      const unitCost = String(row.unitCost || match.unitCost || "").trim();
      return {
        description,
        qty,
        ...(unitCost ? { unitCost } : {}),
      };
    });
    return JSON.stringify(merged.filter((row) => row.description || row.qty));
  } catch {
    return clientText || serverText;
  }
}

function paymentKey(payment: Record<string, unknown>) {
  const sourcePaymentId = typeof payment.sourcePaymentId === "string" ? payment.sourcePaymentId.trim() : "";
  if (sourcePaymentId) return sourcePaymentId;
  const id = typeof payment.id === "string" ? payment.id.trim() : "";
  return id;
}

/** Union payment rows by id/sourcePaymentId so SumUp webhook rows survive stale Core autosaves. */
export function mergeInvoicePayments(serverValue: unknown, clientValue: unknown) {
  const server = Array.isArray(serverValue) ? serverValue : [];
  const client = Array.isArray(clientValue) ? clientValue : [];
  if (!client.length && server.length) return server;
  if (!server.length) return client;

  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of server) {
    const record = asRecord(item);
    const key = record ? paymentKey(record) : "";
    if (key && record) byKey.set(key, record);
  }
  for (const item of client) {
    const record = asRecord(item);
    const key = record ? paymentKey(record) : "";
    if (!key || !record) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, record);
      continue;
    }
    byKey.set(key, {
      ...existing,
      ...record,
      // Prefer any Xero linkage already recorded on either side.
      xeroPaymentId: existing.xeroPaymentId || record.xeroPaymentId,
      xeroPushStatus: existing.xeroPushStatus || record.xeroPushStatus,
      sourceInvoiceId: existing.sourceInvoiceId || record.sourceInvoiceId,
      note: String(record.note || existing.note || ""),
    });
  }
  return Array.from(byKey.values());
}

function paymentStatusFromAmounts(paidAmount: number, chargeTotal: number, vatRate: number) {
  const total = Math.round((chargeTotal + chargeTotal * ((vatRate || 0) / 100)) * 100) / 100;
  if (paidAmount <= 0) return "Unpaid" as const;
  if (paidAmount + 0.009 >= total) return "Paid" as const;
  return "Part paid" as const;
}

/**
 * Merge invoice arrays by id so a stale Core autosave cannot drop Field-created drafts
 * (or any invoice the browser payload omitted).
 */
export function mergeInvoicesById(serverValue: unknown, clientValue: unknown) {
  const server = Array.isArray(serverValue) ? serverValue : [];
  const client = Array.isArray(clientValue) ? clientValue : [];
  // Empty browser payload must never wipe server invoices.
  if (!client.length && server.length) return server;

  const byId = new Map<string, Record<string, unknown>>();
  for (const item of server) {
    const record = asRecord(item);
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    if (id && record) byId.set(id, record);
  }
  for (const item of client) {
    const record = asRecord(item);
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    if (!id || !record) continue;
    const existing = byId.get(id) || {};
    const next = { ...existing, ...record };
    // Prefer richer line lists (Field draft / office edit) when one side is empty.
    const serverLines = Array.isArray(existing.lines) ? (existing.lines as unknown[]) : [];
    const clientLines = Array.isArray(record.lines) ? (record.lines as unknown[]) : [];
    if (serverLines.length && !clientLines.length) next.lines = serverLines;
    if (clientLines.length && !serverLines.length) next.lines = clientLines;
    // Never lose a Sent / Queued accounts export marker from the other side.
    const serverAccounts = String(existing.accountsStatus || "");
    const clientAccounts = String(record.accountsStatus || "");
    if (serverAccounts === "Sent" && clientAccounts !== "Sent") {
      next.accountsStatus = existing.accountsStatus;
      if (existing.xeroInvoiceId) next.xeroInvoiceId = existing.xeroInvoiceId;
      if (existing.xeroExportedAt) next.xeroExportedAt = existing.xeroExportedAt;
    }
    // Protect SumUp / Xero payment ledger from stale unpaid Core autosaves.
    const mergedPayments = mergeInvoicePayments(existing.payments, record.payments) as Array<
      Record<string, unknown>
    >;
    next.payments = mergedPayments;
    if (mergedPayments.length) {
      const paidAmount =
        Math.round(mergedPayments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100) / 100;
      next.paidAmount = paidAmount;
      const chargeTotal = Number(next.chargeTotal ?? existing.chargeTotal ?? record.chargeTotal) || 0;
      const vatRate = Number(next.vatRate ?? existing.vatRate ?? record.vatRate) || 0;
      const paymentStatus = paymentStatusFromAmounts(paidAmount, chargeTotal, vatRate);
      next.paymentStatus = paymentStatus;
      if (paymentStatus === "Paid") next.status = "Paid";
      else if (paymentStatus === "Part paid") next.status = "Partially paid";
    } else {
      // Keep server paid markers when client wiped payments but left stale unpaid fields.
      const serverPaid = Number(existing.paidAmount) || 0;
      const clientPaid = Number(record.paidAmount) || 0;
      if (serverPaid > clientPaid) {
        next.paidAmount = existing.paidAmount;
        next.paymentStatus = existing.paymentStatus;
        if (existing.status === "Paid" || existing.status === "Partially paid") {
          next.status = existing.status;
        }
      }
    }
    byId.set(id, next);
  }
  // Keep server invoices the client omitted (stale Core tab after Field auto-draft).
  for (const item of server) {
    const record = asRecord(item);
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    if (!id || !record) continue;
    if (!client.some((entry) => {
      const clientRecord = asRecord(entry);
      return typeof clientRecord?.id === "string" && clientRecord.id.trim() === id;
    })) {
      byId.set(id, record);
    }
  }
  return Array.from(byId.values());
}

function mergeKeyedArraysById(serverValue: unknown, clientValue: unknown) {
  const server = asRecord(serverValue) || {};
  const client = asRecord(clientValue) || {};
  const keys = new Set([...Object.keys(server), ...Object.keys(client)]);
  const merged: Record<string, unknown[]> = {};

  for (const key of keys) {
    const serverRows = Array.isArray(server[key]) ? (server[key] as unknown[]) : [];
    const clientRows = Array.isArray(client[key]) ? (client[key] as unknown[]) : [];
    // Never let an empty browser payload wipe richer server import data.
    if (!clientRows.length && serverRows.length) {
      merged[key] = serverRows;
      continue;
    }
    const byId = new Map<string, Record<string, unknown>>();
    for (const item of serverRows) {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (id && record) byId.set(id, record);
    }
    for (const item of clientRows) {
      const record = asRecord(item);
      const id = typeof record?.id === "string" ? record.id : "";
      if (!id || !record) continue;
      const existing = byId.get(id) || {};
      const next = { ...existing, ...record };
      // Prefer richer line arrays so a stale browser tab cannot strip imported materials/labour
      // or re-stamp charge-only (cost===sell) prices over a good Apply write.
      for (const field of ["lines", "materials", "labour", "labor"] as const) {
        const serverArr = Array.isArray(existing[field]) ? (existing[field] as unknown[]) : [];
        const clientArr = Array.isArray(record[field]) ? (record[field] as unknown[]) : [];
        const preferred = preferRicherLineArray(serverArr, clientArr);
        if (preferred) next[field] = preferred;
      }
      const serverDesc = String(existing.clientDescription || existing.engineerDescription || "").trim();
      const clientDesc = String(record.clientDescription || record.engineerDescription || "").trim();
      if (serverDesc.length > clientDesc.length) {
        if (existing.clientDescription) next.clientDescription = existing.clientDescription;
        if (existing.engineerDescription) next.engineerDescription = existing.engineerDescription;
      }
      byId.set(id, next);
    }
    merged[key] = Array.from(byId.values());
  }

  return merged;
}

/**
 * Sticky-OR merge for passaround ticks. Once Chris/Commercial/Carol is true on the
 * server, a stale Core autosave must not wipe it back to false (that demoted
 * Ready-to-invoice jobs via withEnforcedInvoiceReview). Explicit unticks go through
 * the passaround API, which writes hub detail directly.
 */
export function mergeJobReviews(serverValue: unknown, clientValue: unknown) {
  const server = asRecord(serverValue) || {};
  const client = asRecord(clientValue) || {};
  const keys = new Set([...Object.keys(server), ...Object.keys(client)]);
  const merged: Record<string, Record<string, boolean>> = {};
  for (const jobId of keys) {
    const s = asRecord(server[jobId]) || {};
    const c = asRecord(client[jobId]) || {};
    merged[jobId] = {
      construction: s.construction === true || c.construction === true,
      commercial: s.commercial === true || c.commercial === true,
      office: s.office === true || c.office === true,
    };
  }
  return merged;
}

/**
 * Merge a Core client hub PUT onto the live server hub so Field/daywork writes
 * are not wiped by a stale browser tab.
 */
export function mergeHubDetailState(serverState: HubDetailState, clientState: HubDetailState): HubDetailState {
  return {
    ...serverState,
    ...clientState,
    flowStepEvidence: mergeFlowStepEvidence(serverState.flowStepEvidence, clientState.flowStepEvidence),
    flowStepCompletion: mergeStringKeyedRecords(serverState.flowStepCompletion, clientState.flowStepCompletion),
    jobDeliveryEvents: mergeJobDeliveryEvents(serverState.jobDeliveryEvents, clientState.jobDeliveryEvents),
    jobCostCentres: mergeJobCostCentres(serverState.jobCostCentres, clientState.jobCostCentres),
    jobVariationSections: mergeJobVariationSections(serverState.jobVariationSections, clientState.jobVariationSections),
    quoteCostCentres: mergeKeyedArraysById(serverState.quoteCostCentres, clientState.quoteCostCentres),
    quoteSections: mergeKeyedArraysById(serverState.quoteSections, clientState.quoteSections),
    jobSections: mergeKeyedArraysById(serverState.jobSections, clientState.jobSections),
    jobSchedulePlans: mergeKeyedArraysById(serverState.jobSchedulePlans, clientState.jobSchedulePlans),
    quoteSchedulePlans: mergeKeyedArraysById(serverState.quoteSchedulePlans, clientState.quoteSchedulePlans),
    dayworkSheets: mergeDayworkSheets(
      (serverState as HubDetailState & { dayworkSheets?: unknown }).dayworkSheets,
      (clientState as HubDetailState & { dayworkSheets?: unknown }).dayworkSheets,
    ),
    invoices: mergeInvoicesById(serverState.invoices, clientState.invoices),
    jobReviews: mergeJobReviews(serverState.jobReviews, clientState.jobReviews),
  };
}
