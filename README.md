# Crisphive MCP

[![smithery badge](https://smithery.ai/badge/crisphive/crisphive-mcp)](https://smithery.ai/servers/crisphive/crisphive-mcp)
[![glama score](https://glama.ai/mcp/servers/crisphive/crisphive-mcp/badges/score.svg)](https://glama.ai/mcp/servers/crisphive/crisphive-mcp)
[![npm](https://img.shields.io/npm/v/%40crisphive%2Fmcp)](https://www.npmjs.com/package/@crisphive/mcp)

The official MCP (Model Context Protocol) server for the
[Crisphive API](https://docs.crisphive.com/) — **agentic AI scheduling
infrastructure for field service**.

Lets AI agents — Claude, ChatGPT, Gemini, Cursor or any MCP client — match
schedules between customers and businesses and route crews to jobs by
**location, skills, and real-time availability**: **job booking & appointment
scheduling**, **work-order tracking**, availability from a live **dispatch &
scheduling engine**, **customer (CRM) sync**, service catalogs,
**technician & crew rosters**, geographic **service territories** and **fleet**
— for trades and home services such as HVAC, plumbing, electrical, cleaning,
appliance repair and property maintenance. Hosted remote server; nothing to
install or run (this repository holds the documentation and registry manifest).

```
https://api.crisphive.com/mcp
```

## Try these first

Connect (a `chsk_test_` sandbox key is enough), then paste any of these straight
into your agent:

1. **Job creation** — *"Schedule a 2-hour HVAC job at 145 Laurier Ave W
   tomorrow for Marie Tremblay, 613-555-0142."*
   (`createCustomer → listJobRequestBookingWindows → createJobRequest →
   quoteJobRequest → confirmJobRequest`)
2. **Emergency insertion** — *"Emergency plumbing job now at 99 Bank St for
   David Okafor (613-555-0198) — show me what gets rescheduled."*
   (`listEmergencyCandidates → previewEmergencyReschedule →
   commitEmergencyReschedule`)
3. **Daily outline** — *"Outline my day tomorrow and flag anything at risk."*
   (`listJobRequests → getTechnicianSchedule`)
4. **Availability discovery** — *"Find 3 hours this week for a bike ride with
   my wife without risking any jobs."*
   (`getTechnicianSchedule` → the agent reasons over the slack)

The same prompts appear on every Crisphive listing and docs page, so what you
see here is exactly the first-run experience everywhere.

→ Full overview, tool table and one-click connect: https://crisphive.com/claude

## Requirements

Any MCP client that supports remote servers over Streamable HTTP —
claude.ai, Claude Desktop, Claude Code, ChatGPT, Gemini CLI, Cursor, VS Code,
Windsurf, Cline, Zed, LM Studio, ….

## Installation

### claude.ai / Claude Desktop (OAuth — no key needed)

**Settings → Connectors → Add custom connector**, paste
`https://api.crisphive.com/mcp`. Sign in as the Crisphive business owner when
the consent screen opens. *(Custom connectors require a Claude plan that
supports them.)*

### Claude Code

```sh
# OAuth (you'll be prompted to authorize in the browser)
claude mcp add --transport http crisphive https://api.crisphive.com/mcp

# or with an API key (sandbox key shown — safe to experiment)
claude mcp add --transport http crisphive https://api.crisphive.com/mcp \
  --header "Authorization: Bearer chsk_test_YOUR_KEY"
```

### Cursor

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=crisphive&config=eyJ1cmwiOiJodHRwczovL2FwaS5jcmlzcGhpdmUuY29tL21jcCJ9)

Or add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "crisphive": { "url": "https://api.crisphive.com/mcp" }
  }
}
```

### VS Code

```sh
code --add-mcp '{"name":"crisphive","url":"https://api.crisphive.com/mcp"}'
```

### ChatGPT

**Settings → Connectors** (developer mode) → add MCP server with URL
`https://api.crisphive.com/mcp` (OAuth).

### Gemini CLI

Add to `~/.gemini/settings.json` (note: Gemini CLI uses `httpUrl` for
Streamable HTTP servers):

```json
{
  "mcpServers": {
    "crisphive": {
      "httpUrl": "https://api.crisphive.com/mcp",
      "headers": { "Authorization": "Bearer chsk_test_YOUR_KEY" }
    }
  }
}
```

### Other MCP clients (Windsurf, Cline, Zed, LM Studio, …)

Most clients accept the standard remote-server shape:

```json
{
  "mcpServers": {
    "crisphive": {
      "url": "https://api.crisphive.com/mcp",
      "headers": { "Authorization": "Bearer chsk_test_YOUR_KEY" }
    }
  }
}
```

Only the URL field name varies in a few clients:

| Client | Config file | URL field |
|---|---|---|
| Cline / Roo Code | `cline_mcp_settings.json` | `url` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `serverUrl` |
| Gemini CLI | `~/.gemini/settings.json` | `httpUrl` |
| Zed | `settings.json` → `context_servers` | `url` |

Clients that only speak stdio can bridge with
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "crisphive": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://api.crisphive.com/mcp"]
    }
  }
}
```

### Local server (npm — `@crisphive/mcp`)

This repository also ships a thin **local stdio server**: the same 53 tools
(same names, same schemas — generated from the same `/v1` OpenAPI spec as the
hosted endpoint), where each call is an HTTPS request to the Crisphive API
with your key. No business logic runs locally.

```json
{
  "mcpServers": {
    "crisphive": {
      "command": "npx",
      "args": ["-y", "@crisphive/mcp"],
      "env": { "CRISPHIVE_API_KEY": "chsk_test_YOUR_KEY" }
    }
  }
}
```

Environment variables:

| Variable | Required | Meaning |
|---|---|---|
| `CRISPHIVE_API_KEY` | for tool calls | `chsk_live_…` = production data, `chsk_test_…` = isolated sandbox. Create keys in the dashboard (Developers → API keys). |
| `CRISPHIVE_BASE_URL` | no | API origin override (default `https://api.crisphive.com`). |

Prefer the **hosted remote server** (`https://api.crisphive.com/mcp`) when your
client supports it — OAuth, no key handling, always current. The local package
exists for stdio-only clients and self-hosted setups.

Developing in this repo: `npm ci && npm test`. The tool registry
(`src/tools.generated.json`) is generated — `npm run generate` refreshes it
from the live spec; CI fails if it drifts from `/v1`.

## Authentication

Every request is authenticated with a secret API key sent as a bearer token.
Create keys from your Crisphive business dashboard. **The key prefix selects the
data environment:**

- `chsk_live_…` → live (production) data
- `chsk_test_…` → sandbox (isolated test) data

Load keys from the environment — never commit them.

**Keys expire.** The lifetime is chosen when the key is created — 30 days by
default, up to 365 — and is fixed for that key's life; it cannot be extended
later. To renew, create a *second* key, point your agent at it, then revoke the
first: a business can hold several active keys at once, so the changeover has
no downtime and needs no special endpoint (the same procedure AWS documents for
access keys). Read `expires_at` from the dashboard or the key API and schedule
the swap. An aged-out key fails with `API_KEY_EXPIRED`, distinct from
`API_KEY_INVALID`, so you can alert on a missed renewal separately from a
revocation.

Crisphive emails the business's owners 7 days before a key expires (14 days for
an OAuth connection), so an expiry should not be a surprise — but the mail goes
to the business, not necessarily to you, so track `expires_at` yourself. A key
deliberately created for less than 7 days gets no advance notice; it would have
arrived at creation.

The MCP endpoint additionally supports **OAuth 2.1** for end-user connectors
(claude.ai, ChatGPT, …): the business owner authorizes your agent on a consent
screen and no key is ever handled. A compliant MCP client runs the whole flow
automatically — discovery, dynamic client registration, authorization code +
PKCE. Full flow, scopes and token lifetimes:
[docs/integration.md](docs/integration.md).

## Tools

53 tools, one per operation of the public `/v1` API — same names as the SDK
methods (`listCustomers`, `createJobRequest`, …), derived from the same OpenAPI
spec so REST and MCP never drift. Full reference:
[docs/tools.md](docs/tools.md).

| Group | Tools |
|---|---|
| **Customers** (CRM sync, full CRUD) | `listCustomers` · `createCustomer` · `getCustomer` · `updateCustomer` · `deleteCustomer` |
| **Bookings** (create & track) | `createJobRequest` · `listJobRequests` · `getJobRequest` · `getJobRequestTimeline` · `listJobRequestBookingWindows` · `listJobRequestChanges` |
| **Catalog** (read-only) | `listJobTypes` · `getJobType` · `listSkills` · `listSkillCategories` · `listSkillsByCategory` · `listServiceAreas` · `getServiceArea` |
| **Team & fleet** (reads) | `listTechnicians` · `getTechnician` · `listVehicles` · `getVehicle` |
| **Team roster management** (HR-system sync) | `createTechnician` · `updateTechnician` · `deleteTechnician` · `replaceTechnicianBuddies` · `replaceTechnicianLeads` · `replaceTechnicianVehicles` · `replaceTechnicianServiceAreas` · `replaceTechnicianSkills` · `listTechnicianSkills` |
| **Matching & scheduling** (read-only, engine-computed) | `listMatchingSlots` · `listCrewCandidates` · `getTechnicianSchedule` · `listNearbyTechnicians` |
| **Scheduling actions** (drive the schedule) | `quoteJobRequest` · `confirmJobRequest` · `previewJobRequestMove` · `commitJobRequestMove` |
| **Priority & emergency dispatch** (P0–P3, SLA, cascade) | `updateJobPriority` · `listEmergencyCandidates` · `previewEmergencyReschedule` · `commitEmergencyReschedule` |

Typical agent flow:

```
listSkills / listJobTypes                → discover reference IDs
createCustomer                           → { customer_id }
listJobRequestBookingWindows             → offer only the returned windows
createJobRequest                         → booking created
quoteJobRequest → confirmJobRequest      → scheduled (auto or forced technician)
getJobRequest / listJobRequestChanges    → track status
```

Emergency (P0) flow:

```
createJobRequest (priority: "p0") → quoteJobRequest
listEmergencyCandidates                  → ranked techs + crew_recommendation
previewEmergencyReschedule               → what moves (or reassigns)
commitEmergencyReschedule                → inserted + auto-confirmed
```

## Pagination

List tools accept `page` / `limit` and return a `meta` object (`total`,
`count`, `per_page`, `current_page`, `total_pages`).

## Idempotency

Create/commit tools (`createCustomer`, `createTechnician`, `createJobRequest`,
`confirmJobRequest`, `commitJobRequestMove`, `commitEmergencyReschedule`)
accept an `idempotency_key` argument so retries never create a duplicate —
pass the same value when retrying.

## Errors

Every tool returns the Crisphive response envelope (as text and as
`structuredContent`): `error_code` is `0` on success, a stable string on
failure (`CUSTOMER_NOT_FOUND`, `API_KEY_INVALID`, …). Match codes, never
message strings.

## Documentation

- Docs: https://docs.crisphive.com
- MCP: https://docs.crisphive.com/mcp
- API reference: https://docs.crisphive.com/technical-reference
- Webhooks: https://docs.crisphive.com/webhook
- For AI (OpenAPI spec + assistant bootstrap): https://docs.crisphive.com/for-ai
- Client integration guide: [docs/integration.md](docs/integration.md)
- Tool reference: [docs/tools.md](docs/tools.md)

## Privacy & support

- **Privacy policy:** https://crisphive.com/privacy-policy — Crisphive processes
  the business data reachable through the API (customers, bookings, technicians,
  fleet) solely to operate the Service; it does **not** sell personal
  information. Data is retained while the account is active and shared only with
  service providers/sub-processors as necessary. An agent connected over MCP acts
  on behalf of the authorizing business and is scoped to that business's data,
  environment (live vs sandbox) and granted permissions.
- **Support:** support@crisphive.com

## License

[MIT](LICENSE)
