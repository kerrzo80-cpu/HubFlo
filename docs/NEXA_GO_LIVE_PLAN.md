# NeXa go-live plan

## Decisions

- Keep `nexa-pilot` and its data available for testing and reference.
- Launch production as a separate Render service with a new persistent disk and `NEXA_WORKSPACE_MODE=live`.
- A live workspace starts without demo leads, quotes, jobs, purchase orders, clients, sites or takeoff projects.
- Do not reset the pilot database to create production.
- Replace the shared pilot password and browser-only employee passwords with individual server-verified accounts before inviting users.
- Introduce Simpro in controlled stages. Start with read-only import and reconciliation before enabling outbound writes.
- Never use simple last-write-wins for two-way sync. Each record needs a durable NeXa-to-Simpro identity link, ownership rules and a visible conflict queue.

## Launch gates

### 1. Core workflow

- [ ] Lead creation, contacts, postcode lookup and site selection are production-ready.
- [ ] Quote options, forms, acceptance and conversion to pending job are production-ready.
- [ ] Job sections, cost centres, documents, variations, planner and scheduling are production-ready.
- [ ] Purchase orders support approval, issue, receipt, part receipt and invoice matching.
- [ ] Deposit, valuation, progress claim and final invoice workflows are production-ready.
- [ ] Valuations live under the job's **Invoices & claims** area and remain linked to that job.
- [ ] Quote, job, PO, valuation and invoice PDFs are previewable before sending.

### 2. People and access

- [x] Individual accounts use server-side password hashing and secure HTTP-only sessions.
- [x] Roles and permissions are enforced by the API, not trusted from browser headers.
- [x] Owner/admin can add, disable and reset employee accounts.
- [x] Login, logout, failed login and privileged account changes are audited.
- [ ] Employee, contractor, supplier, client and customer imports support CSV/XLSX validation and duplicate review.

### 3. Simpro transition bridge

The Simpro API supports customers, sites, contacts, employees, contractors, suppliers, leads, quotes, quote cost centres, jobs, job cost centres, schedules, timesheets and invoices. Webhooks notify NeXa of Simpro changes; scheduled reconciliation catches missed events.

Entity rollout order:

1. Customers, contacts and sites: Simpro to NeXa read-only import.
2. Employees, contractors and suppliers: Simpro to NeXa read-only import.
3. Leads and quotes: two-way create/update after duplicate matching is approved.
4. Jobs, sections, cost centres and schedules: two-way create/update.
5. Purchase orders, timesheets and invoices: two-way only after financial ownership rules are signed off.

Every linked record must store:

- NeXa ID and Simpro ID.
- Source system and creation time.
- Last successful inbound and outbound sync.
- Last source modification time and content fingerprint.
- Sync status, retry count and most recent error.
- Field ownership and any unresolved conflict.

Loop prevention and safety:

- Use idempotency keys for NeXa writes.
- Ignore webhook echoes when the content fingerprint matches NeXa's last outbound write.
- Process webhook events through a durable queue and keep the raw event for audit.
- Use `If-Modified-Since` reconciliation at least every 15 minutes.
- Start each entity in preview mode before allowing writes.
- Provide Pause Sync, Retry and Resolve Conflict controls in Setup.

### 4. Accounts integration

- [ ] Choose the financial system of record before enabling Xero.
- [ ] Avoid sending the same invoice to Xero from both Simpro and NeXa.
- [ ] Map tax codes, nominal accounts, customers, invoice references and payment status.
- [ ] Start with invoice export and payment-status import; add supplier bills only after PO matching is stable.

### 5. Data and deployment

- [x] Environment-controlled blank workspace defaults.
- [ ] Export and retain a timestamped pilot snapshot before production launch.
- [ ] Create separate `nexa-live` Render service and disk.
- [ ] Configure production secrets independently from pilot.
- [ ] Run imports in dry-run mode and approve duplicate/mapping report.
- [ ] Smoke-test lead -> quote -> acceptance -> job -> schedule -> PO/variation -> completion -> invoice.
- [ ] Enable daily database backups and a tested restore process.
- [ ] Add release notes, deployment health and rollback instructions for subsequent updates.

## Notebook items captured

- Valuations have a clear home under jobs and invoice/claim workflows.
- Quote Options and job Variations remain separate workflows.
- Job documents must support upload, visibility and engineer access.
- Turquoise branding is applied consistently without reducing contrast.
- Employees can be added and given individual access.
- Xero integration follows financial ownership decisions.
- Imports cover quotes, jobs, employees, suppliers, contractors, clients and customers.
- Scheduler migration is handled as part of jobs/schedules sync, with NeXa branding applied after functional parity.
- Typography uses a sharper system interface stack for improved readability.

## Recommended cutover

1. Finish the launch gates in the pilot.
2. Create `nexa-live` with a blank database and real user accounts.
3. Import Simpro reference data read-only and reconcile counts.
4. Run NeXa and Simpro side by side with visible sync status.
5. Enable NeXa-to-Simpro writes one entity at a time.
6. Make NeXa the primary system only after two clean operating weeks and a signed reconciliation report.

## References

- Simpro API: https://developer.simprogroup.com/apidoc/
- Simpro webhooks: https://developer.simprogroup.com/apidoc/?page=cd8682773ab1b07fdc9661984e281ce3
- Simpro modified-resource reconciliation: https://developer.simprogroup.com/apidoc/?page=07adc9c3c19b7c17e7309e86c22161a2
