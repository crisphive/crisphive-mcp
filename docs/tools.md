# Crisphive MCP — Tool Reference

56 field-service-management tools — job booking, quoting & schedule
confirmation, appointment scheduling, crew/skill/availability matching,
priority (P0–P3) & SLA management, emergency dispatch with cascade
rescheduling, job moves, work-order tracking, dispatch data, CRM sync,
service catalog, workforce + team-roster management (HR sync), territories,
fleet and webhook-endpoint management (event callbacks) — each wrapping one
operation of the public REST `/v1` API. Tool names are the REST `operationId`s — stable, extend-only (a breaking
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
| `createJobRequest` | `POST /v1/job-requests` | Book a field-service job — the work order that enters the dispatch & scheduling pipeline: `customer_id` + `job_dates` (1–12 entries of date + morning/afternoon/evening periods). Optional `job_type_id`, `skill_ids`, `description`, `priority` (`p0`–`p3`, default from business settings) and `sla_deadline` (P1 only — arms auto-escalation to P0). Supports `idempotency_key`. |
| `listJobRequests` | `GET /v1/job-requests` | List bookings (work orders) with dispatch-oriented filters: workflow status, customer, technician, date range, search. Doubles as the SCHEDULE query: `technician_id` + `scheduled_from`/`scheduled_to` reads one technician's agenda for a day or week. |
| `getJobRequest` | `GET /v1/job-requests/{id}` | Full work-order detail: workflow status, quoted duration, confirmed schedule, assigned technician / crew. |
| `getJobRequestTimeline` | `GET /v1/job-requests/{id}/timeline` | Job lifecycle timeline — per-status progress of the work order (booked → confirmed → en route → arrived → completed). |
| `listJobRequestBookingWindows` | `GET /v1/job-requests/booking-windows` | Real-time appointment availability from the scheduling engine (technician capacity, working hours, territory coverage). Requires `x_timezone` (IANA timezone). Call this first and offer only the returned windows. |
| `listJobRequestChanges` | `GET /v1/job-requests/changes` | Incremental sync feed keeping an external CRM/ERP/field-service tool live: pass the last `next_since` watermark, upsert results by `id`, poll again immediately while `has_more` is true. |

An integration can now DRIVE the schedule end-to-end (create → quote →
confirm — see "Scheduling actions" below). Completing a job stays a
dashboard/technician operation — observe it via `listJobRequestChanges` (or
webhooks).

## Matching & scheduling — read-only, engine-computed

| Tool | REST operation | Description |
|---|---|---|
| `listMatchingSlots` | `GET /v1/job-requests/{id}/time-segments` | Matching time slots for a QUOTED job: the bookable arrival-window grid, each slot listing the technicians actually available then (skills, weekly availability, existing schedule, time off and travel all checked) with per-technician match scores. Optional `step_minutes` (5–240) overrides the slot width. |
| `listCrewCandidates` | `GET /v1/job-requests/{id}/crew-candidates` | Ranked feasible technicians for a job — per-slot skill matching, score breakdown (distance, travel, matched skills) and the exact on-site session plan each candidate would work. `include_buddies`, `include_vehicle`, `force_lead_id` (check one specific technician; error if not feasible). NOT a raw roster — that's `listTechnicians`. |
| `listTechnicianAvailability` | `GET /v1/technician-availability` | The team's recurring weekly working hours: shift/break rows per `week_day` (0=Monday), bounded by `start_minute`/`end_minute` in minutes since midnight. The schedule template the matching engine checks candidates against. |
| `getTechnicianAvailability` | `GET /v1/technicians/{id}/availability` | One technician's weekly working hours — answers "when does this technician work?". |
| `getTechnicianSchedule` | `GET /v1/technicians/{id}/schedule` | The technician's REAL occupancy over a date range (`from`/`to`, max 31 days): job sessions (solo/lead and crew lanes) + approved time-off blocks. Combine with the weekly hours above for the full availability picture. |
| `listNearbyTechnicians` | `GET /v1/technicians/nearby` | Job-less location query: who could serve a hypothetical visit at (`lat`,`lng`) starting `at` for `duration_minutes` — engine-checked hours/schedule/time-off/territories/skills, ranked nearest-arrival first (ETA from static start locations). Use before creating a booking. |

## Scheduling actions — drive the schedule via API

| Tool | REST operation | Description |
|---|---|---|
| `quoteJobRequest` | `POST /v1/job-requests/{id}/quote` | Set the job's time bundle: `job_duration_minutes` (+ optional mobilization/demobilization and a multi-person `crew` plan — exactly one lead, wrench_percent summing to 100). Required before confirming. |
| `confirmJobRequest` | `POST /v1/job-requests/{id}/confirm` | Confirm the schedule: `scheduled_at` (business-local naive datetime). Crisphive auto-selects the optimal technician/crew (location, skills, availability, priority) — or pass `technician_id` to force a specific lead (feasibility still enforced). No capacity → `JOB_REQUEST_NO_TECHNICIAN_AVAILABLE`; a P0 gets `JOB_REQUEST_P0_REQUIRES_DISPLACEMENT` (use the emergency flow). Supports `idempotency_key`. |
| `previewJobRequestMove` | `POST /v1/job-requests/{id}/move/preview` | Preview moving a confirmed job to a new time and/or technician: validates the landing slot (customer-window hard block, occupied-slot check) and returns displaced jobs, warnings and crew swaps — WITHOUT writing. |
| `commitJobRequestMove` | `POST /v1/job-requests/{id}/move/commit` | Apply the previewed move (echo `expected_version` / `expected_move_ids` to fence drift → `SCHEDULE_MOVE_PLAN_DRIFTED`). Non-P0 moves must land in free capacity unless the business enabled `allow_non_p0_displacement`. Supports `idempotency_key`. |

## Priority & emergency dispatch (P0–P3, SLA, cascade)

| Tool | REST operation | Description |
|---|---|---|
| `updateJobPriority` | `PATCH /v1/job-requests/{id}/priority` | Set a job's P0–P3 priority (+ optional `sla_deadline` on P1 — arms auto-escalation to P0 with a pre-escalation warning — and `note` justification for the audit trail). |
| `listEmergencyCandidates` | `POST /v1/job-requests/emergency/candidates` | Ranked technicians for a P0 emergency insert — fastest arrival first, each with its displacement preview, plus a historical `crew_recommendation` (median crew size on comparable completed jobs; ALWAYS display its disclaimer). |
| `previewEmergencyReschedule` | `POST /v1/job-requests/emergency/preview` | The full cascade WITHOUT writing: which jobs move per day — or, with `displacement_mode: "reassign"`, which are handed to another technician at their ORIGINAL time (`reassignments`). |
| `commitEmergencyReschedule` | `POST /v1/job-requests/emergency/commit` | Apply the previewed emergency plan (locks + version fences; drift → `EMERGENCY_RESCHEDULE_PLAN_DRIFTED`, re-preview — in reassign mode some displaced jobs may already be re-staffed and notified). The emergency job must be `p0` and quoted; an unconfirmed job is auto-confirmed. Supports `idempotency_key`. |

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

## Team & fleet — reads

| Tool | REST operation | Description |
|---|---|---|
| `listTechnicians` | `GET /v1/technicians` | The field workforce roster: technicians with status, assignment tier, skills and crew relations (for `preferred_technician_id`). |
| `getTechnician` | `GET /v1/technicians/{id}` | One technician's dispatch-ready profile: status, tier, qualifications, crew relations, vehicles. |
| `listVehicles` | `GET /v1/vehicles` | The service fleet: vans/trucks with operational status (idle, on job, maintenance). |
| `getVehicle` | `GET /v1/vehicles/{id}` | Get one fleet vehicle and which technicians use it. |

---

## Team roster management — HR-system sync

Create and maintain technicians — the same operations the business dashboard
uses. Creating a technician runs the full identity flow (the person is
resolved or created from phone/email; login is passwordless later; NO invite
email is sent). Relation writes are REPLACE semantics: send the full list,
`[]` clears. The matching engine ranks on skills/buddies/vehicles/service
areas, so keep them in sync.

| Tool | REST operation | Description |
|---|---|---|
| `createTechnician` | `POST /v1/technicians` | Add a team member. Requires `business_group_id` (discover via `listBusinessGroups`) and at least one of `phone`/`email`. Optional `assignment_tier` (lead/buddy/float), day-start location, inline `buddy_ids`/`lead_ids`/`service_area_ids`. Supports `idempotency_key`. |
| `updateTechnician` | `PUT /v1/technicians/{id}` | Full-replace profile update (send every field; relations have their own tools). |
| `deleteTechnician` | `DELETE /v1/technicians/{id}` | Remove from the roster (soft; buddy/vehicle references are scrubbed automatically). |
| `replaceTechnicianBuddies` | `PUT /v1/technicians/{id}/buddies` | Set a lead's buddy list (self-buddy rejected). |
| `replaceTechnicianLeads` | `PUT /v1/technicians/{id}/leads` | Same relation from the buddy's side: which leads this technician assists. |
| `replaceTechnicianVehicles` | `PUT /v1/technicians/{id}/vehicles` | Set the vehicles the technician uses (discover via `listVehicles`). |
| `replaceTechnicianServiceAreas` | `PUT /v1/technicians/{id}/service-areas` | Set the technician's service-area assignments (discover via `listServiceAreas`). |
| `replaceTechnicianSkills` | `PATCH /v1/technicians/{id}/skills` | Set the technician's skill set (discover via `listSkills`). |
| `listTechnicianSkills` | `GET /v1/technicians/{id}/skills` | Read a technician's assigned skills (paginated). |
| `listBusinessGroups` | `GET /v1/permission/groups` | The business's role groups — the `business_group_id` reference for create/update (needs the `permission_view` scope on restricted keys; full-access keys always pass). |

Suspension/status changes and role-group AUTHORING stay dashboard-only.
Owner/Administrator group assignment is rejected for API keys
(`TECHNICIAN_ROLE_API_KEY_FORBIDDEN`), and the last active Owner cannot be
removed or demoted (`TECHNICIAN_LAST_OWNER`). Sandbox caveat: a chsk_test_
create still resolves the REAL person identity for the given phone/email —
use throwaway addresses when experimenting.

## Webhooks — event-callback management

Provision the endpoints Crisphive POSTs events to (instead of polling), fully
via API. The `whsec_` signing secret is returned **once** at create — store it;
verify the `Crisphive-Signature` HMAC-SHA256 header with it. A `chsk_test_` key
manages sandbox endpoints (they only ever receive sandbox events).

| Tool | REST | Purpose |
|---|---|---|
| `createWebhookEndpoint` | `POST /v1/webhooks` | Register an HTTPS callback URL (+ optional `event_types`; empty = all). Sends a synchronous signed verification ping — a 2xx is born `active`, else `pending_verification`. Returns the `whsec_` secret ONCE. Supports `idempotency_key` (a retry never mints a second endpoint/secret). |
| `listWebhookEndpoints` | `GET /v1/webhooks` | List the business's webhook endpoints (paginated; `status` filter). |
| `getWebhookEndpoint` | `GET /v1/webhooks/{id}` | Get one endpoint (status, failure count, verified-at). |
| `updateWebhookEndpoint` | `PATCH /v1/webhooks/{id}` | Update URL / description / event_types, or pause (`status: disabled`). Changing the URL demotes to `pending_verification`. |
| `deleteWebhookEndpoint` | `DELETE /v1/webhooks/{id}` | Delete an endpoint (destructive — clients confirm). |
| `listWebhookEventTypes` | `GET /v1/webhooks/event-types` | The subscribable event catalog (`job_request.*`, `customer.*`, `technician.*`). |
| `verifyWebhookEndpoint` | `POST /v1/webhooks/{id}/verify` | Re-send the signed ping — a 2xx (re)activates the endpoint and resets its failure counter. The ONLY path back to `active` after auto-disable. Rate-limited (outbound). |
| `testWebhookEndpoint` | `POST /v1/webhooks/{id}/test` | Send a diagnostic signed `ping` (state never changes) to confirm your receiver + signature handling. Rate-limited (outbound). |
| `listWebhookEndpointDeliveries` | `GET /v1/webhooks/{id}/deliveries` | Delivery history for one endpoint (status, attempts, last HTTP code/error). |
| `listWebhookDeliveries` | `GET /v1/webhooks/deliveries` | Business-wide delivery log across all endpoints (`status`/`endpoint_id` filters). |

Endpoints auto-disable after 5 consecutive delivery failures (re-activate via
`verifyWebhookEndpoint`). Deliveries are at-least-once — dedupe by the event
`id`. Callback URLs must be public HTTPS (internal/loopback/metadata targets are
rejected).

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
