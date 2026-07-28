#!/usr/bin/env node
// Generates src/tools.generated.json from the Crisphive /v1 OpenAPI spec.
//
// The tool set is DERIVED from the spec — the same source of truth as the
// hosted MCP server at https://api.crisphive.com/mcp — so the local (stdio)
// server exposes the exact same tools, named by operationId, with the same
// argument flattening rules:
//   - path + query + body fields are flattened into one arguments object
//     (parameters win on a name collision with a body field)
//   - declared header parameters become snake_case arguments
//     (X-Timezone -> x_timezone)
//   - every POST tool gets a synthetic optional `idempotency_key` argument,
//     forwarded as the Idempotency-Key header
//
// Usage:
//   node scripts/generate.mjs [spec-path-or-url]
// Default spec source: https://api.crisphive.com/developers/openapi.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SPEC_URL = "https://api.crisphive.com/developers/openapi.json";
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "tools.generated.json");

const IDEMPOTENCY_ARG = "idempotency_key";
const METHODS = ["get", "post", "put", "patch", "delete"];

async function loadSpec(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`fetch ${src}: HTTP ${res.status}`);
    return await res.json();
  }
  return JSON.parse(readFileSync(src, "utf8"));
}

// resolveRefs deep-copies a schema, inlining every $ref so each tool's
// inputSchema is fully self-contained (MCP clients receive no components map).
function resolveRefs(schema, spec, seen = new Set()) {
  if (schema == null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((s) => resolveRefs(s, spec, seen));
  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (seen.has(ref)) return { type: "object", description: `(recursive: ${ref})` };
    const parts = ref.replace(/^#\//, "").split("/");
    let node = spec;
    for (const p of parts) node = node?.[p];
    if (node == null) throw new Error(`unresolvable $ref: ${ref}`);
    const nextSeen = new Set(seen);
    nextSeen.add(ref);
    return resolveRefs(node, spec, nextSeen);
  }
  const out = {};
  for (const [k, v] of Object.entries(schema)) out[k] = resolveRefs(v, spec, seen);
  return out;
}

function headerArgName(header) {
  return header.toLowerCase().replaceAll("-", "_");
}

function buildTool(path, method, op, sharedParams, spec) {
  if (!op.operationId) throw new Error(`missing operationId on ${method.toUpperCase()} ${path}`);
  const props = {};
  const required = [];
  const pathParams = [];
  const queryParams = [];
  const headerParams = [];
  const bodyParams = [];

  const params = [...(sharedParams ?? []), ...(op.parameters ?? [])];
  for (const raw of params) {
    const p = resolveRefs(raw, spec);
    const schema = p.schema ? resolveRefs(p.schema, spec) : { type: "string" };
    if (p.description && !schema.description) schema.description = p.description;
    switch (p.in) {
      case "path":
        pathParams.push(p.name);
        props[p.name] = schema;
        required.push(p.name);
        break;
      case "query":
        queryParams.push(p.name);
        props[p.name] = schema;
        if (p.required) required.push(p.name);
        break;
      case "header": {
        const arg = headerArgName(p.name);
        headerParams.push({ arg, header: p.name });
        schema.description = p.description
          ? `${p.description} (sent as the ${p.name} header)`
          : `Sent as the ${p.name} header.`;
        props[arg] = schema;
        if (p.required) required.push(arg);
        break;
      }
    }
  }

  const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
  if (bodySchema) {
    const body = resolveRefs(bodySchema, spec);
    for (const [name, propSchema] of Object.entries(body.properties ?? {})) {
      if (name in props) continue; // parameter wins on collision
      props[name] = propSchema;
      bodyParams.push(name);
      if ((body.required ?? []).includes(name)) required.push(name);
    }
  }

  if (method === "post" && !(IDEMPOTENCY_ARG in props)) {
    props[IDEMPOTENCY_ARG] = {
      type: "string",
      description:
        "Optional idempotency key (forwarded as the Idempotency-Key header). Reuse the same value when retrying so the operation runs at most once.",
    };
  }

  const inputSchema = { type: "object", properties: props };
  if (required.length > 0) inputSchema.required = [...new Set(required)];

  let description = op.summary ?? op.operationId;
  if (op.description && op.description !== op.summary) description += `\n\n${op.description}`;

  return {
    name: op.operationId,
    title: op.summary ?? op.operationId,
    description,
    method: method.toUpperCase(),
    path,
    pathParams,
    queryParams,
    headerParams,
    bodyParams,
    inputSchema,
  };
}

const spec = await loadSpec(process.argv[2] ?? DEFAULT_SPEC_URL);
const tools = [];
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const method of METHODS) {
    if (!item[method]) continue;
    tools.push(buildTool(path, method, item[method], item.parameters, spec));
  }
}
tools.sort((a, b) => a.name.localeCompare(b.name));

const names = new Set(tools.map((t) => t.name));
if (names.size !== tools.length) throw new Error("duplicate operationIds in spec");

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify({ basePath: "/v1", tools }, null, 2) + "\n");
console.log(`wrote ${tools.length} tools -> ${OUT_PATH}`);
