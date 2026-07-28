#!/usr/bin/env node
// Crisphive MCP server (stdio).
//
// A thin local face of the Crisphive Developer API: every tool is one /v1
// REST operation, named by its operationId — the exact same tool set as the
// hosted MCP endpoint (https://api.crisphive.com/mcp). Each call is an HTTPS
// request to the Crisphive API authenticated with YOUR API key; no business
// logic lives in this package.
//
// Env:
//   CRISPHIVE_API_KEY   required for tool CALLS (chsk_live_... = production
//                       data, chsk_test_... = isolated sandbox). Listing
//                       tools works without it.
//   CRISPHIVE_BASE_URL  optional API origin override
//                       (default https://api.crisphive.com).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface HeaderParam {
  arg: string;
  header: string;
}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  headerParams: HeaderParam[];
  bodyParams: string[];
  inputSchema: Record<string, unknown>;
}

const registry: { basePath: string; tools: ToolDef[] } = require("./tools.generated.json");

const BASE_URL = (process.env.CRISPHIVE_BASE_URL ?? "https://api.crisphive.com").replace(/\/+$/, "");
const API_KEY = process.env.CRISPHIVE_API_KEY ?? "";
const IDEMPOTENCY_ARG = "idempotency_key";

const toolsByName = new Map(registry.tools.map((t) => [t.name, t]));

function buildRequest(tool: ToolDef, args: Record<string, unknown>) {
  let path = tool.path;
  for (const p of tool.pathParams) {
    const v = args[p];
    if (v === undefined || v === null || v === "") {
      throw new Error(`missing required path parameter: ${p}`);
    }
    path = path.replace(`{${p}}`, encodeURIComponent(String(v)));
  }

  const query = new URLSearchParams();
  for (const q of tool.queryParams) {
    const v = args[q];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) query.append(q, String(item));
    } else {
      query.append(q, String(v));
    }
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;
  const routedArgs = new Set<string>([...tool.pathParams, ...tool.queryParams]);
  for (const hp of tool.headerParams) {
    routedArgs.add(hp.arg);
    const v = args[hp.arg];
    if (v === undefined || v === null || v === "") continue;
    headers[hp.header] = String(v);
  }
  // Synthetic idempotency_key on POST tools whose spec does not declare the
  // header parameter explicitly.
  if (
    tool.method === "POST" &&
    !routedArgs.has(IDEMPOTENCY_ARG) &&
    typeof args[IDEMPOTENCY_ARG] === "string" &&
    args[IDEMPOTENCY_ARG] !== ""
  ) {
    headers["Idempotency-Key"] = String(args[IDEMPOTENCY_ARG]);
    routedArgs.add(IDEMPOTENCY_ARG);
  }

  let body: string | undefined;
  if (tool.bodyParams.length > 0) {
    const payload: Record<string, unknown> = {};
    for (const b of tool.bodyParams) {
      if (b in args && args[b] !== undefined) payload[b] = args[b];
    }
    body = JSON.stringify(payload);
    headers["Content-Type"] = "application/json";
  }

  const qs = query.toString();
  const url = `${BASE_URL}${registry.basePath}${path}${qs ? `?${qs}` : ""}`;
  return { url, headers, body };
}

const pkg: { version: string } = require("../package.json");

const server = new Server(
  { name: "crisphive", version: pkg.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: registry.tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      title: t.title,
      readOnlyHint: t.method === "GET",
      destructiveHint: t.method === "DELETE",
      idempotentHint: t.method === "PUT" || t.method === "DELETE",
    },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = toolsByName.get(req.params.name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      isError: true,
    };
  }
  if (!API_KEY) {
    return {
      content: [
        {
          type: "text",
          text:
            "CRISPHIVE_API_KEY is not set. Create an API key in the Crisphive dashboard (Developers -> API keys) and set it in the environment. chsk_test_... keys touch only isolated sandbox data.",
        },
      ],
      isError: true,
    };
  }

  let request;
  try {
    request = buildRequest(tool, (req.params.arguments ?? {}) as Record<string, unknown>);
  } catch (err) {
    return {
      content: [{ type: "text", text: (err as Error).message }],
      isError: true,
    };
  }

  try {
    const res = await fetch(request.url, {
      method: tool.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let structured: unknown;
    try {
      structured = JSON.parse(text);
    } catch {
      structured = undefined;
    }
    return {
      content: [{ type: "text", text: text || `HTTP ${res.status}` }],
      ...(structured !== undefined && typeof structured === "object"
        ? { structuredContent: structured as Record<string, unknown> }
        : {}),
      isError: res.status >= 400,
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `request failed: ${(err as Error).message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
