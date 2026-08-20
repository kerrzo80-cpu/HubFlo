# Blake Core Technical Assessment

Status: foundation implementation started for GitHub issue #206.

## Decision

Blake will be the universal AI operating layer for NeXa. OpenAI interprets the conversation and chooses from an allowed set of tools. NeXa remains authoritative for tenant identity, permissions, validation, business rules, persistence, confirmation and audit.

No Blake channel may query stores directly from model-generated code, generate SQL, or invent action payloads outside the registered schemas.

## Current-state findings

- `nexa-assistant.ts` already handles office chat, diary questions, booking confirmation, faults, tender guidance and lead-workflow entry, but it is a large orchestration module with direct store access.
- `CREATE_LEAD_V1` is already persisted and versioned, with missing-data gates, customer matching, confirmation and failure honesty.
- Field text/photo Blake is a separate prompt-and-response route. It does not yet use the office capabilities.
- Field Realtime voice already mints an ephemeral client secret server-side, but the session is not yet connected to the same business capability executor.
- Authentication and role access are server-derived. Current file-backed workspace stores are deployment-scoped rather than fully tenant-keyed, so deployment isolation is the present hard boundary. The new registry carries and verifies tenant context, but a future shared multi-tenant database must also add tenant keys and row-level enforcement.
- Existing schedule, lead, quote, job, invoice and report services should be reused. They must be extracted behind capabilities incrementally rather than rewritten.

## Implemented foundation

- Shared transport-safe contracts in `@hubflo/domain`: channels, actors, capability definitions/results, structured conversation context and date-period helpers.
- Server-only Blake capability registry with strict parsers, permission gates, confirmation gates, execution IDs, bounded execution telemetry and write audit events.
- Persisted structured conversation context separate from raw chat messages.
- Initial capabilities:
  - `search_nexa_records`
  - `check_schedule_availability`
  - `build_management_report`
  - `create_lead`
- `CREATE_LEAD_V1` now executes its final write through Blake Core rather than a separate action implementation.
- Authenticated `/api/blake/capabilities` contract for every client channel. The server derives the actor, tenant and permissions from trusted request headers.

## Required next phases

1. Replace remaining direct office-assistant schedule reads/writes with shared schedule services and capabilities.
2. Add OpenAI Responses tool orchestration over only the capabilities visible to the current user. Use strict function schemas and validate again server-side.
3. Add capability-backed record focus and follow-up context, including the “17 Hillside Drive” scenario.
4. Expand management reporting from the current management view to job/cost-centre actuals while retaining a clear non-statutory accounting label.
5. Route Field text/photo and Realtime voice through the same orchestrator.
6. Add evals for permissions, deployment/workspace isolation, confirmation, timeout, retry and honest failure responses.

## Safety rules

- Writes default to confirmation required.
- A capability declares its required NeXa permissions; UI visibility is not treated as authorization.
- Capability inputs are parsed and validated in NeXa code after model selection.
- Results are bounded; Blake must never echo full BoQ or hub state.
- A failed write is reported as failed. Blake never says an action completed unless the capability returned success.

OpenAI implementation follows the Responses API function-tool pattern with strict schemas. Realtime clients receive short-lived client secrets from NeXa; permanent OpenAI credentials never ship to a browser or mobile app.
