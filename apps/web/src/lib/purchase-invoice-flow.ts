/** Supplier invoice upload, second-invoice approval, and credit-note apply for POs. */

import type {
  PendingInvoiceAdjustment,
  PendingInvoiceAdjustmentLine,
  PurchaseOrderLine,
  PurchaseRequest,
  SupplierCreditNote,
  SupplierCreditNoteLine,
  SupplierInvoiceDocument,
} from "@/lib/workflow-data";

export type PurchaseRequestWithSupplierDocs = PurchaseRequest;

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.round(Math.random() * 9999).toString(16)}`;
}

export function listSupplierInvoiceDocuments(po: PurchaseRequest): SupplierInvoiceDocument[] {
  if (Array.isArray(po.supplierInvoiceDocuments) && po.supplierInvoiceDocuments.length) {
    return po.supplierInvoiceDocuments;
  }
  if (typeof po.supplierInvoiceAmount === "number" && Number.isFinite(po.supplierInvoiceAmount)) {
    return [
      {
        id: `legacy-invoice-${po.id}`,
        amount: Math.max(0, po.supplierInvoiceAmount),
        reference: po.supplierInvoiceRef,
        fileName: po.invoiceFileName || `${po.poNumber || po.id} supplier invoice`,
        uploadedAt: po.invoiceReceivedAt || po.updatedAt || po.createdAt,
        status: "Approved",
        isPrimary: true,
      },
    ];
  }
  return [];
}

export function listPendingInvoiceAdjustments(po: PurchaseRequest) {
  return Array.isArray(po.pendingInvoiceAdjustments) ? po.pendingInvoiceAdjustments : [];
}

export function listSupplierCreditNotes(po: PurchaseRequest) {
  return Array.isArray(po.supplierCreditNotes) ? po.supplierCreditNotes : [];
}

export function purchaseRequestOrderedCost(request: PurchaseRequest) {
  if (request.lines?.length) {
    return request.lines.reduce((total, line) => total + (Number(line.estimatedCost) || 0), 0);
  }
  return Number(request.estimatedCost) || 0;
}

export function purchaseRequestActualCost(request: PurchaseRequest) {
  if (request.status === "Rejected") return 0;
  if (request.lines?.length) {
    return request.lines.reduce((total, line) => {
      const receivedRatio = Math.min(100, Math.max(0, line.receivedPercent || 0)) / 100;
      const lineActual = line.actualCost ?? line.estimatedCost;
      return total + lineActual * receivedRatio;
    }, 0);
  }
  if (request.status === "Received") return request.actualCost ?? request.estimatedCost;
  return request.actualCost ?? 0;
}

export function purchaseRequestReceiptPercent(request: PurchaseRequest) {
  if (request.lines?.length) {
    const totalEstimated = request.lines.reduce((total, line) => total + (Number(line.estimatedCost) || 0), 0);
    if (totalEstimated <= 0) {
      const receivedLines = request.lines.filter((line) => (line.receivedPercent || 0) >= 100).length;
      return Math.round((receivedLines / request.lines.length) * 100);
    }
    const receivedValue = request.lines.reduce((total, line) => {
      const receivedRatio = Math.min(100, Math.max(0, line.receivedPercent || 0)) / 100;
      return total + line.estimatedCost * receivedRatio;
    }, 0);
    return Math.round((receivedValue / totalEstimated) * 100);
  }
  if (request.status === "Received") return 100;
  if (request.status === "Part received") return 50;
  return 0;
}

/** Net supplier invoiced amount = approved invoices − applied credits. */
export function purchaseRequestNetInvoicedCost(request: PurchaseRequest) {
  const creditTotal = listSupplierCreditNotes(request)
    .filter((note) => note.status === "Applied")
    .reduce((total, note) => total + Math.max(0, Number(note.creditAmount) || 0), 0);

  if (Array.isArray(request.supplierInvoiceDocuments) && request.supplierInvoiceDocuments.length) {
    const invoiceTotal = request.supplierInvoiceDocuments
      .filter((doc) => doc.status === "Approved" || doc.status === "Matched" || doc.isPrimary)
      .reduce((total, doc) => total + Math.max(0, Number(doc.amount) || 0), 0);
    return Math.max(0, invoiceTotal - creditTotal);
  }

  // Legacy scalar is kept as the net figure after credits are applied.
  if (typeof request.supplierInvoiceAmount === "number" && Number.isFinite(request.supplierInvoiceAmount)) {
    return Math.max(0, request.supplierInvoiceAmount);
  }
  if (request.invoiceReceivedAt || request.invoiceFileName) {
    if (typeof request.actualCost === "number" && Number.isFinite(request.actualCost)) {
      return Math.max(0, request.actualCost);
    }
  }
  return null;
}

export function purchaseRequestThreeWayMatch(request: PurchaseRequest) {
  const ordered = purchaseRequestOrderedCost(request);
  const received = purchaseRequestActualCost(request);
  const invoiced = purchaseRequestNetInvoicedCost(request);
  const receiptPercent = purchaseRequestReceiptPercent(request);
  const tolerance = Math.max(0.02, ordered * 0.01);
  const receivedVsOrdered = Math.abs(received - ordered);
  const invoicedVsOrdered = invoiced === null ? null : Math.abs(invoiced - ordered);
  const invoicedVsReceived = invoiced === null ? null : Math.abs(invoiced - received);

  let status: "Matched" | "Variance" | "Incomplete" = "Incomplete";
  if (receiptPercent >= 100 && invoiced !== null) {
    status =
      receivedVsOrdered <= tolerance &&
      (invoicedVsOrdered ?? Number.POSITIVE_INFINITY) <= tolerance &&
      (invoicedVsReceived ?? Number.POSITIVE_INFINITY) <= tolerance
        ? "Matched"
        : "Variance";
  }

  return {
    ordered,
    received,
    invoiced,
    receiptPercent,
    status,
    orderedVsReceived: received - ordered,
    orderedVsInvoiced: invoiced === null ? null : invoiced - ordered,
    receivedVsInvoiced: invoiced === null ? null : invoiced - received,
  };
}

export function poAlreadyHasApprovedInvoice(po: PurchaseRequest) {
  return listSupplierInvoiceDocuments(po).some(
    (doc) => doc.status === "Approved" || doc.status === "Matched" || Boolean(doc.isPrimary),
  );
}

export function poIsReceipted(po: PurchaseRequest) {
  return po.status === "Received" || po.status === "Part received" || purchaseRequestReceiptPercent(po) > 0;
}

function syncLegacyInvoiceFields(
  docs: SupplierInvoiceDocument[],
  credits: SupplierCreditNote[],
): Pick<PurchaseRequest, "supplierInvoiceAmount" | "supplierInvoiceRef" | "invoiceFileName" | "invoiceReceivedAt"> {
  const approved = docs.filter((doc) => doc.status === "Approved" || doc.status === "Matched" || doc.isPrimary);
  const creditTotal = credits
    .filter((note) => note.status === "Applied")
    .reduce((total, note) => total + Math.max(0, note.creditAmount), 0);
  const amount = Math.max(
    0,
    approved.reduce((total, doc) => total + Math.max(0, doc.amount), 0) - creditTotal,
  );
  const primary = approved.find((doc) => doc.isPrimary) || approved[0];
  return {
    supplierInvoiceAmount: approved.length ? amount : undefined,
    supplierInvoiceRef: primary?.reference,
    invoiceFileName: primary?.fileName,
    invoiceReceivedAt: primary?.uploadedAt,
  };
}

export type SubmitSupplierInvoiceInput = {
  amount: number;
  reference?: string;
  fileName: string;
  documentId?: string;
  fileUrl?: string;
  mimeType?: string;
  uploadedBy: string;
  proposedLines?: Array<{
    description: string;
    quantity: number;
    actualCost: number;
    estimatedCost?: number;
    catalogItemId?: string;
    sku?: string;
    purchaseOrderLineId?: string;
  }>;
  notes?: string;
};

export function submitSupplierInvoice(
  po: PurchaseRequest,
  input: SubmitSupplierInvoiceInput,
): {
  patch: Partial<PurchaseRequest>;
  requiresApproval: boolean;
  document: SupplierInvoiceDocument;
  adjustment?: PendingInvoiceAdjustment;
} {
  const amount = Math.max(0, Number(input.amount) || 0);
  const docs = [...listSupplierInvoiceDocuments(po)].filter((doc) => !String(doc.id).startsWith("legacy-invoice-"));
  for (const legacy of listSupplierInvoiceDocuments(po)) {
    if (String(legacy.id).startsWith("legacy-invoice-") && !docs.some((doc) => doc.isPrimary)) {
      docs.push({ ...legacy, id: newId("inv"), status: "Approved", isPrimary: true });
    }
  }

  const requiresApproval = poAlreadyHasApprovedInvoice(po) && poIsReceipted(po);
  const document: SupplierInvoiceDocument = {
    id: newId("inv"),
    amount,
    reference: input.reference?.trim() || undefined,
    fileName: input.fileName.trim() || `${po.poNumber || po.id} supplier invoice`,
    documentId: input.documentId,
    fileUrl: input.fileUrl,
    mimeType: input.mimeType,
    uploadedAt: new Date().toISOString(),
    uploadedBy: input.uploadedBy,
    status: requiresApproval ? "Pending approval" : "Approved",
    isPrimary: !requiresApproval && docs.every((doc) => !doc.isPrimary),
    notes: input.notes,
  };

  if (requiresApproval) {
    const match = purchaseRequestThreeWayMatch(po);
    const adjustment: PendingInvoiceAdjustment = {
      id: newId("adj"),
      createdAt: new Date().toISOString(),
      createdBy: input.uploadedBy,
      reason: "Second supplier invoice against a receipted PO",
      status: "Awaiting approval",
      invoiceDocumentId: document.id,
      proposedInvoiceAmount: amount,
      proposedInvoiceRef: document.reference,
      proposedLines: (input.proposedLines || []).map((line) => ({
        id: newId("adj-line"),
        purchaseOrderLineId: line.purchaseOrderLineId,
        description: line.description.trim() || "Additional invoice line",
        quantity: Math.max(0, Number(line.quantity) || 0),
        actualCost: Math.max(0, Number(line.actualCost) || 0),
        estimatedCost: line.estimatedCost,
        catalogItemId: line.catalogItemId,
        sku: line.sku,
      })),
      baseline: {
        ordered: match.ordered,
        received: match.received,
        invoiced: match.invoiced,
        matchStatus: match.status,
      },
    };
    const nextDocs = [...docs, document];
    const credits = listSupplierCreditNotes(po);
    return {
      requiresApproval: true,
      document,
      adjustment,
      patch: {
        supplierInvoiceDocuments: nextDocs,
        pendingInvoiceAdjustments: [...listPendingInvoiceAdjustments(po), adjustment],
        status: "Disputed",
        ...syncLegacyInvoiceFields(
          nextDocs.filter((doc) => doc.status !== "Pending approval"),
          credits,
        ),
      },
    };
  }

  const nextDocs = [...docs, document];
  const credits = listSupplierCreditNotes(po);
  const legacy = syncLegacyInvoiceFields(nextDocs, credits);
  return {
    requiresApproval: false,
    document,
    patch: {
      supplierInvoiceDocuments: nextDocs,
      ...legacy,
      actualCost: po.actualCost ?? amount,
    },
  };
}

export function decidePendingInvoiceAdjustment(
  po: PurchaseRequest,
  adjustmentId: string,
  decision: "Approved" | "Rejected",
  actor: string,
  decisionNote?: string,
): { patch: Partial<PurchaseRequest>; adjustment: PendingInvoiceAdjustment } {
  const adjustments = listPendingInvoiceAdjustments(po);
  const target = adjustments.find((item) => item.id === adjustmentId);
  if (!target) throw new Error("That pending invoice adjustment could not be found.");
  if (target.status !== "Awaiting approval") throw new Error("That adjustment has already been decided.");

  const docs = listSupplierInvoiceDocuments(po).map((doc) =>
    doc.id === target.invoiceDocumentId
      ? {
          ...doc,
          status: decision === "Approved" ? ("Approved" as const) : ("Rejected" as const),
        }
      : doc,
  );

  const decided: PendingInvoiceAdjustment = {
    ...target,
    status: decision,
    decidedAt: new Date().toISOString(),
    decidedBy: actor,
    decisionNote: decisionNote?.trim() || undefined,
  };

  let lines = [...(po.lines || [])];
  let actualCost = po.actualCost;
  if (decision === "Approved") {
    for (const proposed of target.proposedLines) {
      if (proposed.purchaseOrderLineId) {
        lines = lines.map((line) => {
          if (line.id !== proposed.purchaseOrderLineId) return line;
          const nextQty = Math.max(0, (Number(line.quantity) || 0) + (Number(proposed.quantity) || 0));
          const nextActual = Math.max(0, (Number(line.actualCost ?? line.estimatedCost) || 0) + (Number(proposed.actualCost) || 0));
          return {
            ...line,
            quantity: nextQty || line.quantity,
            actualCost: nextActual,
            receivedPercent: Math.max(line.receivedPercent || 0, proposed.quantity > 0 ? 100 : line.receivedPercent || 0),
          };
        });
      } else if (proposed.description.trim()) {
        lines.push({
          id: newId("po-line"),
          description: proposed.description,
          quantity: Math.max(1, Number(proposed.quantity) || 1),
          estimatedCost: proposed.estimatedCost ?? proposed.actualCost,
          actualCost: proposed.actualCost,
          receivedPercent: 100,
          catalogItemId: proposed.catalogItemId,
          sku: proposed.sku,
        });
      }
    }
    actualCost = lines.reduce((total, line) => total + (line.actualCost ?? line.estimatedCost), 0);
  }

  const nextAdjustments = adjustments.map((item) => (item.id === adjustmentId ? decided : item));
  const credits = listSupplierCreditNotes(po);
  const awaiting = nextAdjustments.some((item) => item.status === "Awaiting approval");

  return {
    adjustment: decided,
    patch: {
      supplierInvoiceDocuments: docs,
      pendingInvoiceAdjustments: nextAdjustments,
      lines,
      actualCost,
      status: awaiting ? "Disputed" : decision === "Approved" ? "Received" : po.status === "Disputed" ? "Received" : po.status,
      ...syncLegacyInvoiceFields(docs, credits),
    },
  };
}

export type SubmitSupplierCreditInput = {
  creditAmount: number;
  reference?: string;
  fileName: string;
  documentId?: string;
  fileUrl?: string;
  uploadedBy: string;
  applyNow?: boolean;
  lines?: Array<{
    purchaseOrderLineId?: string;
    description: string;
    creditAmount: number;
    quantityRemoved?: number;
    removeLine?: boolean;
  }>;
};

export function submitSupplierCreditNote(
  po: PurchaseRequest,
  input: SubmitSupplierCreditInput,
): { patch: Partial<PurchaseRequest>; credit: SupplierCreditNote } {
  const creditAmount = Math.max(0, Number(input.creditAmount) || 0);
  if (creditAmount <= 0) throw new Error("Enter a credit note amount greater than zero.");

  const credit: SupplierCreditNote = {
    id: newId("credit"),
    creditAmount,
    reference: input.reference?.trim() || undefined,
    fileName: input.fileName.trim() || `${po.poNumber || po.id} credit note`,
    documentId: input.documentId,
    fileUrl: input.fileUrl,
    uploadedAt: new Date().toISOString(),
    uploadedBy: input.uploadedBy,
    status: input.applyNow === false ? "Pending apply" : "Applied",
    lines: (input.lines || []).map((line) => ({
      id: newId("credit-line"),
      purchaseOrderLineId: line.purchaseOrderLineId,
      description: line.description.trim() || "Credit line",
      creditAmount: Math.max(0, Number(line.creditAmount) || 0),
      quantityRemoved: line.quantityRemoved,
      removeLine: line.removeLine,
    })),
    appliedAt: input.applyNow === false ? undefined : new Date().toISOString(),
    appliedBy: input.applyNow === false ? undefined : input.uploadedBy,
  };

  let lines = [...(po.lines || [])] as PurchaseOrderLine[];
  let actualCost = po.actualCost;

  if (credit.status === "Applied") {
    if (credit.lines.length) {
      for (const creditLine of credit.lines) {
        if (creditLine.removeLine && creditLine.purchaseOrderLineId) {
          lines = lines.filter((line) => line.id !== creditLine.purchaseOrderLineId);
          continue;
        }
        if (creditLine.purchaseOrderLineId) {
          lines = lines.map((line) => {
            if (line.id !== creditLine.purchaseOrderLineId) return line;
            const currentActual = Number(line.actualCost ?? line.estimatedCost) || 0;
            const nextActual = Math.max(0, currentActual - creditLine.creditAmount);
            const nextQty =
              creditLine.quantityRemoved && creditLine.quantityRemoved > 0
                ? Math.max(0, (Number(line.quantity) || 0) - creditLine.quantityRemoved)
                : line.quantity;
            return {
              ...line,
              quantity: nextQty || line.quantity,
              actualCost: nextActual,
              estimatedCost: Math.min(line.estimatedCost, nextActual || line.estimatedCost),
            };
          });
        }
      }
      actualCost = lines.reduce((total, line) => total + (line.actualCost ?? line.estimatedCost), 0);
    } else if (lines.length) {
      let remaining = creditAmount;
      lines = lines.map((line, index) => {
        const currentActual = Number(line.actualCost ?? line.estimatedCost) || 0;
        const share =
          index === lines.length - 1 ? remaining : Math.min(currentActual, creditAmount / lines.length);
        remaining = Math.max(0, remaining - share);
        return {
          ...line,
          actualCost: Math.max(0, currentActual - share),
        };
      });
      actualCost = lines.reduce((total, line) => total + (line.actualCost ?? line.estimatedCost), 0);
    } else if (typeof actualCost === "number") {
      actualCost = Math.max(0, actualCost - creditAmount);
    }
  }

  const credits = [...listSupplierCreditNotes(po), credit];
  const docs = listSupplierInvoiceDocuments(po);

  return {
    credit,
    patch: {
      supplierCreditNotes: credits,
      lines,
      actualCost,
      ...syncLegacyInvoiceFields(docs, credits),
    },
  };
}

export function applyPendingSupplierCreditNote(po: PurchaseRequest, creditId: string, actor: string) {
  const notes = listSupplierCreditNotes(po);
  const target = notes.find((note) => note.id === creditId);
  if (!target) throw new Error("That credit note could not be found.");
  if (target.status === "Applied") throw new Error("That credit note is already applied.");
  if (target.status === "Voided") throw new Error("That credit note was voided.");

  const staged: PurchaseRequest = {
    ...po,
    supplierCreditNotes: notes.filter((note) => note.id !== creditId),
  };
  const result = submitSupplierCreditNote(staged, {
    creditAmount: target.creditAmount,
    reference: target.reference,
    fileName: target.fileName,
    documentId: target.documentId,
    fileUrl: target.fileUrl,
    uploadedBy: actor,
    applyNow: true,
    lines: target.lines.map((line) => ({
      purchaseOrderLineId: line.purchaseOrderLineId,
      description: line.description,
      creditAmount: line.creditAmount,
      quantityRemoved: line.quantityRemoved,
      removeLine: line.removeLine,
    })),
  });
  const credit = {
    ...result.credit,
    id: target.id,
    uploadedAt: target.uploadedAt,
    uploadedBy: target.uploadedBy,
  };
  const credits = [...listSupplierCreditNotes(staged), credit];
  return {
    credit,
    patch: {
      ...result.patch,
      supplierCreditNotes: credits,
    },
  };
}

export type { PendingInvoiceAdjustmentLine, SupplierCreditNoteLine };
