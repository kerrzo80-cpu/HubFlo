# Verrova Integration Intake

Verrova is the hub. Existing apps can feed work into it through one intake endpoint:

```http
POST /api/integrations/intake
Content-Type: application/json
Authorization: Bearer <HUBFLO_INTEGRATION_TOKEN>
```

The bearer token is only required when `HUBFLO_INTEGRATION_TOKEN` is configured.

## Envelope

```json
{
  "eventType": "lead.create",
  "source": "ai-surveyor",
  "externalId": "survey-123",
  "actor": "AI Surveyor",
  "payload": {}
}
```

`source` should name the feeding system, for example `ai-surveyor`, `engineer-app`, `outlook`, `whatsapp`, `supplier-parser`, or `room-scanner`.

`externalId` should be the source system reference where available. Verrova uses it for traceability and idempotency on hub detail events.

## Supported Events

### `lead.create`

Creates a lead and links or creates the customer/site where possible.

```json
{
  "eventType": "lead.create",
  "source": "website",
  "externalId": "web-10042",
  "actor": "Website form",
  "payload": {
    "source": "Website",
    "customerName": "Jane Smith",
    "phone": "07700 900000",
    "email": "jane@example.com",
    "address": "1 Union Street, Aberdeen",
    "description": "Bathroom refurbishment enquiry",
    "status": "Needs scheduling",
    "surveyor": "Errol Watson",
    "surveyDate": "",
    "surveyTime": "",
    "createdBy": "Website"
  }
}
```

### `quote.create`

Creates a quote shell from an estimating app, BOQ importer, or office tool.

```json
{
  "eventType": "quote.create",
  "source": "ai-surveyor",
  "externalId": "estimate-889",
  "payload": {
    "customer": "Northfield Properties",
    "description": "Heating upgrade from AI surveyor",
    "owner": "Errol Watson",
    "status": "Draft",
    "value": 12450,
    "next": "Review imported BOQ and supplier list",
    "due": "TBC"
  }
}
```

### `job.create`

Creates a reactive or imported job.

```json
{
  "eventType": "job.create",
  "source": "engineer-app",
  "externalId": "reactive-441",
  "payload": {
    "customer": "A. Davidson",
    "site": "7 Cairn View, Westhill",
    "description": "Emergency leak repair",
    "manager": "Chris Watson",
    "status": "Pending",
    "value": 0,
    "next": "Attend and capture time/materials",
    "due": "Today"
  }
}
```

### `job.update`

Updates a known job by Verrova `id`.

```json
{
  "eventType": "job.update",
  "source": "scheduler",
  "payload": {
    "id": "job-1052",
    "status": "Scheduled",
    "scheduledDate": "2026-06-29",
    "scheduledTime": "09:00",
    "manager": "Errol Watson"
  }
}
```

### `purchase_request.create`

Creates a PO request from site or estimating.

```json
{
  "eventType": "purchase_request.create",
  "source": "engineer-app",
  "externalId": "po-request-77",
  "payload": {
    "jobId": "job-1052",
    "jobRef": "J-1052",
    "requestedBy": "Engineer",
    "supplier": "City Plumbing",
    "item": "Radiators and valves",
    "estimatedCost": 840,
    "reason": "Required for first fix"
  }
}
```

### `job_event.create`

Adds a delivery event into the shared hub detail state, such as WhatsApp updates, attendance, timesheets, variations, or PO notes.

```json
{
  "eventType": "job_event.create",
  "source": "whatsapp",
  "externalId": "wamid-123",
  "payload": {
    "jobId": "job-1052",
    "jobRef": "J-1052",
    "kind": "whatsapp",
    "summary": "Engineer confirmed arrival time with customer.",
    "status": "Captured"
  }
}
```

### `communication.create`

Adds a captured Outlook, WhatsApp, portal, or other message thread item.

```json
{
  "eventType": "communication.create",
  "source": "outlook",
  "externalId": "message-id-123",
  "payload": {
    "recordType": "quote",
    "recordId": "quote-2061",
    "direction": "inbound",
    "channel": "Outlook",
    "subject": "Re: Quote Q-2061",
    "body": "Please proceed.",
    "from": "client@example.com",
    "to": "office@example.com",
    "status": "Received"
  }
}
```

### `audit.append`

Adds an audit entry to the hub log.

```json
{
  "eventType": "audit.append",
  "source": "supplier-parser",
  "externalId": "parse-555",
  "payload": {
    "actor": "Supplier parser",
    "action": "imported",
    "recordType": "quote",
    "recordId": "quote-2061",
    "summary": "Supplier PDF rates imported into quote.",
    "importance": "normal"
  }
}
```
