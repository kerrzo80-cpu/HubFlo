export type XeroExportInvoiceLike = {
  status: string;
  claimType?: string;
  lines?: unknown[];
  accountsStatus?: string;
};

/** Sales invoices/credits eligible for Xero → Sales to export (client-side queue). */
export function invoiceEligibleForXeroExport(invoice: XeroExportInvoiceLike): boolean {
  if (invoice.claimType === "valuation") return false;
  if (invoice.status === "Cancelled" || invoice.status === "Draft") return false;
  if (!invoice.lines?.length) return false;
  return (invoice.accountsStatus || "Not sent") !== "Sent";
}

/** Draft invoices with lines — need Send / Record sent before Xero export. */
export function invoiceDraftPendingXeroSend(invoice: XeroExportInvoiceLike): boolean {
  if (invoice.claimType === "valuation") return false;
  if (invoice.status !== "Draft") return false;
  if (!invoice.lines?.length) return false;
  return (invoice.accountsStatus || "Not sent") !== "Sent";
}
