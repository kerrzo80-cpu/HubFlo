# NeXa Pilot Launch

This is the working prototype launch plan for a short internal stress test before a full production build.

## Pilot Rules

- Treat this as a controlled pilot, not final production software.
- Use it with the office and engineers for workflow testing.
- Avoid storing highly sensitive customer information until proper production authentication, backups and database hosting are in place.
- Keep the laptop/server running while the pilot URL is being used, unless the app is deployed to a hosted server.

## Data Persistence

For local development, the pilot saves operational data into server-side JSON stores under:

```text
apps/web/.hubflo-runtime/
```

For hosted stress testing, set `NEXA_STORE_PATH` to a persistent SQLite database path. The Render blueprint mounts a disk at `/var/data` and stores the pilot database here:

```text
/var/data/nexa-pilot.sqlite
```

This keeps lead, quote, job, setup, takeoff and audit data available across app restarts and deploys.

The active stores are:

- `people-store.json`: clients, sites and audit events.
- `lead-store.json`: lead intake and survey bookings.
- `workflow-store.json`: quotes, jobs and purchase requests.
- `hub-detail-store.json`: setup, forms, cost centres, checklists, invoices and detailed quote/job build data.
- `takeoff-store.json`: separate Takeoff / BOQ add-on projects, documents, measurements, allowances, review state and quote handoff status.
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

## Hosted Pilot Deployment

The repo includes `render.yaml` for a Render-hosted pilot with:

- a permanent `onrender.com` URL;
- a persistent SQLite store mounted on `/var/data`;
- `/api/health` for hosting health checks;
- the same shared pilot password gate used for public tunnel testing.

Set these Render environment values before the first deploy:

```text
NEXA_PILOT_USER=nexa
NEXA_PILOT_PIN=<choose-a-shared-pilot-pin>
NEXA_STORE_PATH=/var/data/nexa-pilot.sqlite
NEXT_PUBLIC_APP_URL=https://<your-render-service>.onrender.com
NODE_VERSION=24.14.0
```

Keep `autoDeploy` off for the pilot so half-finished local feature work does not automatically replace the version the team is stress testing.

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
- handwritten survey notes and room photos go into the separate Survey quote layer in the same add-on;
- the add-on creates rooms, measurements, BOQ items and supplier request lines;
- survey quote drafts create editable materials, labour, radiator and supplier request allowances for office review;
- approved takeoff outputs push into a NeXa quote as cost centres, materials, labour and supplier-request items;
- the core quote/job workflow remains clean and does not become overloaded with estimating tools.

The pilot Takeoff / BOQ add-on is available at:

```text
/takeoff
```
