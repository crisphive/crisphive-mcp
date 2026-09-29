# Crisphive MCP — Tool Reference

65 field-operations tools — job booking, quoting & schedule
confirmation, appointment scheduling, crew/skill/availability matching,
priority (P0–P3) & SLA management, emergency dispatch with cascade
rescheduling, job moves, work-order tracking, dispatch data, CRM sync,
service catalog, workforce + team-roster management (HR sync), territories and fleet — each wrapping one
operation of the public REST `/v1` API. Tool names are the REST `operationId`s — stable, extend-only (a breaking
change would ship as a new API version, never as a renamed tool). The
authoritative machine-readable contract (schemas, field docs, enums) is the
OpenAPI 3.0.3 spec: `https://api.crisphive.com/developers/openapi.json`.

## Customers — full CRUD (CRM sync)

| Tool | REST operation | Description |
|---|---|---|
| `listCustomers` | `GET /v1/customers` | List customers (paginated; also supports the `since` incremental-sync cursor). `phone=` is an EXACT caller lookup in E.164 (`+16135550188`) — match a caller before creating them; an unparseable number is refused with `PHONE_INVALID`, never answered with an empty page. `q` stays the fuzzy search. |
| `createCustomer` | `POST /v1/customers` | Create a customer. Requires `full_name` + at least one of `phone`/`email`. Supports `idempotency_key`. |
| `getCustomer` | `GET /v1/customers/{id}` | Get one customer. |
| `updateCustomer` | `PUT /v1/customers/{id}` | Update a customer. |
| `deleteCustomer` | `DELETE /v1/customers/{id}` | Delete a customer (destructive — clients confirm). |

## Bookings (job requests) — create & track

| Tool | REST operation | Description |
|---|---|---|
| `createJobRequest` | `POST /v1/job-requests` | Book a field-operations job — the work order that enters the dispatch & scheduling pipeline: `customer_id` + `job_dates` (1–12 entries of date + morning/afternoon/evening periods). Optional `job_type_id`, `skill_ids`, `description`, `priority` (`p0`–`p3`, default from business settings) and `sla_deadline` (P1 only — arms auto-escalation to P0). Supports `idempotency_key`. |
| `listJobRequests` | `GET /v1/job-requests` | List bookings (work orders) with dispatch-oriented filters: workflow status, customer, technician, date range, search. Doubles as the SCHEDULE query: `technician_id` + `scheduled_from`/`scheduled_to` reads one technician's agenda for a day or week. |
| `getJobRequest` | `GET /v1/job-requests/{id}` | Full work-order detail: workflow status, quoted duration, confirmed schedule, assigned technician / crew. |
| `getJobRequestTimeline` | `GET /v1/job-requests/{id}/timeline` | Job lifecycle timeline — per-status progress of the work order (booked → confirmed → en route → arrived → completed). |
| `listJobRequestBookingWindows` | `GET /v1/job-requests/booking-windows` | Real-time appointment availability from the scheduling engine (technician capacity, working hours, territory coverage). Requires `x_timezone` (IANA timezone). Call this first and offer only the returned windows. |
| `listJobRequestChanges` | `GET /v1/job-requests/changes` | Incremental sync feed keeping an external CRM/ERP/field-operations tool live: pass the last `next_since` watermark, upsert results by `id`, poll again immediately while `has_more` is true. |

An integration can now DRIVE the schedule end-to-end (create → quote →
confirm — see "Scheduling actions" below). Completing a job stays a
dashboard/technician operation — observe it via `listJobRequestChanges` (or
webhooks).

## Matching & scheduling — read-only, engine-computed

| Tool | REST operation | Description |
|---|---|---|
| `listMatchingSlots` | `GET /v1/job-requests/{id}/time-segments` | Matching time slots for a QUOTED job: the bookable arrival-window grid, each slot listing the technicians actually available then (skills, weekly availability, existing schedule, time off and travel all checked) with per-technician match scores. Optional `step_minutes` (5–240) overrides the slot width. |
| `listCrewCandidates` | `GET /v1/job-requests/{id}/crew-candidates` | Ranked feasible technicians for a job — per-slot skill matching, score breakdown (distance, travel, matched skills) and the exact on-site session plan each candidate would work. `include_buddies`, `include_vehicle`, `force_lead_id` (check one specific technician; error if not feasible). NOT a raw roster — that's `listTechnicians`. |
| `getTechnicianSchedule` | `GET /v1/technicians/{id}/schedule` | The technician's REAL occupancy over a date range (`from`/`to`, max 31 days): job sessions (solo/lead and crew lanes) + approved time-off blocks — when the technician is actually busy vs free. |
| `listNearbyTechnicians` | `GET /v1/technicians/nearby` | Job-less location query: who could serve a hypothetical visit at (`lat`,`lng`) starting `at` for `duration_minutes` — engine-checked hours/schedule/time-off/territories/skills, ranked nearest-arrival first (ETA from static start locations). Use before creating a booking. |

## Scheduling actions — drive the schedule via API

| Tool | REST operation | Description |
|---|---|---|
| `quoteJobRequest` | `POST /v1/job-requests/{id}/quote` | Set the job's time bundle: `job_duration_minutes` (+ optional mobilization/demobilization and a multi-person `crew` plan — exactly one lead, wrench_percent summing to 100). Required before confirming. Before writing it checks the customer will see at least one slot (same engine as the slot picker, over the windows the customer asked for, with THIS duration): no slot → `409 JOB_REQUEST_QUOTE_NOT_SCHEDULABLE` with `data.reason` (`outside_working_hours`, `requested_windows_passed`, `outside_service_area`, `off_shift`, `no_technician_available`, …) and `data.blocked_by`. Agree a different time with the customer, or resend with `force: true` to schedule anyway (the override is recorded in the activity feed). Added 2026-09-24. |
| `confirmJobRequest` | `POST /v1/job-requests/{id}/confirm` | Confirm the schedule: `scheduled_at` is a BUSINESS-LOCAL wall clock — canonical `2026-09-23T09:00:00`; seconds may be omitted and a space may replace the `T`. An offset is accepted ONLY when it agrees with the business timezone (`…T09:00:00-04:00` for a Toronto business in EDT is fine, `…T09:00:00Z` is not — it names 05:00 there); a disagreeing offset → `400 JOB_REQUEST_INVALID_INPUT` whose `data` carries `business_timezone`, `expected_format` and `means_locally`, enough to fix in one retry. Crisphive auto-selects the optimal technician/crew (location, skills, availability, priority) — or pass `technician_id` to force a specific lead (feasibility still enforced). No capacity → `JOB_REQUEST_NO_TECHNICIAN_AVAILABLE` with `data.blockers[]` naming every hard filter that refused; a P0 gets `JOB_REQUEST_P0_REQUIRES_DISPLACEMENT` (use the emergency flow). Supports `idempotency_key`. |
| `bookAndConfirmJobRequest` | `POST /v1/job-requests/book-and-confirm` | Book + quote + confirm in ONE call — built for voice agents and automation platforms. Send `customer_id`, or an inline `customer` (+ `address`) that is matched by phone/email or created. `job_duration_minutes` is optional when the job type has a default duration (every business's default type, "General", ships with 60 min + 15 + 15). Every input is validated before anything is written (4xx, nothing created). Once the job exists it is never discarded: a scheduling refusal answers **200** with `confirmed: false` and `refusal` (`stage` + the exact `error_code`/`data` quote or confirm would have returned) — the job then waits, quoted, in the coordinator's queue. Retry with the SAME `idempotency_key`; a new key books a second job. Needs `job_create` and `job_manage`. Added 2026-09-28. |
| `previewJobRequestMove` | `POST /v1/job-requests/{id}/move/preview` | Preview moving a confirmed job to a new time and/or technician: validates the landing slot (customer-window hard block, occupied-slot check) and returns displaced jobs, warnings and crew swaps — WITHOUT writing. |
| `commitJobRequestMove` | `POST /v1/job-requests/{id}/move/commit` | Apply the previewed move (echo `expected_version` / `expected_move_ids` to fence drift → `SCHEDULE_MOVE_PLAN_DRIFTED`). Non-P0 moves must land in free capacity unless the business enabled `allow_non_p0_displacement`. Supports `idempotency_key`. |

## Priority & emergency dispatch (P0–P3, SLA, cascade)

| Tool | REST operation | Description |
|---|---|---|
| `updateJobPriority` | `PATCH /v1/job-requests/{id}/priority` | Set a job's P0–P3 priority (+ optional `sla_deadline` on P1 — arms auto-escalation to P0 with a pre-escalation warning — and `note` justification for the audit trail). |
| `listEmergencyCandidates` | `POST /v1/job-requests/emergency/candidates` | Ranked technicians for a P0 emergency insert — fastest arrival first, each with its displacement preview, plus a historical `crew_recommendation` (median crew size on comparable completed jobs; ALWAYS display its disclaimer). |
| `previewEmergencyReschedule` | `POST /v1/job-requests/emergency/preview` | The full cascade WITHOUT writing: which jobs move per day — or, with `displacement_mode: "reassign"`, which are handed to another technician at their ORIGINAL time (`reassignments`). |
| `commitEmergencyReschedule` | `POST /v1/job-requests/emergency/commit` | Apply the previewed emergency plan (locks + version fences; drift → `EMERGENCY_RESCHEDULE_PLAN_DRIFTED`, re-preview — in reassign mode some displaced jobs may already be re-staffed and notified). The emergency job must be `p0` and quoted; an unconfirmed job is auto-confirmed. Supports `idempotency_key`. |

## Absence resolve — re-staff a sick technician's whole day

| Tool | REST operation | Description |
|---|---|---|
| `previewAbsenceResolve` | `POST /v1/job-requests/absence/preview` | Solve, WITHOUT writing, the re-staffing of every single-person job on `technician_id`'s board for `date`…`until_date` (business-local `YYYY-MM-DD`, inclusive, ≤ 14 days; optional `job_ids` subset). Each job in `resolved[]` is handed to an alternate lead at its UNCHANGED window — the customer's appointment never moves, two overlapping jobs never land on the same alternate, the absent technician is never a candidate. `unresolved[]` carries a `reason_code` (`NO_QUALIFIED_TECH_FREE`, `CREW_JOB_UNSUPPORTED`, `MULTIDAY_UNSUPPORTED`, `IN_PROGRESS`); a partial plan is a normal result. `distance_km`/`travel_minutes` are ABSENT when unknown — never render `0 km`. `solver.duration_ms` is server planner time; `solver.deterministic` is true (same board ⇒ same plan). 409 `ABSENCE_RESOLVE_NO_ORPHANED_JOBS` = nothing on the board in that range. |
| `commitAbsenceResolve` | `POST /v1/job-requests/absence/commit` | Apply the previewed plan atomically: pass `assignments[]` copied from `preview.resolved[]` (`job_id`, `to_technician_id`, `status_version`) — rows may be DROPPED, never added or re-pointed (commit VERIFIES, it does not solve). All assignments land in one transaction or none; each job's attention flag is cleared and its `status_version` bumped (the response echoes the post-commit value). Requires a time-off record covering the absence — approved, or pending and CONTAINED in the range (the commit approves those; a pending record WIDER than the range is never approved and is listed in `data.pending_wider_time_off_ids[]`); otherwise 409 `ABSENCE_RESOLVE_TIME_OFF_REQUIRED` with `data.uncovered_dates[]`/`data.uncovered_jobs[]` — record the sick day with `createTechnicianTimeOff` (pending is enough), then commit again. 409 `ABSENCE_RESOLVE_PLAN_DRIFTED` (`data.drifted[].reason` ∈ `version` \| `infeasible` \| `occupied`) means the board moved and no job was written — re-preview, then commit. Per-job `notification` evidence says what the customer routing WILL do (`dispatched` + channels, or `skipped` + reason), never proof of delivery. A restricted key needs `job_manage` for both tools and `schedule_manage` for commit. Supports `idempotency_key`. |

## Webhooks — subscribe / unsubscribe (REST-hook triggers)

| Tool | REST operation | Description |
|---|---|---|
| `listWebhookEventTypes` | `GET /v1/webhooks/event-types` | The catalog of subscribable event types (`resource.action`, e.g. `job_request.completed`, `customer.created`). Extend-only: a published type is never renamed or removed. |
| `createWebhookEndpoint` | `POST /v1/webhooks` | Subscribe an HTTPS URL. Crisphive sends a signed `ping` at once: a 2xx creates it `active`, anything else `pending_verification` (receives nothing — delete and create again). The signing `secret` (`whsec_…`) is returned ONCE; verify `Crisphive-Signature` (HMAC-SHA256, `t=…,v1=…`, accept if ANY `v1` matches). `expires_in_days` 1–365 (default 30). `event_types` may only name events the calling credential can READ (`customer.*` needs `customers_view`, `technician.*` `team_view`, `job_request.*` `job_view`) — otherwise `403 WEBHOOK_EVENT_NOT_PERMITTED` with `data.event_types` + `data.required_permissions`; empty = every event it may read. Supports `idempotency_key`. Added 2026-09-28. |
| `deleteWebhookEndpoint` | `DELETE /v1/webhooks/{id}` | Unsubscribe: no further events or pending retries are delivered. Scoped to the credential's environment — a sandbox key cannot delete a live endpoint. Added 2026-09-28. |

List, update, verify, test, secret rotation and delivery history stay on the dashboard. An endpoint created through the API is **disabled** automatically when the API key that created it is revoked, when the connected app is disconnected, or when the member whose app created it leaves or is suspended (`disabled_reason` says which); re-enabling is the dashboard's Verify button. The business Owner and Administrators are emailed the first time an app or key subscribes a webhook.

## Catalog — reference reads (discover the IDs used by the writes above)

| Tool | REST operation | Description |
|---|---|---|
| `listJobTypes` | `GET /v1/job-types` | The business's service catalog — offerings like installation, repair, maintenance, inspection (for `job_type_id`). Each type may carry a default quote bundle (`default_duration_minutes` + optional mobilization/demobilization); `is_default` marks the business's default type ("General"), used when a booking names no type. |
| `getJobType` | `GET /v1/job-types/{id}` | Get one service-catalog entry (job/work-order type) with localized display name. |
| `listSkills` | `GET /v1/skills` | Flat list of technician skills / qualifications — the vocabulary of skill-based dispatch (primary discovery call for `skill_ids`). |
| `listSkillCategories` | `GET /v1/skill-categories` | Skill categories — qualifications grouped by trade/specialty (HVAC, plumbing, electrical, …). |
| `listSkillsByCategory` | `GET /v1/skill-categories/{id}/skills` | Skills within one trade/specialty category, with per-skill technician counts. |
| `listServiceAreas` | `GET /v1/service-areas` | Geographic coverage: service territories / coverage zones (for `service_area_id` on customers). |
| `getServiceArea` | `GET /v1/service-areas/{id}` | Get one service territory (coverage zone). |

## Catalog management — create, update & delete (import sync)

Mint the reference data the writes above link to. Deliberately create + delete
ONLY — there is no update tool on any of these yet (the underlying updates are
full-replace; a partial-update rework comes first), so to change one, delete
and recreate it or use the dashboard. Typical import order: service areas →
skill categories → skills → vehicles → job types → technicians → customers →
job requests. None of these writes fires a webhook event.

| Tool | REST operation | Description |
|---|---|---|
| `createJobType` | `POST /v1/job-types` | Add a kind of work customers can book ("Annual boiler service"). `name` is the only required field and must be unique (`JOB_TYPE_DUPLICATE`); `status` defaults to active — an inactive type stays in the catalog but cannot be chosen for new bookings, so prefer that over deleting a type you may revive. Job types classify bookings and are NOT linked to skill matching; a job keeps the type's name as it was at booking time. Supports `idempotency_key`. |
| `updateJobType` | `PUT /v1/job-types/{id}` | Rename a job type or flip active/inactive. PARTIAL — omit a field to keep it; `name` rejects `""`. A rename applies to NEW bookings only (existing jobs keep the name they were booked with). Platform-shipped rows (`is_system=true`, e.g. "General") are refused with `JOB_TYPE_SYSTEM_READ_ONLY`. Added 2026-09-04. |
| `deleteJobType` | `DELETE /v1/job-types/{id}` | Soft-delete a catalog entry: gone from the catalog, unselectable for new bookings; jobs already booked against it are unaffected. Prefer `updateJobType` with `status=inactive` (same effect on the booking form, reversible). System rows refused with `JOB_TYPE_SYSTEM_READ_ONLY`. Destructive — clients confirm. |
| `createSkillCategory` | `POST /v1/skill-categories` | Add a trade/specialty category (name + optional icon). Supports `idempotency_key`. |
| `deleteSkillCategory` | `DELETE /v1/skill-categories/{id}` | Remove a category (destructive). |
| `createSkill` | `POST /v1/skill-categories/{id}/skills` | Add a skill under its category — a skill always lives under a category. Supports `idempotency_key`. |
| `updateSkill` | `PUT /v1/skills/{id}` | Rename / re-describe a skill or toggle `is_active`. PARTIAL — omit a field to keep it. Added 2026-09-04. |
| `deleteSkill` | `DELETE /v1/skills/{id}` | Remove a skill (destructive). |
| `createServiceArea` | `POST /v1/service-areas` | Define a territory the business serves — a HARD filter on who can take a job: a technician assigned to no area covering the job's address is never offered by `listNearbyTechnicians` / `listMatchingSlots` / `listCrewCandidates` and never auto-assigned, whatever their skills say. Optional GeoJSON `boundary` polygon (`[lng, lat]` rings); without one the area still matches by postal code / city / district. Assign technicians with `replaceTechnicianServiceAreas`. Supports `idempotency_key`. |
| `updateServiceArea` | `PUT /v1/service-areas/{id}` | Edit a territory in place, keeping its id and every assigned technician. PARTIAL — omit a field to keep it, `""` clears optional text, `name` rejects `""`; omit `boundary` to KEEP the polygon, send one to REPLACE it outright (a polygon cannot be removed once set). Changes apply to every NEW matching decision; jobs already assigned are not re-evaluated — re-check `listCrewCandidates` on upcoming jobs near a moved edge. Added 2026-09-04. |
| `deleteServiceArea` | `DELETE /v1/service-areas/{id}` | Soft-delete a territory: it stops counting for coverage immediately, so technicians whose only coverage was this area become unmatchable for addresses inside it (assigned jobs keep their technician; any re-plan can find no crew). To reshape coverage use `updateServiceArea` instead. Destructive — clients confirm. |

## Team & fleet — reads

| Tool | REST operation | Description |
|---|---|---|
| `listTechnicians` | `GET /v1/technicians` | The field workforce roster: technicians with status, assignment tier, skills and crew relations (for `preferred_technician_id`). |
| `getTechnician` | `GET /v1/technicians/{id}` | One technician's dispatch-ready profile: status, tier, qualifications, crew relations, vehicles. |
| `listVehicles` | `GET /v1/vehicles` | The service fleet: vans/trucks with operational status (idle, on job, maintenance). |
| `getVehicle` | `GET /v1/vehicles/{id}` | Get one fleet vehicle and which technicians use it. |
| `createVehicle` | `POST /v1/vehicles` | Add a fleet vehicle (only `name` required; names and plate numbers unique — `VEHICLE_DUPLICATE_NAME` / `VEHICLE_DUPLICATE_PLATE`). Vehicles are what a confirmed job's crew travels in: at confirm Crisphive auto-selects ONE vehicle for the whole crew from the lead's vehicles, then unowned fleet vehicles, and blocks one already booked for an overlapping job; the matching engine itself never reads vehicles. `owner_id` (who CLAIMED it) must be a lead technician or management profile (`VEHICLE_OWNER_TIER_NOT_ALLOWED`). Which vehicles a technician may USE is `replaceTechnicianVehicles`. Supports `idempotency_key`. Added 2026-09-03. |
| `updateVehicle` | `PUT /v1/vehicles/{id}` | Edit a fleet record in place. PARTIAL — omit a field to keep it, `""` clears optional text (brand, model, plate_number); `name` rejects `""`, `vehicle_type` (van/truck/car) and `status` (inactive/idle/on_job/maintenance) must be valid when present. `owner_id`: omit to keep, `""` to unclaim, UUID to reassign (lead/management only). Set `status=maintenance` for a van in the workshop rather than deleting it. Added 2026-09-04. |
| `deleteVehicle` | `DELETE /v1/vehicles/{id}` | Retire a vehicle for good: soft-deleted and removed from every technician's vehicle list in the same transaction; jobs that referenced it no longer display a vehicle and upcoming jobs get NO automatic replacement. For a temporary outage use `updateVehicle` with `status=maintenance`. Destructive — clients confirm. |

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
| `createTechnician` | `POST /v1/technicians` | Add a team member. Requires `business_group_id` (the role group's ID, from the business dashboard — Settings → Permissions) and at least one of `phone`/`email`. Optional `assignment_tier` (lead/buddy/float), day-start location, inline `buddy_ids`/`lead_ids`/`service_area_ids`. Supports `idempotency_key`. |
| `updateTechnician` | `PUT /v1/technicians/{id}` | Full-replace profile update (send every field; relations have their own tools). |
| `deleteTechnician` | `DELETE /v1/technicians/{id}` | Close the membership: profile set deactive + soft-deleted, access ends on their next request; removed from every buddy list, owned vehicles released, their calendar connection for this business revoked; fires `technician.deleted`. Their user identity and memberships at OTHER businesses are untouched. Removal does NOT move their work — re-staff upcoming jobs FIRST (`listCrewCandidates` per job, or `previewAbsenceResolve` / `commitAbsenceResolve` with a covering `createTechnicianTimeOff` record). Re-adding the same person later opens a FRESH membership with a new id and no links — suspend from the dashboard instead if you expect them back. Last active Owner refused (`TECHNICIAN_LAST_OWNER`); their API keys are NOT revoked (Owners/Admins are emailed the list). |
| `replaceTechnicianBuddies` | `PUT /v1/technicians/{id}/buddies` | Set a lead's buddy list (self-buddy rejected). |
| `replaceTechnicianLeads` | `PUT /v1/technicians/{id}/leads` | Same relation from the buddy's side: which leads this technician assists. |
| `replaceTechnicianVehicles` | `PUT /v1/technicians/{id}/vehicles` | Set the vehicles the technician uses (discover via `listVehicles`). |
| `createTechnicianTimeOff` | `POST /v1/technician-time-off` | Record a time-off block (sick day, leave) for a technician: `technician_id`, `start_datetime`/`end_datetime` as RFC3339 INSTANTS with offset (a whole Toronto day off in June is `T04:00:00Z` to the next day's `T04:00:00Z`), optional `reason`. Lands PENDING — a pending block does not remove the technician from scheduling until approved on the dashboard, EXCEPT that `commitAbsenceResolve` approves the pending record covering the absence it resolves. Overlap with the technician's existing record → 409 `TIME_OFF_OVERLAP` (call `listTechnicianTimeOff` first). Needs `schedule_manage`. Supports `idempotency_key`. Added 2026-09-17. |
| `listTechnicianTimeOff` | `GET /v1/technicians/{id}/time-off` | One technician's time-off records (pending / approved / rejected / cancelled), paginated, optional `start_date`/`end_date` (YYYY-MM-DD) and `status` filters, plus the `since`/`next_since` sync cursor. Approve, reject, cancel, edit and delete of time off stay dashboard-only — these two are the whole exposed subset. Needs `schedule_view`. Added 2026-09-17. |
| `replaceTechnicianServiceAreas` | `PUT /v1/technicians/{id}/service-areas` | Set the technician's service-area assignments (discover via `listServiceAreas`). |
| `replaceTechnicianSkills` | `PATCH /v1/technicians/{id}/skills` | Set the technician's skill set (discover via `listSkills`). |
| `listTechnicianSkills` | `GET /v1/technicians/{id}/skills` | Read a technician's assigned skills (paginated). |

Suspension/status changes and role-group AUTHORING stay dashboard-only.
Owner/Administrator group assignment is rejected for API keys
(`TECHNICIAN_ROLE_API_KEY_FORBIDDEN`). An API key is also held to its
CREATOR's current role, exactly like their own dashboard session: assigning a
group above it answers `TECHNICIAN_GROUP_NOT_ASSIGNABLE`, editing someone
above it `TECHNICIAN_TARGET_NOT_MANAGEABLE`, and a key whose creator has left
or been suspended `API_KEY_CREATOR_INACTIVE`. The last active Owner cannot be
removed or demoted (`TECHNICIAN_LAST_OWNER`). Sandbox caveat: a chsk_test_
create still resolves the REAL person identity for the given phone/email —
use throwaway addresses when experimenting.

---

## Argument conventions

- Path params, query params and request-body fields are **flattened into one
  arguments object** per tool.
- Header inputs become snake_case arguments: `idempotency_key`
  (create tools → `Idempotency-Key`), `x_timezone` (→ `X-Timezone`).
- All IDs are UUIDs; timestamps are RFC3339 UTC; times-of-day are integer
  minutes since midnight (0–1440), never `"HH:MM"`.
- **Scheduling datetimes are BUSINESS-LOCAL wall clocks** (`scheduled_at` on
  `confirmJobRequest`, `start_at` on the move and emergency tools,
  `sla_deadline` on create/priority): canonical `2026-09-23T09:00:00`;
  seconds may be omitted and a space may replace the `T`. An offset is
  accepted only when it AGREES with the business timezone; a disagreeing one
  (typically a `Z`) is refused with `400 JOB_REQUEST_INVALID_INPUT` whose `data`
  carries `business_timezone`, `expected_format` and `means_locally` — fix and
  resend once. Time-off tools are the exception: `start_datetime`/`end_datetime`
  are RFC3339 INSTANTS with offset.
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
