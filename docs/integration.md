# CrispHive MCP — Client Integration Guide

> Reference for anyone building or configuring an MCP client against the
> CrispHive MCP server. Covers both authentication paths (API key and OAuth
> 2.1), the tool model, request/response conventions, and the exact discovery +
> OAuth flow a connector performs.

---

## 1. Endpoint

| | |
|---|---|
| **URL** | `https://api.crisphive.com/mcp` |
| **Transport** | MCP **Streamable HTTP**, stateless — plain `application/json` responses, no SSE, no session id |
| **Method** | `POST` one JSON-RPC 2.0 message (or a batch of ≤ 20) per request. `GET /mcp` → `405` (no server-push stream) |
| **Capabilities** | `tools` only (no resources/prompts) |
| **Protocol revisions** | `2025-06-18`, `2025-03-26`, `2024-11-05` |

Every tool is one `/v1` REST operation, named by its `operationId`
(`listCustomers`, `createCustomer`, `createJobRequest`,
`listJobRequestBookingWindows`, `getJobRequestTimeline`, `listSkills`, …). The
tool set is derived from the same OpenAPI spec as the REST reference at
`https://api.crisphive.com/developers/openapi.json`, so REST and MCP never
drift.

---

## 2. Authentication — two paths

The MCP endpoint accepts **either** credential on the `Authorization: Bearer`
header. A client picks one:

### 2a. API key (server-to-server — you run the agent)

Send the same secret Developer API key used for `/v1`:

```
Authorization: Bearer chsk_live_…      # live data
Authorization: Bearer chsk_test_…      # sandbox data (isolated test mode)
```

The **key prefix decides the environment** — a `chsk_test_` key can only ever
touch sandbox rows. Keep the key server-side; never embed a `chsk_` key in a
client-side app.

**Claude Code:**
```bash
claude mcp add --transport http crisphive https://api.crisphive.com/mcp \
  --header "Authorization: Bearer chsk_test_YOUR_KEY"
```

**Generic MCP client config (Cursor, etc.):**
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

### 2b. OAuth 2.1 (end-user connectors — no key handling)

For products where a CrispHive business authorizes your agent without copying a
key (a claude.ai / ChatGPT connector, or any OAuth-capable MCP client), the
`/mcp` endpoint is also a **full OAuth 2.1 Authorization Server**. A compliant
MCP client performs the whole flow automatically — you write no OAuth code. The
sections below document it for client authors and for debugging.

---

## 3. The OAuth 2.1 flow (spec)

**Standards:** OAuth 2.1 Authorization Code + **PKCE `S256` (mandatory)**;
Dynamic Client Registration (RFC 7591); AS metadata (RFC 8414);
protected-resource metadata (RFC 9728). Public clients only — **no client
secret** (PKCE is the proof of possession). `plain` and `none` challenge
methods are rejected.

### Trigger

An unauthenticated (or bad-token) call to `/mcp` returns:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://api.crisphive.com/.well-known/oauth-protected-resource"
```

The client follows `resource_metadata` and bootstraps.

### Step 1 — discover the resource (RFC 9728)

```
GET /.well-known/oauth-protected-resource
→ { "resource": ".../mcp", "authorization_servers": ["https://api.crisphive.com"], "bearer_methods_supported": ["header"] }
```

### Step 2 — discover the AS (RFC 8414)

```
GET /.well-known/oauth-authorization-server
→ {
    "issuer": "https://api.crisphive.com",
    "authorization_endpoint": ".../oauth/authorize",
    "token_endpoint": ".../oauth/token",
    "registration_endpoint": ".../oauth/register",
    "response_types_supported": ["code"],
    "grant_types_supported": ["authorization_code", "refresh_token"],
    "code_challenge_methods_supported": ["S256"],
    "token_endpoint_auth_methods_supported": ["none"]
  }
```

### Step 3 — register the client (RFC 7591 DCR)

```
POST /oauth/register
Content-Type: application/json
{ "client_name": "Acme Assistant", "redirect_uris": ["https://acme.example/oauth/callback"] }

→ 201 {
    "client_id": "chmc_…",
    "client_name": "Acme Assistant",
    "redirect_uris": ["https://acme.example/oauth/callback"],
    "token_endpoint_auth_method": "none",
    "grant_types": ["authorization_code", "refresh_token"]
  }
```

`redirect_uris` must be **HTTPS**, or **loopback `http://127.0.0.1` /
`http://localhost`** (for native/CLI clients). Anything else is rejected.

### Step 4 — authorize (owner consents)

Open a browser to:

```
GET /oauth/authorize
  ?response_type=code
  &client_id=chmc_…
  &redirect_uri=https://acme.example/oauth/callback
  &code_challenge=<BASE64URL(SHA256(verifier))>
  &code_challenge_method=S256
  &scope=customers_view job_requests_view        # optional; omit for full access
  &state=<opaque-csrf-token>
```

The business owner signs in to CrispHive and approves. The AS **freezes the
business, region and environment from the owner's session** — none of these can
be influenced by a request parameter. On approval the browser is redirected:

```
302 https://acme.example/oauth/callback?code=<auth_code>&state=<same-state>
```

- `state` is echoed back verbatim — **the client MUST verify it matches** what
  it sent (CSRF / mix-up defense).
- On denial: `?error=access_denied&state=…`.
- A bad `client_id`/`redirect_uri` is shown as an error page and **never
  redirected to** (open-redirect guard).

### Step 5 — exchange the code

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id=chmc_…
&code=<auth_code>
&redirect_uri=https://acme.example/oauth/callback     # must match step 4
&code_verifier=<original-verifier>

→ 200 (Cache-Control: no-store)
  {
    "access_token": "<JWT>",
    "token_type": "Bearer",
    "expires_in": 3600,
    "refresh_token": "chmc_…",
    "scope": "customers_view job_requests_view"     # present only if scoped
  }
```

The authorization code is **single-use** (a second exchange fails) and expires
in **60 seconds**. The code is bound to `client_id` + `redirect_uri` + the PKCE
challenge — all three are verified.

### Step 6 — call /mcp

```
POST /mcp
Authorization: Bearer <access_token>
```

Identical to the API-key path from here on. Access tokens live **~1 hour**.

### Step 7 — refresh (stay connected)

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&client_id=chmc_…
&refresh_token=chmc_…

→ 200 { "access_token": "<new JWT>", "refresh_token": "<new refresh>", "expires_in": 3600 }
```

Refresh tokens are **single-use and rotate** on every refresh (~30-day
lifetime). **Reusing an already-rotated refresh token burns the entire token
family** — every token issued from that authorization is revoked, and the
client must re-authorize (step 4). This detects a stolen refresh token. Always
store only the newest refresh token returned.

### Scopes

`scope` is a space-separated list of CrispHive **permission codes** (the same
catalog as restricted API keys / dashboard permission groups, e.g.
`customers_view`, `customers_manage`, `job_requests_view`). Omitting `scope`
grants **full business access**. A scoped token gets `403` from any tool
outside its scope — enforced by the same permission layer as the REST API.

---

## 4. Tool conventions

- **Arguments** — path params, query params, and request-body fields are
  flattened into one arguments object per tool.
- **Header inputs are arguments too:**
  - `idempotency_key` on create tools (`createCustomer`, `createJobRequest`) →
    `Idempotency-Key` header. Pass the same value when retrying a create.
  - `x_timezone` where a customer timezone is needed (e.g. required on
    `listJobRequestBookingWindows`) → `X-Timezone` header (an IANA timezone).
- **Result shape** — every tool returns the standard REST envelope as a text
  block *and* as `structuredContent`:
  ```json
  { "error_code": 0, "message": "Success", "data": { … } }
  ```
  On success read `data`; on failure `error_code` is a stable string
  (`API_KEY_INVALID`, `CUSTOMER_NOT_FOUND`, …).
- **`outputSchema`** — declared per tool; typed clients can consume
  `structuredContent` without re-parsing text.
- **Behavior hints** — reads carry `readOnlyHint`; deletes carry
  `destructiveHint` (clients like Claude confirm before running them).
- **UUID validation** — a non-UUID `id` argument returns an in-band tool error,
  never a misrouted operation.
- **Rate limit** — per credential, shared with REST: **240/min**. A `429`
  envelope means back off and retry.

### Typical agent flow

```
listSkills / listJobTypes                → discover reference IDs
createCustomer                           → { customer_id }
listJobRequestBookingWindows             → offer only returned windows
createJobRequest                         → booking created
getJobRequest / listJobRequestChanges    → track status
```

---

## 5. Errors

| Condition | Response |
|---|---|
| Missing / invalid / revoked credential | HTTP `401`, `WWW-Authenticate: Bearer …` (OAuth clients bootstrap from `resource_metadata`) |
| Scope / permission denied | tool result envelope with a `403` `error_code` |
| Malformed JSON-RPC | JSON-RPC error object |
| OAuth token/code/refresh errors | RFC 6749 §5.2 body: `{ "error": "invalid_grant" \| "invalid_client" \| "invalid_scope" \| …, "error_description": "…" }` |

---

## 6. Security properties (what the client can rely on)

- Access tokens are audience-pinned to the MCP surface and are **never**
  accepted on the CrispHive dashboard/admin/customer surfaces (and vice-versa).
- A token is scoped to **one** business + region + environment, fixed at
  consent time; no request parameter can widen it.
- PKCE `S256` is mandatory; authorization codes are single-use, 60s TTL, and
  bound to client + redirect + challenge.
- Refresh tokens rotate single-use with family-burn-on-reuse.
- Tokens/codes are stored **hashed** server-side; the token endpoint sends
  `Cache-Control: no-store`.
