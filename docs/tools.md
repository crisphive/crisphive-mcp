# CrispHive MCP — Tool Reference

22 tools, each wrapping one operation of the public REST `/v1` API. Tool names
are the REST `operationId`s — stable, extend-only (a breaking change would ship
as a new API version, never as a renamed tool). The authoritative
machine-readable contract (schemas, field docs, enums) is the OpenAPI 3.0.3
spec: `https://api.crisphive.com/developers/openapi.json`.

## Customers — full CRUD (CRM sync)

| Tool | REST operation | Description |
|---|---|---|
| `listCustomers` | `GET /v1/customers` | List customers (paginated; also supports the `since` incremental-sync cursor). |
| `createCustomer` | `POST /v1/customers` | Create a customer. Requires `full_name` + at least one of `phone`/`email`. Supports `idempotency_key`. |
| `getCustomer` | `GET /v1/customers/{id}` | Get one customer. |
| `updateCustomer` | `PUT /v1/customers/{id}` | Update a customer. |
| `deleteCustomer` | `DELETE /v1/customers/{id}` | Delete a customer (destructive — clients confirm). |

## Bookings (job requests) — create & track

| Tool | REST operation | Description |
|---|---|---|
| `createJobRequest` | `POST /v1/job-requests` | Create a booking for an existing customer: `customer_id` + `job_dates` (1–12 entries of date + morning/afternoon/evening periods). Optional `job_type_id`, `skill_ids`, `description`. Supports `idempotency_key`. |
| `listJobRequests` | `GET /v1/job-requests` | List job requests (paginated). |
| `getJobRequest` | `GET /v1/job-requests/{id}` | Full booking detail: status, schedule, assigned crew. |
| `getJobRequestTimeline` | `GET /v1/job-requests/{id}/timeline` | Per-status progress timeline of a job. |
| `listJobRequestBookingWindows` | `GET /v1/job-requests/booking-windows` | Bookable date/period windows from the live scheduling engine. Requires `x_timezone` (IANA timezone). Call this first and offer only the returned windows. |
| `listJobRequestChanges` | `GET /v1/job-requests/changes` | Incremental sync feed: pass the last `next_since` watermark, upsert results by `id`, poll again immediately while `has_more` is true. |

Quoting, confirming and completing a job are dashboard operations — an
integration **observes** those transitions via `listJobRequestChanges` (or
webhooks), it does not drive them.

## Catalog — read-only (discover the reference IDs used by the writes above)

| Tool | REST operation | Description |
|---|---|---|
| `listJobTypes` | `GET /v1/job-types` | List the business's service catalog (for `job_type_id`). |
| `getJobType` | `GET /v1/job-types/{id}` | Get one job type. |
| `listSkills` | `GET /v1/skills` | Flat list of all active skills (primary discovery call for `skill_ids`). |
| `listSkillCategories` | `GET /v1/skill-categories` | List skill categories. |
| `listSkillsByCategory` | `GET /v1/skill-categories/{id}/skills` | List skills within a category. |
| `listServiceAreas` | `GET /v1/service-areas` | List geographic service areas (for `service_area_id` on customers). |
| `getServiceArea` | `GET /v1/service-areas/{id}` | Get one service area. |

## Team & fleet — read-only

| Tool | REST operation | Description |
|---|---|---|
| `listTechnicians` | `GET /v1/technicians` | List the technician roster (for `preferred_technician_id` on customers). |
| `getTechnician` | `GET /v1/technicians/{id}` | Get one technician. |
| `listVehicles` | `GET /v1/vehicles` | List the vehicle fleet (display-only). |
| `getVehicle` | `GET /v1/vehicles/{id}` | Get one vehicle. |

---

## Argument conventions

- Path params, query params and request-body fields are **flattened into one
  arguments object** per tool.
- Header inputs become snake_case arguments: `idempotency_key`
  (create tools → `Idempotency-Key`), `x_timezone` (→ `X-Timezone`).
- All IDs are UUIDs; timestamps are RFC3339 UTC; times-of-day are integer
  minutes since midnight (0–1440), never `"HH:MM"`.
- List tools paginate with `page`/`limit` (default 15, max 1000) and return a
  `meta` object (`total`, `count`, `per_page`, `current_page`, `total_pages`).

## Result conventions

Every tool returns the CrispHive response envelope as a text block **and** as
`structuredContent`, with a per-tool `outputSchema`:

```json
{ "error_code": 0, "message": "Success", "errors": null, "data": { … } }
```

- `error_code` is `0` on success, a stable string on failure
  (`CUSTOMER_NOT_FOUND`, `VALIDATION_ERROR`, `API_KEY_INVALID`, …). Match
  codes, never message strings (messages are localized).
- `isError` is set on the tool result when the underlying HTTP status is ≥ 400.
- Behavior hints: reads carry `readOnlyHint`, deletes carry `destructiveHint`,
  PUT/DELETE carry `idempotentHint`.

## Environments

The credential decides the environment — there is no separate sandbox host:

| Credential | Data |
|---|---|
| `chsk_test_…` key | **Sandbox** — isolated test data, never reaches a real customer |
| `chsk_live_…` key | **Production** |
| OAuth token | The environment of the dashboard session that consented |

Use sandbox for all development and agent experimentation.
