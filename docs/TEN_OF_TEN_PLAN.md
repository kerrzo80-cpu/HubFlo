# Path to 10/10 — EWG Core / NeXa

Honest target: **10/10 for EWG-shaped plumbing & heating operations**, then close remaining gaps vs Jobber / Fergus / simPRO / ServiceTitan as a market product.

Baseline (Aug 2026 audit): **~6.5/10 for EWG ops · ~4/10 vs category leaders**.

---

## Scoreboard targets

| Phase | EWG ops score | Market peer score | Outcome |
|-------|--------------:|------------------:|---------|
| **0 — Baseline** | 6.5 | 4 | Live suite with uneven maturity |
| **1 — Trust the spine** | **8.0** | 5.5 | Offline Field, Heat Design saved, board-pack reports, invoice portal |
| **2 — Commercial close** | **9.0** | 7 | SumUp pay links, client hub, cash↔Xero reconcile, PO stock idempotent, server recurring generate |
| **3 — Category peer** *(this branch)* | **9.5** | 8.5 | Field SW shell, run sheets + travel buffer, Mon board-pack email, Takeoff AI confirm, Heat Design audit |
| **4 — 10/10** | **10** | 9–10 | End-to-end chain polish, no office rescue paths, manager-trusted numbers daily |

True ServiceTitan parity (multi-tenant SaaS, plant GPS, full accounting) is optional and **out of Phase 1–3** unless you decide to productise for other firms.

---

## Phase 1 — Trust the spine *(shipped)*

1. **Heat Design server projects** — firm register, not browser-only lab  
2. **Field offline outbox** — checklist / daywork / photos queue + sync  
3. **Reports board pack PDF + Excel** — managers can download what they see  
4. **Invoice customer portal** — view balance / mark paid intent / public token (quote portal already exists)  
5. **Public `/client/*` routes** — portals work without pilot login  

**Done when:** health shows `heatDesignPersistence`, `fieldOfflineOutbox`, `reportsBoardPack`, `invoicePortal`; iPad Field survives airplane mode for checklist/daywork; Heat Design projects survive browser clear; Reports → PDF downloads a branded pack.

---

## Phase 2 — Commercial close *(shipped)*

1. **SumUp Hosted Checkout** on invoice portal (same partner as office reader) + Setup key card + webhook  
2. **Client hub** `/client/hub/[token]` — open quotes, invoices, variations, job status  
3. **Cash reconcile** on Reports → WIP — NeXa owed vs Xero/SumUp/manual + batch Xero pull  
4. **PO receive → stock** idempotent `receiptKey` (no double-stock)  
5. **Server recurring generate** — `POST /api/recurring` `generate` / `generate-due`

**Done when:** health shows `tenOfTenPlan: phase-2-commercial-v1`, `sumupPayLinks`, `clientPortalHub`, `cashReconcile`, `poStockReceive`, `recurringGenerate`. Add SumUp API key + merchant code in Setup (or env) to enable Pay online.  

---

## Phase 3 — Category peer *(shipped)*

1. **Field service worker** `/sw-field.js` — caches Field shell; outbox still handles writes  
2. **Dispatch run sheets** `/api/dispatch/run-sheet` with **20m travel buffer** clash warnings  
3. **Monday board pack email** — Reports → Schedule email + `/api/reports/board-pack/cron`  
4. **Takeoff AI confirm** — OverlayReview before Core push (`takeoffAiConfirm`)  
5. **Heat Design audit** — revision history + design pack labelling (`heatDesignAudit`)  

**Done when:** health shows `tenOfTenPlan: phase-3-category-peer-v1`, `fieldServiceWorker`, `dispatchRunSheet`, `boardPackEmail`, `takeoffAiConfirm`, `heatDesignAudit`.

---

## Phase 4 — 10/10 for EWG *(in progress / shipped on this branch)*

1. **Unified manager board pack** — `buildManagerBoardPackRows()` shared with Monday cron; cash owed, ready-to-invoice, WIP, variations portal, payment split, `asAt` timestamp, overhead label  
2. **Cash reconcile period mark** — `POST/GET /api/reports/cash-reconcile` + Reports → WIP button  
3. **Chain continuity** — Takeoff push creates quote when no `linkedQuoteId`; Field Complete → Draft invoice claim; quote `metadata` chain ids (takeoff / survey / heat design)  
4. No simPRO required for daily path (optional sync only)  
5. Customer can accept quote, approve variation, pay invoice online  
6. Engineer completes day offline and syncs without office rescue  
7. Manager trusts Reports numbers enough to stop building Excel side-books  
8. Survey → Takeoff → Heat Design → Quote → Job → Field → Invoice is one continuous chain  

**Done when:** health shows `tenOfTenPlan: phase-4-ten-of-ten-v1`, `reportsTrustPack`, `opsChainContinuity`, `portalHandoffAuthority`, `fieldOfflineDayComplete`, `dailyPathSimproOptional`; cron board pack uses manager rows; cash reconcile period can be marked; takeoff push can create quote; Field complete seeds draft invoice.

### Phase 4 checklist

- [x] `buildManagerBoardPackRows()` in `reports-board-pack.ts`
- [x] Board pack cron uses shared builder (not `executiveRowsFromHub` only)
- [x] `asAt` ISO in pack metadata/title
- [x] `DEFAULT_OVERHEAD_PERCENT` + business settings override
- [x] `cash-reconcile-periods.ts` store
- [x] `/api/reports/cash-reconcile` POST/GET
- [x] Minimal “Mark period reconciled” UI on Reports → WIP
- [x] Takeoff push `createNew` when no linked quote
- [x] Field Complete → `maybeCreateDraftInvoiceOnJobComplete`
- [x] Quote `metadata` chain ids on takeoff/heat push
- [x] Unit tests for board pack builder + cash reconcile store
- [ ] Daily path without simPRO (optional sync only) — sibling / ongoing
- [ ] Customer online quote / variation / pay flows — largely shipped in Phase 2–3
- [ ] End-to-end chain polish in UI (all portals hand off without office rescue)

---

## What we will not pretend is required for *your* 10/10

- Multi-tenant SaaS billing for other companies  
- Replacing Bluebeam for multi-trade document control  
- Full GL / bank feeds inside NeXa (Xero remains system of record)  
- Native App Store Field binary (PWA + offline can reach 10 for EWG if polish is high)
