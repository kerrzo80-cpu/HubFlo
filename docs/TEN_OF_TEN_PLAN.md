# Path to 10/10 — EWG Core / NeXa

Honest target: **10/10 for EWG-shaped plumbing & heating operations**, then close remaining gaps vs Jobber / Fergus / simPRO / ServiceTitan as a market product.

Baseline (Aug 2026 audit): **~6.5/10 for EWG ops · ~4/10 vs category leaders**.

---

## Scoreboard targets

| Phase | EWG ops score | Market peer score | Outcome |
|-------|--------------:|------------------:|---------|
| **0 — Baseline** | 6.5 | 4 | Live suite with uneven maturity |
| **1 — Trust the spine** | **8.0** | 5.5 | Offline Field, Heat Design saved, board-pack reports, invoice portal |
| **2 — Commercial close** *(this branch)* | **9.0** | 7 | Stripe pay links, client hub, cash↔Xero reconcile, PO stock idempotent, server recurring generate |
| **3 — Category peer** | **9.5** | 8.5 | Native Field feel, offline SW, BI exports, recurring/PPM depth, multi-user Heat Design |
| **4 — 10/10** | **10** | 9–10 | Payments + portal + dispatch polish + specialist add-ons “good enough to stop buying Heat Engineer / PlanSwift for EWG work” |

True ServiceTitan parity (multi-tenant SaaS, plant GPS, full accounting) is optional and **out of Phase 1–3** unless you decide to productise for other firms.

---

## Phase 1 — Trust the spine *(in progress)*

1. **Heat Design server projects** — firm register, not browser-only lab  
2. **Field offline outbox** — checklist / daywork / photos queue + sync  
3. **Reports board pack PDF + Excel** — managers can download what they see  
4. **Invoice customer portal** — view balance / mark paid intent / public token (quote portal already exists)  
5. **Public `/client/*` routes** — portals work without pilot login  

**Done when:** health shows `heatDesignPersistence`, `fieldOfflineOutbox`, `reportsBoardPack`, `invoicePortal`; iPad Field survives airplane mode for checklist/daywork; Heat Design projects survive browser clear; Reports → PDF downloads a branded pack.

---

## Phase 2 — Commercial close *(shipped)*

1. **Stripe Checkout pay links** on invoice portal + Setup → Integrations key card + webhook  
2. **Client hub** `/client/hub/[token]` — open quotes, invoices, variations, job status  
3. **Cash reconcile** on Reports → WIP — NeXa owed vs Xero/Stripe/manual + batch Xero pull  
4. **PO receive → stock** idempotent `receiptKey` (no double-stock)  
5. **Server recurring generate** — `POST /api/recurring` `generate` / `generate-due`

**Done when:** health shows `tenOfTenPlan: phase-2-commercial-v1`, `stripePayLinks`, `clientPortalHub`, `cashReconcile`, `poStockReceive`, `recurringGenerate`. Add Stripe keys in Setup (or env) to enable Pay online.  

---

## Phase 3 — Category peer

1. Field service worker + asset cache (true offline shell)  
2. Dispatch: run sheets, clash warnings, travel buffers  
3. Scheduled email report packs (Mon morning board pack)  
4. Takeoff Studio reliability for scanned drawings (human-confirm AI counts)  
5. Heat Design MCS-style printable design pack + audit trail  

---

## Phase 4 — 10/10 for EWG

1. No simPRO required for daily path (optional sync only)  
2. Customer can accept quote, approve variation, pay invoice online  
3. Engineer completes day offline and syncs without office rescue  
4. Manager trusts Reports numbers enough to stop building Excel side-books  
5. Survey → Takeoff → Heat Design → Quote → Job → Field → Invoice is one continuous chain  

---

## What we will not pretend is required for *your* 10/10

- Multi-tenant SaaS billing for other companies  
- Replacing Bluebeam for multi-trade document control  
- Full GL / bank feeds inside NeXa (Xero remains system of record)  
- Native App Store Field binary (PWA + offline can reach 10 for EWG if polish is high)
