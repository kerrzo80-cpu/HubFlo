# Blake operator foundation

This module is the first implementation of the Blake capability/action layer described in #206.

Initial confirmed write capabilities:

- create lead
- update lead workflow fields
- create quote
- update quote
- create job
- update job

Principles:

- OpenAI plans the requested action and extracts user-supplied values.
- Blake validates required fields and permissions.
- Writes are stored as pending actions and require confirmation.
- A typed `yes`, `confirm`, `do it`, etc. can confirm the same pending action, so the flow works for future voice clients as well as buttons.
- Confirmation re-checks the logged-in user's current Blake permissions.
- The model never executes database writes directly.
- Existing Blake business services (`createLead`, `createQuote`, `createJob`, and update equivalents) perform the writes.
- The current confirmation-card wire format is reused for frontend compatibility; the API resolves generic Blake actions before legacy booking confirmations.

This is intentionally an incremental foundation. New Blake capabilities should be added through the same registry/execution boundary rather than as separate chatbot handlers.
