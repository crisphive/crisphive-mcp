# CrispHive MCP

The official MCP (Model Context Protocol) server for the
[CrispHive API](https://docs.crisphive.com/) — **field service management for
AI agents**.

Lets AI agents — Claude, ChatGPT, Gemini, Cursor or any MCP client — run a
field-service business's front office: **job booking & appointment
scheduling**, **work-order tracking**, real-time availability from a live
**dispatch & scheduling engine**, **customer (CRM) sync**, service catalogs,
**technician & crew rosters**, geographic **service territories** and **fleet**
— for trades and home services such as HVAC, plumbing, electrical, cleaning,
appliance repair and property maintenance. Hosted remote server; nothing to
install or run (this repository holds the documentation and registry manifest).

```
https://api.crisphive.com/mcp
```

## Requirements

Any MCP client that supports remote servers over Streamable HTTP —
claude.ai, Claude Desktop, Claude Code, ChatGPT, Gemini CLI, Cursor, VS Code,
Windsurf, Cline, Zed, LM Studio, ….

## Installation

### claude.ai / Claude Desktop (OAuth — no key needed)

**Settings → Connectors → Add custom connector**, paste
`https://api.crisphive.com/mcp`. Sign in as the CrispHive business owner when
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

## Authentication

Every request is authenticated with a secret API key sent as a bearer token.
Create keys from your CrispHive business dashboard. **The key prefix selects the
data environment:**

- `chsk_live_…` → live (production) data
- `chsk_test_…` → sandbox (isolated test) data

Load keys from the environment — never commit them.

The MCP endpoint additionally supports **OAuth 2.1** for end-user connectors
(claude.ai, ChatGPT, …): the business owner authorizes your agent on a consent
screen and no key is ever handled. A compliant MCP client runs the whole flow
automatically — discovery, dynamic client registration, authorization code +
PKCE. Full flow, scopes and token lifetimes:
[docs/integration.md](docs/integration.md).

## Tools

22 tools, one per operation of the public `/v1` API — same names as the SDK
methods (`listCustomers`, `createJobRequest`, …), derived from the same OpenAPI
spec so REST and MCP never drift. Full reference:
[docs/tools.md](docs/tools.md).

| Group | Tools |
|---|---|
| **Customers** (CRM sync, full CRUD) | `listCustomers` · `createCustomer` · `getCustomer` · `updateCustomer` · `deleteCustomer` |
| **Bookings** (create & track) | `createJobRequest` · `listJobRequests` · `getJobRequest` · `getJobRequestTimeline` · `listJobRequestBookingWindows` · `listJobRequestChanges` |
| **Catalog** (read-only) | `listJobTypes` · `getJobType` · `listSkills` · `listSkillCategories` · `listSkillsByCategory` · `listServiceAreas` · `getServiceArea` |
| **Team & fleet** (read-only) | `listTechnicians` · `getTechnician` · `listVehicles` · `getVehicle` |

Typical agent flow:

```
listSkills / listJobTypes                → discover reference IDs
createCustomer                           → { customer_id }
listJobRequestBookingWindows             → offer only the returned windows
createJobRequest                         → booking created
getJobRequest / listJobRequestChanges    → track status
```

## Pagination

List tools accept `page` / `limit` and return a `meta` object (`total`,
`count`, `per_page`, `current_page`, `total_pages`).

## Idempotency

Create tools (`createCustomer`, `createJobRequest`) accept an
`idempotency_key` argument so retries never create a duplicate — pass the same
value when retrying.

## Errors

Every tool returns the CrispHive response envelope (as text and as
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

## License

[MIT](LICENSE)
