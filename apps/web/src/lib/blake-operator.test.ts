import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AccessProfile } from "@/lib/access";
import { listPermittedBlakeCapabilities } from "@/lib/blake-operator";

function access(overrides: Partial<AccessProfile> = {}): AccessProfile {
  return {
    showCustomers: true,
    showJobs: true,
    showQuotes: true,
    showAssets: true,
    showStock: true,
    showFinance: true,
    showSchedule: true,
    canCreateJob: false,
    canCreateQuote: false,
    canCreateLead: false,
    canEditJobs: false,
    canDeleteJobs: false,
    canRequestPurchase: false,
    canApprovePurchase: false,
    canCustomize: false,
    canEditInvoice: false,
    ...overrides,
  };
}

describe("Blake operator permissions", () => {
  it("does not expose write capabilities to a read-only user", () => {
    assert.deepEqual(listPermittedBlakeCapabilities(access()), []);
  });

  it("uses the existing Blake lead and quote permissions", () => {
    assert.deepEqual(
      listPermittedBlakeCapabilities(access({ canCreateLead: true, canCreateQuote: true })),
      ["create_lead", "update_lead", "create_quote", "update_quote"],
    );
  });

  it("separates job creation from job editing", () => {
    assert.deepEqual(
      listPermittedBlakeCapabilities(access({ canCreateJob: true })),
      ["create_job"],
    );
    assert.deepEqual(
      listPermittedBlakeCapabilities(access({ canEditJobs: true })),
      ["update_job"],
    );
  });
});
