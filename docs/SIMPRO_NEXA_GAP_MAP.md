# simPRO → NeXa gap map

Live review of **Errol Watson Group Ltd** (`errolwatson.simprosuite.com`) on **28 Jul 2026**, compared to the NeXa codebase.

Goal: coverage of what EWG actually runs. Delete or defer anything we do not need.

Status legend:

| Status | Meaning |
| --- | --- |
| Strong | Usable depth |
| Partial | Exists but not simPRO-class |
| Thin | UI/API stub |
| Missing | Not built |
| NeXa ahead | Keep and extend |

Counts from the matrix below: **Strong 1 · Partial 13 · Thin 10 · Missing 9 · NeXa ahead 2**

---

## What live simPRO shows today (EWG)

- **77** overdue invoices
- **14** uninvoiced completed jobs
- **31** progress jobs with no technician
- **99+** notifications
- Stock devices: Warehouse + Chris / Murray / Raymond / Ryan vans
- Asset types: Gas appliance, Oil Boiler, Pipework
- Open Quotes list ~**110** rows with schedule strip

NeXa is nowhere near closing that operational backlog yet.

---

## Live simPRO menu → NeXa today

| Module | What you have in simPRO | NeXa today |
| --- | --- | --- |
| People | Customers, Sites, Suppliers, Contacts, Employees, Contractors | Partial — clients/sites/employees; contacts/contractors thinner |
| Leads | Open / Closed leads + create | Partial — leads exist; stages/follow-ups weaker |
| Quotes | Open/Progress/Complete/Approved + Service & Project create; merge/copy/schedule/map | Strong cost-build; missing quote stage tabs + project vs service split polish |
| Jobs | Pending→Invoiced + Service/Project/Prepaid + Contractor Jobs | Partial — jobs exist; prepaid/contractor/job-card parity missing |
| Recurring | Recurring Jobs + Recurring Invoices | Missing |
| Schedules | Day/Week/Month/Job Focus/Project/Manual + Timesheets, Job Cards, Run Sheets | Partial — weekly schedule only; no run sheets/job cards depth |
| Materials | Catalogue, Pre-Builds, Take Off Templates, Stock, Stock Takes, POs, Supplier Quotes, Receipts, Credits | Thin/Missing — PO requests only; no van stock / pre-builds / stocktakes |
| Invoices | Unpaid/Paid, Payments, Credits, Retentions, Deposits + supplier/contractor invoice tabs | Partial — basic invoices; no deposits/retentions/payments/contractor variance |
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
| Survey → estimate pack | **NeXa ahead** | Keep; deepen photo vision + Takeoffs handoff |
| Takeoffs / plan markup | Partial | Finish survey→takeoff→estimate chain; locked plans |
| Vendor catalogues | Missing | CSV / wholesaler catalog pipeline |
| Service jobs | Partial | Status machine, SLA, customer notifications, job card PDF |
| Project / multi-stage jobs | Thin | Stages, progress invoices, retainage |
| Scheduling & dispatch | Partial | Multi-tech board, travel, conflicts, SMS confirmations |
| Timesheets / labour | Thin | Approve → job cost → variance |
| Tasks & alerts | Thin | Assignable tasks, escalation |
| Digital forms / compliance | Partial | Form builder, Gas Safe certificate packs |
| Attachments / photos / docs | Partial | Unified media library, customer packs |
| Asset register | Missing | Site assets, QR, certificates, warranty |
| PPM / Maintenance Planner | Missing | Service plans, auto jobs, renewals |
| Inventory / stock | Missing | Locations, van stock, transfers, stocktake |
| Plant & equipment | Missing | Plant register, allocation, hire to job |
| Purchase orders | Partial | Goods receipt, 3-way match, costs to job + accounts |
| Invoicing | Partial | Deposits, progress claims, retainage, recurring |
| Payments | Missing | Card/link pay, allocate to invoice |
| Accounting sync | Missing | **Xero** customers/invoices/payments/bills (primary for EWG) |
| Cash / WIP reporting | Thin | True WIP, margin by job type, scheduled vs actual labour |
| Customer portal | Thin | Jobs status, invoices, pay, assets |
| SMS / messaging | Thin | SMS booking/ETA; WhatsApp production |
| Email / calendar | Thin | M365/Gmail OAuth + calendar sync |
| Data Feed / inbox | Thin | Mailbox rules: enquiry→lead, invoice→match |
| Mobile field app | Partial | Offline-first, signatures, forms parity |
| Multi-company | Missing | Defer — single-company polish first |
| Reporting / BI | Thin | Saved packs, email schedules, Excel/PDF export |
| Open API | Partial | Documented external API + webhooks later |
| simPRO bridge | Partial | Two-way customers/sites/quotes/jobs; invoice apply rules |
| Fleet GPS (Simtrac) | Missing | Defer unless requested |
| AI assistant (Blake) | **NeXa ahead** | Expand across quote build, blockers, margin |

Sources: simPRO Premium feature pages + NeXa Core / Surveyor / Estimator / Takeoff / Engineer / simPRO bridge. Not a pixel copy of tenant menus.

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

**Keep and protect (NeXa-native — do not dumb down to match simPRO):**

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
7. Harden simPRO two-way for **customers, sites, quotes, jobs** while NeXa becomes the front door

If Brian overrides Wave 1 pain:

| Pain | First slice |
| --- | --- |
| Overdue invoices (default) | Invoice list by age + complete→invoice gate + Xero push |
| Unassigned jobs | Dispatch board: unassigned queue + drag to tech + day view |
| Survey → quote | Survey pack → Takeoff BOQ → quote cost centres (already NeXa strength) |

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
- **Xero InvoiceID** stored on NeXa invoice after live export; re-export updates existing; payment pull prefers GUID then number
- **PO → Xero bill (ACCPAY)** export from purchase order record (live upsert or CSV pack); stores `xeroBillId`
- **Low-stock reorder PO** from Stock panel (shortfall qty, supplier + charge-to job)
- **Stock preferred supplier** editable on items; reorder uses override → preferred → workspace default
- **PO three-way match** — ordered vs received vs supplier invoice amount on the PO record (Matched / Variance / Incomplete)
- **Overdue invoice payment chase** — Setup `invoice-overdue` template, Prepare/Send chase (keeps original sentAt), chase count on invoice + dashboard
- **Xero contact link** on invoice export — match/create ACCREC contact by name, store `xeroContactId` on client
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
