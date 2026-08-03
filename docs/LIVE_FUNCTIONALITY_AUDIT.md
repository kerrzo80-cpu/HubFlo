# NeXa Live Functionality Standard

NeXa is a live operational product. Every visible control must be in one of these states:

1. **Working** - reads or writes the shared workspace and reports the real outcome.
2. **Blocked** - disabled, with the exact missing permission, record or integration prerequisite shown beside it.
3. **Removed** - not rendered until its workflow exists.

A click that only displays a success-style notice is not a completed workflow.

## Audit priorities

### Critical writes

- Lead, quote, job, invoice, valuation and purchase-order creation and editing
- Employee, client, site, supplier, contact and contractor maintenance
- Job scheduling, timesheets, variations and cost-centre changes
- Email delivery, simPRO export and Xero export

### Required evidence

- The record remains changed after a page refresh.
- The action has an audit event naming the user.
- External actions retain the provider response ID or show the provider error.
- Destructive and financial actions require explicit confirmation.
- AI-proposed writes show a review step before the live mutation.

## Current first AI action

`POST /api/nexa-assistant` checks employee availability against:

- Employee-card working hours
- Detailed job planner assignments
- Job-level schedule entries
- Lead survey appointments

Booking requests require a job, cost centre, date, start time and duration. NeXa returns a
review action first. Confirming that action writes the assignment to `jobSchedulePlans`,
updates the job, logs the user action and attempts the configured simPRO schedule push.

The server verifies date/weekday agreement and checks the diary again at confirmation time.

## Remaining control audit

Search targets used for each release:

```text
showNotice(
placeholder
not yet
coming soon
scaffold
prototype
queued
```

Each match must be classified as working, blocked or removed before release.
