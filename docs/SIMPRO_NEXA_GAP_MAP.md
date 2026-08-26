# simPRO → Blake gap map

Live review of **Errol Watson Group Ltd** (`errolwatson.simprosuite.com`) on **28 Jul 2026**, compared to the Blake codebase.

Goal: coverage of what EWG actually runs. Delete or defer anything we do not need.

Status legend:

| Status | Meaning |
| --- | --- |
| Strong | Usable depth |
| Partial | Exists but not simPRO-class |
| Thin | UI/API stub |
| Missing | Not built |
| Blake ahead | Keep and extend |

Counts from the matrix below: **Strong 1 · Partial 20 · Thin 9 · Missing 3 · Blake ahead 2**

---

## What live simPRO shows today (EWG)

- **77** overdue invoices
- **14** uninvoiced completed jobs
- **31** progress jobs with no technician
- **99+** notifications
- Stock devices: Warehouse + Chris / Murray / Raymond / Ryan vans
- Asset types: Gas appliance, Oil Boiler, Pipework
- Open Quotes list ~**110** rows with schedule strip

Blake is nowhere near closing that operational backlog yet.

---

## Live simPRO menu → Blake today

| Module | What you have in simPRO | Blake today |
| --- | --- | --- |
| People | Customers, Sites, Suppliers, Contacts, Employees, Contractors | Partial — clients/sites/employees; contacts/contractors thinner |
| Leads | Open / Closed leads + create | Partial — leads exist; stages/follow-ups weaker |
| Quotes | Open/Progress/Complete/Approved + Service & Project create; merge/copy/schedule/map | Strong cost-build; missing quote stage tabs + project vs service split polish |
| Jobs | Pending→Invoiced + Service/Project/Prepaid + Contractor Jobs | Partial — jobs exist; prepaid/contractor/job-card parity missing |
| Recurring | Recurring Jobs + Recurring Invoices | Missing |
| Schedules | Day/Week/Month/Job Focus/Project/Manual + Timesheets, Job Cards, Run Sheets | Partial — weekly schedule only; no run sheets/job cards depth |
| Materials | Catalogue, Pre-Builds, Take Off Templates, Stock, Stock Takes, POs, Supplier Quotes, Receipts, Credits | Thin/Missing — PO requests only; no van stock / pre-builds / stocktakes |
| Invoices | Unpaid/Paid, Payments, Credits, Retentions, Deposits + supplier/contractor invoice tabs | Partial — deposits, valuations, progress claims, retention release, credit notes, payments, remittance, Xero; contractor variance thinner |
| Tasks | Office task list | Thin — alerts/overdue quick views only |
| Payments | Simpro Payments / Stripe Get Connected | Missing |
| Utilities | Plant & Equipment, Customer Assets, Business Toolkit, Import/Export, Xero, SMS, Backups, Data Feed | Missing/stubs — Xero stub; SMS none; assets none; Data Feed none |
| Reports | View Reports, Schedule Reports, BI Reporting (Metabase) | Thin — in-app report tabs only |

---

## Capability matrix (summary)

| Area | Gap | Suggested fix |
| --- | --- | --- |
| Leads / CRM pipeline | Partial | Harden stages, lost reasons, source tracking, auto follow-ups |
| Customers & sites | Partial | Contacts hierarchy, site assets link, credit terms |
| Employees / contractors | Partial | Skills matrix, utilisation, leave calendar |
| Vendors / suppliers | Thin | Catalog sync, side-by-side pricing, RFQ closed loop |
| Estimating & quoting | Strong | Templates, deposit quotes, online acceptance, revision history |
| Survey → estimate pack | **Blake ahead** | Keep; deepen photo vision + Takeoffs handoff |
| Takeoffs / plan markup | Partial | Finish survey→takeoff→estimate chain; locked plans |
| Vendor catalogues | Partial | CSV import; preferred supplier syncs to stock on SKU rows |
| Service jobs | Partial | Status machine, complete notice, overdue booked-job queue; SLA clocks still thin |
| Project / multi-stage jobs | Thin | Stages, progress invoices, retainage |
| Scheduling & dispatch | Partial | Multi-tech board + job confirmation + ETA email/WhatsApp |
| Timesheets / labour | Partial | Approve → job labour cost + actual hours / variance vs plan |
| Tasks & alerts | Thin | Assignable tasks, escalation |
| Digital forms / compliance | Partial | Form builder + engineer flow Text/Photo/Number/Signature capture; canvas pad still thin |
| Attachments / photos / docs | Partial | Unified media library, customer packs |
| Asset register | Partial | Site assets with cert number/dates + service/cert due filters; QR still missing |
| PPM / Maintenance Planner | Partial | Recurring due/overdue + 14-day upcoming queue, generate-all, pause/activate |
| Inventory / stock | Partial | Locations/vans/transfers/issue/return/stocktake + variance; catalogue preferred-supplier sync |
| Plant & equipment | Missing | Plant register, allocation, hire to job |
| Purchase orders | Partial | Goods receipt, 3-way match, costs to job + accounts |
| Invoicing | Partial | Recurring; credit notes + retention release now ship |
| Payments | Partial | Ledger + remittance advice email; card/link pay still missing |
| Accounting sync | Partial | Xero left-nav hub with sales/bills export queues + mark exported; live OAuth/CSV; deeper sync still open |
| Cash / WIP reporting | Partial | WIP tab now shows labour actual vs plan hours; deeper margin packs still open |
| Customer portal | Thin | Jobs status, invoices, pay, assets |
| SMS / messaging | Partial | Job confirmation + ETA WhatsApp/email; dedicated SMS gateway still thin |
| Email / calendar | Thin | M365/Gmail OAuth + calendar sync |
| Data Feed / inbox | Thin | Mailbox rules: enquiry→lead, invoice→match |
| Mobile field app | Partial | Offline-first, signatures, forms parity |
| Multi-company | Missing | Defer — single-company polish first |
| Reporting / BI | Thin | Saved packs, email schedules, Excel/PDF export |
| Open API | Partial | Documented external API + webhooks later |
| simPRO bridge | Partial | Two-way customers/sites/quotes/jobs; invoice apply rules |
| Fleet GPS (Simtrac) | Missing | Defer unless requested |
| AI assistant (Blake) | **Blake ahead** | Expand across quote build, blockers, margin |

Sources: simPRO Premium feature pages + Blake Core / Surveyor / Estimator / Takeoff / Engineer / simPRO bridge. Not a pixel copy of tenant menus.

---

## Recommended cut / defer list (EWG)

Cut or demote unless Brian overrides. Do **not** spend build effort here until Waves 1–2 are earning money.

| Item | Recommendation | Why |
| --- | --- | --- |
| Delight / Lightning-style UX chrome | Cut | Not operational value |
| Fleet GPS / Simtrac | Defer | Nice later; not on the 77-overdue path |
| BI / Metabase premium | Defer | In-app WIP + overdue packs first |
| Multi-company / multi-tenant branding | Defer | EWG is single company |
| Plant & Equipment (company plant hire) | Defer | After van stock if still needed |
| Prepaid job product type | Defer | After service/project job parity |
| Contractor Jobs portal depth | Defer | After core engineer + PO receipt |
| Customer portal expansion | Defer | After invoice → Xero → pay link |
| SMS (full) | Defer to late Wave 2 | WhatsApp pilot already exists; SMS after schedule confirmations matter |
| Data Feed / Zapier ecosystem | Defer | After mailbox → lead is proven |
| Public partner API | Defer | Internal APIs enough for Wave 1 |
| Online card payments (Stripe) | Wave 2+ | Xero + overdue invoice workflow first; pay-links after invoices are trustworthy |

**Keep and protect (Blake-native — do not dumb down to match simPRO):**

- Guided Surveyor
- AI estimate pack
- Takeoffs + LiDAR / RoomPlan
- Blake (co-pilot)

---

## Suggested delivery waves

### Wave 1 — Make money flow (default pick: overdue invoices)

Close the cash loop that live simPRO is screaming about:

1. Quote acceptance → job
2. Schedule + assign technician (kill “31 progress jobs with no technician”)
3. Timesheets → job cost
4. Completed job → invoice (kill “14 uninvoiced completed”)
5. Invoice ageing / overdue pack (attack “77 overdue”)
6. **Xero** sync for customers / invoices / payments (primary accounts path for EWG)
7. Harden simPRO two-way for **customers, sites, quotes, jobs** while Blake becomes the front door

If Brian overrides Wave 1 pain:

| Pain | First slice |
| --- | --- |
| Overdue invoices (default) | Invoice list by age + complete→invoice gate + Xero push |
| Unassigned jobs | Dispatch board: unassigned queue + drag to tech + day view |
| Survey → quote | Survey pack → Takeoff BOQ → quote cost centres (already Blake strength) |

### Wave 2 — Field & materials

- Engineer offline / forms / signatures
- PO goods receipt → job cost
- Stock locations + van stock (Warehouse + four vans)
- Supplier catalog import (CSV first; wholesaler sync later)

### Wave 3 — Assets & contracts

- Site asset register (Gas appliance, Oil Boiler, Pipework)
- PPM planner
- Recurring invoices
- Certificates

### Wave 4 — Depth & polish

- Project stages / progress claims / retainage
- Payments
- SMS
- Reporting / WIP
- Customer portal expansion

---

## Immediate build order (proposed)

Until Brian cuts further, execute in this order:

1. **Invoice ops pack** — Uninvoiced completed jobs queue + overdue invoice ageing + one-click invoice from completed job — **STARTED (Wave 1 UI live)**
2. **Dispatch gap** — Unassigned progress jobs queue on schedule — **STARTED (Wave 1 UI live)**
3. **Xero** — Customers + invoices (read/write) stub → real sync
4. **simPRO bridge** — Customers/sites inbound reconcile (stop dual typing)
5. **Catalogue / supplier CSV** — Already started; keep usable for radiator/price lists
6. **Takeoff BOQ Excel** — Already fixed for SMM e-enquiry imports; finish survey→takeoff→quote handoff

### Wave 1 shipped in product (28 Jul 2026)

- Dashboard **Invoice ops** panel: overdue ageing buckets + completed-not-invoiced with one-click Invoice
- Dashboard **Unassigned jobs** panel + schedule unassigned rail
- Invoices open on **Overdue** by default; Draft folder added; due column shows days overdue
- Jobs folder **Ready to invoice** for Completed / Ready to invoice
- New invoices use Setup payment terms days for due date
- **Xero export** on invoice record (live API when tokens present, else CSV import pack) + accounts status Sent
- **Xero OAuth connect** in Setup → Integrations (`/api/integrations/xero/connect` + callback); static token still supported; CSV always works
- **Xero payment pull** on invoice record (`/api/integrations/xero/payments`) — append-only import by invoice number with PaymentID dedupe
- **Xero InvoiceID** stored on Blake invoice after live export; re-export updates existing; payment pull prefers GUID then number
- **PO → Xero bill (ACCPAY)** export from purchase order record (live upsert or CSV pack); stores `xeroBillId`
- **Low-stock reorder PO** from Stock panel (shortfall qty, supplier + charge-to job)
- **Stock preferred supplier** editable on items; reorder uses override → preferred → workspace default
- **PO three-way match** — ordered vs received vs supplier invoice amount on the PO record (Matched / Variance / Incomplete)
- **Xero bill payment pull (AP)** — import ACCPAY payments onto the PO supplier payment ledger by BillID / PO number
- **Customer statement** — email outstanding invoices from the client record (Setup `statement` template + PDF attachment)
- **Remittance advice** — email payment confirmation from the invoice ledger (Setup `remittance` template + PDF; latest allocated payment)
- **Credit notes** — issue credit against a sent invoice (Credits folder); applies ledger adjustment up to outstanding; excluded from billed-to-date
- **Job confirmation email** — from job record (Setup `job-confirmation` template + PDF); stores `confirmationSentAt` / `confirmationSentTo` and clears readiness communication check
- **Catalogue CSV → preferred supplier** — importing catalogue rows with SKU + supplier upserts stock preferred supplier and binds `catalogItemId`
- **Recurring / PPM polish** — due/overdue + 14-day upcoming queues, generate-all, pause/activate; generated jobs/invoices stamp the plan due date
- **Xero credit-note export** — ACCRECCREDIT live upsert + CSV pack; allocates to original invoice when Xero InvoiceID/number known
- **Job confirmation WhatsApp** — confirmation sends email and/or WhatsApp (phone) using Meta connector when configured
- **Site asset register depth** — edit/archive, install/last/warranty fields, overdue + due-soon filters
- **Timesheet labour variance** — approved timesheets stamp `actualDurationHours` / `labourCostVariance` on the job banner
- **Dashboard assets-due queue** — overdue/due-soon site assets (30 days) on the ops dashboard
- **Cost-centre schedule tabs** — quote/job package visits listed with confirmation/planner actions
- **Stock issue → WIP cost** — Issue-to-job movements add material actuals on Reports WIP / Purchasing
- **Manual PO supplier payments** — record AP payments on the PO ledger alongside Xero pull
- **Remittance-after-payment** — checkbox on invoice ledger emails remittance for the payment just recorded
- **WIP labour hours** — Reports → WIP shows actual/plan labour hours and variance
- **Retention release invoice** — from a progress claim: retained / released / available balances + create collectible retention invoice (`claimType: retention-release`, excluded from billed-to-date)
- **Overdue invoice payment chase** — Setup `invoice-overdue` template, Prepare/Send chase (keeps original sentAt), chase count on invoice + dashboard
- **Xero contact link** on invoice export — match/create ACCREC contact by name, store `xeroContactId` on client
- **Job ETA / on the way** — email + WhatsApp from job programme / cost-centre schedule (`job-eta` template); stores `etaSentAt` / `etaSentTo` / `etaMinutes`
- **Deposit on quote acceptance** — Setup workflow rule auto-creates deposit invoice when a quote converts to a job (default %)
- **Stocktake expected + variance** — stocktake mode shows on-hand at location and counted − expected before/after save
- **Engineer flow evidence** — stop/go steps capture Text / Number / Photo / Signature name (not checkbox-only); persists `flowStepEvidence`
- **Job complete notice** — email + WhatsApp (`job-complete` template); stores `completionSentAt` / `completionSentTo`
- **Overdue scheduled jobs** — dashboard queue for open jobs whose booked date is before today
- **Stock return from job** — unused materials credited back to van/warehouse; WIP material cost reduced
- **Site asset certificates** — number + issued/expiry dates, cert-expired filter, dashboard due queue includes cert dates
- **Xero accounts hub** — left-nav Xero module with Sales/Bills to export, Exported list (mark/unmark), and Connection (simPRO-style queue, not only per-invoice buttons)
- simPRO import defaults to **Clients + Sites** with one-click shortcuts
- Payments: amount field + part-paid / paid / unpaid with audit
- simPRO sync **conflict resolve** (link / create / skip) with dual-write entity links
- Catalogue **SKU ↔ stock** binding on PO receipt (SKU / catalogItemId / stockItemId)

### Waves 2–4 in product (28 Jul 2026)

- **Stock** module: Warehouse + Chris/Murray/Raymond/Ryan vans; receive/add items; low-stock
- PO **Mark invoice received** also receipts lines into Warehouse stock and keeps job cost actuals
- Cost-centre **Customer Assets** tab: Gas / Oil / Pipework register per site
- **Recurring** module: plans that generate next job or invoice and advance next due
- Reports **WIP** tab: open jobs sell vs cost committed vs billed / unbilled

---

## How to use this doc

1. Confirm or edit the **cut / defer** table.
2. Confirm Wave 1 pain: **overdue invoices** (default), **unassigned jobs**, or **survey→quote**.
3. Next agent turn turns that confirmation into concrete tickets/PRs — no calendar estimates, only sequencing by dependency.
