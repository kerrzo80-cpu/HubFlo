import type { Job } from "@/lib/workflow-data";

/** Full/final job invoices move the job into the Archived directory bucket. */
export function shouldMarkJobInvoicedForClaim(claimType?: string | null) {
  return !claimType || claimType === "full";
}

export function jobPatchAfterFullInvoiceSent(invoiceRef: string, dueDate?: string | null): Partial<Job> {
  return {
    status: "Invoiced",
    health: "green",
    next: `Invoice ${invoiceRef} sent. Await payment.`,
    due: dueDate?.trim() || "Complete",
  };
}

export function jobIsArchivedStatus(status: string) {
  return status === "Invoiced" || status === "Closed";
}
