# Crisphive MCP — Tool Reference

26 field-service-management tools — job booking, appointment scheduling,
crew/skill/availability matching, work-order tracking, dispatch data, CRM
sync, service catalog, workforce, territories and fleet — each wrapping one operation of the public REST `/v1`
API. Tool names are the REST `operationId`s — stable, extend-only (a breaking
change would ship as a new API version, never as a renamed tool). The
authoritative machine-readable contract (schemas, field docs, enums) is the
OpenAPI 3.0.3 spec: `https://api.crisphive.com/developers/openapi.json`.

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
| `createJobRequest` | `POST /v1/job-requests` | Book a field-service job — the work order that enters the dispatch & scheduling pipeline: `customer_id` + `job_dates` (1–12 entries of date + morning/afternoon/evening periods). Optional `job_type_id`, `skill_ids`, `description`. Supports `idempotency_key`. |
| `listJobRequests` | `GET /v1/job-requests` | List bookings (work orders) with dispatch-oriented filters: workflow status, customer, technician, date range, search. Doubles as the SCHEDULE query: `technician_id` + `scheduled_from`/`scheduled_to` reads one technician's agenda for a day or week. |
| `getJobRequest` | `GET /v1/job-requests/{id}` | Full work-order detail: workflow status, quoted duration, confirmed schedule, assigned technician / crew. |
| `getJobRequestTimeline` | `GET /v1/job-requests/{id}/timeline` | Job lifecycle timeline — per-status progress of the work order (booked → confirmed → en route → arrived → completed). |
| `listJobRequestBookingWindows` | `GET /v1/job-requests/booking-windows` | Real-time appointment availability from the scheduling engine (technician capacity, working hours, territory coverage). Requires `x_timezone` (IANA timezone). Call this first and offer only the returned windows. |
| `listJobRequestChanges` | `GET /v1/job-requests/changes` | Incremental sync feed keeping an external CRM/ERP/field-service tool live: pass the last `next_since` watermark, upsert results by `id`, poll again immediately while `has_more` is true. |

Quoting, confirming and completing a job are dashboard operations — an
integration **observes** those transitions via `listJobRequestChanges` (or
webhooks), it does not drive them.

## Matching & scheduling — read-only, engine-computed

| Tool | REST operation | Description |
|---|---|---|
| `listMatchingSlots` | `GET /v1/job-requests/{id}/time-segments` | Matching time slots for a QUOTED job: the bookable arrival-window grid, each slot listing the technicians actually available then (skills, weekly availability, existing schedule, time off and travel all checked) with per-technician match scores. Optional `step_minutes` (5–240) overrides the slot width. |
| `listCrewCandidates` | `GET /v1/job-requests/{id}/crew-candidates` | Ranked feasible technicians for a job — per-slot skill matching, score breakdown (distance, travel, matched skills) and the exact on-site session plan each candidate would work. `include_buddies`, `include_vehicle`, `force_lead_id` (check one specific technician; error if not feasible). NOT a raw roster — that's `listTechnicians`. |
| `listTechnicianAvailability` | `GET /v1/technician-availability` | The team's recurring weekly working hours: shift/break rows per `week_day` (0=Monday), bounded by `start_minute`/`end_minute` in minutes since midnight. The schedule template the matching engine checks candidates against. |
| `getTechnicianAvailability` | `GET /v1/technicians/{id}/availability` | One technician's weekly working hours — answers "when does this technician work?". |

## Catalog — read-only (discover the reference IDs used by the writes above)

| Tool | REST operation | Description |
|---|---|---|
| `listJobTypes` | `GET /v1/job-types` | The business's service catalog — offerings like installation, repair, maintenance, inspection (for `job_type_id`). |
| `getJobType` | `GET /v1/job-types/{id}` | Get one service-catalog entry (job/work-order type) with localized display name. |
| `listSkills` | `GET /v1/skills` | Flat list of technician skills / qualifications — the vocabulary of skill-based dispatch (primary discovery call for `skill_ids`). |
| `listSkillCategories` | `GET /v1/skill-categories` | Skill categories — qualifications grouped by trade/specialty (HVAC, plumbing, electrical, …). |
| `listSkillsByCategory` | `GET /v1/skill-categories/{id}/skills` | Skills within one trade/specialty category, with per-skill technician counts. |
| `listServiceAreas` | `GET /v1/service-areas` | Geographic coverage: service territories / coverage zones (for `service_area_id` on customers). |
| `getServiceArea` | `GET /v1/service-areas/{id}` | Get one service territory (coverage zone). |

## Team & fleet — read-only

| Tool | REST operation | Description |
|---|---|---|
| `listTechnicians` | `GET /v1/technicians` | The field workforce roster: technicians with status, assignment tier, skills and crew relations (for `preferred_technician_id`). |
| `getTechnician` | `GET /v1/technicians/{id}` | One technician's dispatch-ready profile: status, tier, qualifications, crew relations, vehicles. |
| `listVehicles` | `GET /v1/vehicles` | The service fleet: vans/trucks with operational status (idle, on job, maintenance). |
| `getVehicle` | `GET /v1/vehicles/{id}` | Get one fleet vehicle and which technicians use it. |

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

Every tool returns the Crisphive response envelope as a text block **and** as
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
