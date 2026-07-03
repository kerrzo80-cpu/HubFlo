# NeXa Pilot Launch

This is the working prototype launch plan for a short internal stress test before a full production build.

## Pilot Rules

- Treat this as a controlled pilot, not final production software.
- Use it with the office and engineers for workflow testing.
- Avoid storing highly sensitive customer information until proper production authentication, backups and database hosting are in place.
- Keep the laptop/server running while the pilot URL is being used, unless the app is deployed to a hosted server.

## Data Persistence

The pilot currently saves operational data into server-side JSON stores under:

```text
apps/web/.hubflo-runtime/
```

The active stores are:

- `people-store.json`: clients, sites and audit events.
- `lead-store.json`: lead intake and survey bookings.
- `workflow-store.json`: quotes, jobs and purchase requests.
- `hub-detail-store.json`: setup, forms, cost centres, checklists, invoices and detailed quote/job build data.
- `variation-portal-store.json`: client-facing variation approvals.

The browser also keeps a local fallback copy so a refresh does not throw away work if an API call fails.

## Backup

Before and after each stress-test session, download a backup from:

```text
/api/prototype-backup
```

The same backup is available from Setup > Overview using `Export pilot backup`.

## Pilot Password Gate

For a public pilot URL, start the app with a shared pilot username and PIN:

```bash
NEXA_PILOT_USER=nexa NEXA_PILOT_PIN=change-this-pin pnpm --filter @hubflo/web start --hostname 0.0.0.0 --port 3002
```

If `NEXA_PILOT_PIN` is not set, the app runs without the extra gate for local development.

## Stress-Test Workflow

Run the same workflow repeatedly and note where it feels slow, confusing or missing a handoff:

1. Create a lead.
2. Book or amend the survey.
3. Convert the lead into a quote.
4. Build quote cost centres.
5. Send/preview the quote and online acceptance.
6. Convert the accepted quote into a pending job.
7. Schedule staff and move the job into progress.
8. Add purchase requests, documents and variations.
9. Review completion and create the invoice.

## Add-On Direction

Keep takeoff/BOQ as a separate NeXa add-on app. It should feed clean outputs into the core NeXa command centre:

- drawings and specs go into the takeoff add-on;
- the add-on creates rooms, measurements, BOQ items and supplier request lines;
- approved takeoff outputs push into a NeXa quote as cost centres, materials, labour and supplier-request items;
- the core quote/job workflow remains clean and does not become overloaded with estimating tools.
