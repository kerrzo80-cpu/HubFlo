/**
 * Phase C — map Simpro job/quote headers into NeXa workflow shapes.
 * Hierarchy (sections/CCs/lines) lands in a follow-up tick; headers first.
 */

import type { UnknownRecord } from "@/lib/simpro-client";
import { simproRecordId } from "@/lib/simpro-client";
import type { Quote, QuoteStatus, Job } from "@/lib/workflow-data";

function asString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]+/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function firstString(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    if (key.includes(".")) {
      const [head, ...rest] = key.split(".");
      const nested = record[head ?? ""];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const value = firstString(nested as UnknownRecord, [rest.join(".")]);
        if (value) return value;
      }
      continue;
    }
    const value = asString(record[key]);
    if (value) return value;
  }
  return "";
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function mapSimproQuoteStatus(value: string): QuoteStatus {
  const status = value.toLowerCase();
  if (status.includes("accept") || status.includes("approved")) return "Accepted";
  if (status.includes("declin") || status.includes("reject")) return "Declined";
  if (status.includes("lost")) return "Lost";
  if (status.includes("convert")) return "Converted";
  if (status.includes("sent") || status.includes("issued")) return "Sent";
  return "Draft";
}

export function mapSimproJobHealth(status: string): Job["health"] {
  const value = status.toLowerCase();
  if (value.includes("complete") || value.includes("invoiced")) return "green";
  if (value.includes("hold") || value.includes("wait") || value.includes("part")) return "red";
  if (value.includes("progress") || value.includes("schedule")) return "green";
  return "blue";
}

export type MappedSimproQuote = Omit<Quote, "id" | "ref"> & {
  externalId: string;
  externalNumber?: string;
  sourceModifiedAt?: string;
};

export type MappedSimproJob = Omit<Job, "id" | "ref"> & {
  externalId: string;
  externalNumber?: string;
  sourceModifiedAt?: string;
};

export function mapSimproQuoteHeader(
  record: UnknownRecord,
  links?: { clientId?: string; siteId?: string; customerName?: string },
): MappedSimproQuote | null {
  const externalId = simproRecordId(record);
  if (!externalId) return null;

  const description =
    stripHtml(
      firstString(record, ["Description", "Name", "Title", "Notes", "JobName"]) ||
        `Simpro quote ${externalId}`,
    ) || `Simpro quote ${externalId}`;
  const customer =
    links?.customerName ||
    firstString(record, [
      "Customer.CompanyName",
      "Customer.Name",
      "CustomerName",
      "Client.Name",
      "CompanyName",
    ]) ||
    "Simpro customer";
  const status = mapSimproQuoteStatus(firstString(record, ["Status.Name", "Status", "Stage", "Stage.Name"]));
  const value = asNumber(
    record.Total || record.TotalPrice || record.TotalExTax || record.Amount || record.SellPrice,
    0,
  );

  return {
    externalId,
    externalNumber: firstString(record, ["Number", "QuoteNo", "QuoteNumber", "DisplayName"]) || undefined,
    clientId: links?.clientId,
    siteId: links?.siteId,
    customer,
    description,
    owner: firstString(record, ["Salesperson.Name", "Sales.Name", "CreatedBy.Name", "Manager.Name"]) || "Imported from Simpro",
    status,
    value,
    next: status === "Accepted" ? "Convert to job" : status === "Sent" ? "Await customer response" : "Review imported quote",
    due: firstString(record, ["DueDate", "DateDue", "ExpiryDate"]) || "Imported",
    simproQuoteId: externalId,
    simproStatus: "Sent",
    simproSentAt: new Date().toISOString(),
    sourceModifiedAt: firstString(record, ["DateModified", "Modified", "UpdatedAt", "DateIssued"]) || undefined,
  };
}

export function mapSimproJobHeader(
  record: UnknownRecord,
  links?: { clientId?: string; siteId?: string; customerName?: string; siteAddress?: string },
): MappedSimproJob | null {
  const externalId = simproRecordId(record);
  if (!externalId) return null;

  const description =
    stripHtml(
      firstString(record, ["Description", "Name", "Title", "Notes"]) || `Simpro job ${externalId}`,
    ) || `Simpro job ${externalId}`;
  const customer =
    links?.customerName ||
    firstString(record, [
      "Customer.CompanyName",
      "Customer.Name",
      "CustomerName",
      "Client.Name",
      "CompanyName",
    ]) ||
    "Simpro customer";
  const site =
    links?.siteAddress ||
    firstString(record, ["Site.Name", "Site.Address", "Address", "Location", "SiteName"]) ||
    "Site to confirm";
  const status = firstString(record, ["Status.Name", "Status", "Stage", "Stage.Name"]) || "Imported";
  const value = asNumber(
    record.Total || record.TotalPrice || record.TotalExTax || record.Amount || record.SellPrice,
    0,
  );

  return {
    externalId,
    externalNumber: firstString(record, ["Number", "JobNo", "JobNumber", "DisplayName"]) || undefined,
    clientId: links?.clientId,
    siteId: links?.siteId,
    customer,
    site,
    description,
    manager: firstString(record, ["ProjectManager.Name", "Manager.Name", "Technician.Name"]) || "Imported from Simpro",
    status,
    health: mapSimproJobHealth(status),
    value,
    next: "Review imported job",
    due: firstString(record, ["DueDate", "DateDue", "CompletedDate"]) || "Imported",
    simproJobId: externalId,
    simproStatus: "Sent",
    simproSentAt: new Date().toISOString(),
    sourceModifiedAt: firstString(record, ["DateModified", "Modified", "UpdatedAt"]) || undefined,
  };
}

export function simproCustomerExternalId(record: UnknownRecord) {
  return (
    firstString(record, ["Customer.ID", "Customer.Id", "CustomerID", "Client.ID", "ClientID"]) ||
    ""
  );
}
