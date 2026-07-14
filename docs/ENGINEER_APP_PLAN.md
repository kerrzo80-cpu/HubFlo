# HubFlo Engineer App Plan

## Purpose

Build the engineer-facing side of HubFlo so engineers can see their scheduled work, access the information they need on site, send office alerts, request POs, upload photos/notes, and confirm daily time without traditional timesheets.

This file is the shared source of truth for Codex chats working on HubFlo. Update this file when product decisions change so we do not create cross-wires between chats.

## Key decisions

- Build this inside HubFlo, not as a separate app.
- Keep the current scheduler/office tools as planning tools.
- Add a mobile-first engineer module for field use.
- Do not use start/stop timers; engineers will forget them.
- Use schedule-first daily time confirmation instead.
- Use office alerts for exceptions: PO requests, parts needed, rebook required, incomplete jobs, missing time confirmation.
- Do not write everything back to SimPRO automatically at first. HubFlo should collect clean workflow data and alert the office first; safe SimPRO writes can come later.
- Engineer workflows must support offline-friendly design before field rollout.

## Main engineer routes

Suggested routes:

- `/engineer` or `/engineer/today`: My Day schedule.
- `/engineer/jobs/[scheduleId]`: Scheduled job detail.
- `/engineer/time-check`: Daily Time Check.
- `/engineer/time-check/[date]`: Review a specific day.

Suggested office/admin routes:

- `/office/alerts`: Office exception queue.
- `/office/po-requests`: PO request approval queue.
- `/office/time-exceptions`: Missing/adjusted time checks.

Final route names should match the existing HubFlo routing pattern.

## Engineer My Day

Mobile-first page showing the engineer's scheduled jobs.

Each card should show:

- Scheduled time.
- Customer name.
- Site address.
- Cost centre / job type.
- Job status.
- Phone number if available.
- Short description.
- Required-action badges, for example photos required or PO requested.

Actions:

- Tap job card to open detail.
- Tap address to open maps.
- Tap phone to call customer.
- Pull/refresh schedule if online.

Maps link:

- Use a normal address URL so iOS/Android can open their default maps app.
- Example target: `https://www.google.com/maps/search/?api=1&query=<encoded address>`.

Phone link:

- Use `tel:<phone>`.

## Engineer Job Detail

The job detail page should show everything needed on site:

- Customer name.
- Site address.
- Contact phone.
- Job description.
- Internal notes.
- Attachments.
- Existing photos.
- Schedule time.
- Cost centre requirements.
- Boiler/service checklist if applicable.

Actions:

- Upload photo.
- Add engineer note.
- Request PO.
- Mark complete.
- Mark needs parts.
- Mark needs rebooked.
- Mark could not access.

## PO request workflow

Keep engineer input deliberately small.

Engineer fields:

- Supplier name or supplier selection.
- Optional note.
- Optional photo.

Office receives:

- Engineer.
- Job/customer/address.
- Supplier requested.
- Note/photo if provided.
- Requested timestamp.

Office actions:

- Approve.
- Reject.
- Mark ordered.
- Add PO number later if needed.

Important: engineers do not need to enter full PO details.

## Job outcome workflow

Engineer outcome buttons:

- `Complete`: job appears completed in HubFlo.
- `Needs parts`: office alert created; job moves to parts/order queue.
- `Needs rebooked`: office/scheduler alert created; job needs scheduling again.
- `Could not access`: office alert created with reason.

Each non-complete outcome should ask for a short reason/note.

Potential statuses:

- `scheduled`
- `in_progress` optional later
- `completed`
- `needs_parts`
- `needs_rebooked`
- `could_not_access`
- `office_review_required`

## Stop/go cost-centre requirements

Some cost centres should require specific information/photos before completion.

Examples for boiler servicing:

- Appliance photo.
- Data plate photo.
- Flue/analyser photo or reading.
- Service notes.
- Defects recorded or confirmed none.

Examples for boiler installation:

- Before photos.
- Finished install photos.
- Benchmark/commissioning information.
- Flue photo.
- Controls photo.
- Materials/parts used.

## Paper job sheet / carbon-book workflow

Engineers may still use a simple paper/carbon-book style job sheet on site because it is familiar and quick. HubFlo should support this rather than forcing every detail into small mobile forms.

Paper sheet should capture:

- Actual start and finish time.
- Break minutes where relevant.
- Tick-box stop/go evidence.
- Equipment booked out.
- Equipment booked back in.
- Materials or parts used.
- Short site notes and defects.
- Signature or handover notes later.

Workflow:

- Engineer takes a photo of the sheet inside the job.
- If OpenAI is connected, NeXa reads the photo and extracts structured fields.
- If the scan is unclear, the engineer can type helper text and the office still receives the sheet image/name for review.
- Extracted actual hours create a time entry for office review.
- Equipment movements are logged against the job.
- Checklist ticks can satisfy matching stop/go items.
- Core job actuals are updated with actual start, finish, duration and labour cost variance.
- Office can compare planned hours versus actual hours to see whether the job made more or less margin than expected.

If required items are missing, block completion with a clear message:

`Cannot mark complete yet. Missing: flue photo, service notes.`

These rules should be configurable by tenant/cost centre, not hard-coded only for EWG.

## Daily Time Check

Do not build start/stop timers as the primary workflow.

Use schedule-first confirmation:

- HubFlo creates a default daily time check from scheduled jobs.
- Engineer reviews at the end of the day.
- Engineer confirms as scheduled or adjusts exceptions.
- Gaps are detected and assigned.

Prompt timings:

- 4:00pm: soft engineer prompt.
- 5:15pm: stronger engineer reminder.
- 9:00am next day: office escalation if still unconfirmed.

Engineer wording:

- Use `Quick time check`, not `timesheet`.
- Message: `Your scheduled time is ready. Confirm it, or fix anything that changed.`

Engineer actions:

- `Confirm all as scheduled`.
- Adjust individual jobs.
- Assign gaps.
- Add reason/note for adjustments.

Gap handling:

If working day has unassigned gaps, ask the engineer what the time was for:

- Existing SimPRO/HubFlo job.
- Reactive job.
- Travel.
- Materials.
- Admin.
- Training.
- Sick/appointment.
- Unpaid/no time claim.

Office escalation at 9am:

Office gets an alert for any engineer who did not submit yesterday's time check.

Office alert should show:

- Engineer.
- Date missing.
- Scheduled jobs.
- Total scheduled hours.
- Gaps detected.
- Status: not reviewed, started not submitted, or adjusted pending approval.
- Call button if phone is available.
- Actions: approve as scheduled, amend time, mark chased, mark exempt.

Behavioural rule:

If engineers ignore the time check, the office has to call them. This creates a practical nudge without relying on traditional timesheets.

## Office alert types

Initial office alert queue should support:

- PO requested.
- Parts needed.
- Rebook required.
- Could not access.
- Job incomplete.
- Missing daily time check.
- Adjusted time needing review.
- Stop/go checklist missing required information.

## Data model ideas

Exact model should follow the existing database/package conventions.

Likely entities:

- `engineer_schedule_view` or derived schedule API from SimPRO/HubFlo.
- `job_workflow_event` for notes, outcomes, PO requests, parts, rebook requests.
- `job_photo` or attachment records.
- `po_request`.
- `daily_time_check`.
- `daily_time_entry`.
- `office_alert`.
- `cost_centre_requirement_template`.
- `job_requirement_completion`.

## MVP build order

1. Engineer My Day, read-only schedule cards.
2. Job Detail with maps/phone/customer/address/description.
3. Request PO button and office approval queue.
4. Engineer notes and photo upload.
5. Outcome buttons: complete, needs parts, needs rebooked, could not access.
6. Office alerts dashboard.
7. Stop/go checklist rules by cost centre.
8. Daily Time Check with 4pm, 5:15pm, and 9am flows.
9. Safe SimPRO write-backs only after workflow data is reliable.

## Integration notes

- This plan should be checked before building engineer workflows.
- If another chat changes routes, database shape, or auth assumptions, update this file.
- Keep manager scheduler and engineer field workflows separate but connected through shared job/schedule data.
- Avoid pushing to live until the feature is reviewed and deliberately deployed.
