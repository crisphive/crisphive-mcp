// Tests for the stdio server: registry sanity + a real stdio round-trip
// (initialize -> tools/list) against the built dist/index.js.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const registry = require("../src/tools.generated.json");

test("registry has 43 unique tools with object schemas", () => {
  assert.equal(registry.basePath, "/v1");
  assert.equal(registry.tools.length, 43);
  const names = new Set(registry.tools.map((t) => t.name));
  assert.equal(names.size, registry.tools.length);
  for (const t of registry.tools) {
    assert.equal(t.inputSchema.type, "object", `${t.name} inputSchema.type`);
    assert.ok(t.description.length > 0, `${t.name} description`);
    assert.match(t.method, /^(GET|POST|PUT|PATCH|DELETE)$/);
    assert.ok(t.path.startsWith("/"), `${t.name} path`);
    for (const p of t.pathParams) {
      assert.ok(t.path.includes(`{${p}}`), `${t.name} path param ${p} in template`);
    }
  }
});

test("every POST tool exposes idempotency_key", () => {
  for (const t of registry.tools.filter((t) => t.method === "POST")) {
    assert.ok(
      t.inputSchema.properties.idempotency_key,
      `${t.name} missing idempotency_key`,
    );
  }
});

test("stdio server answers initialize and tools/list", async () => {
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const responses = [];
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) responses.push(JSON.parse(line));
    }
  });

  const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
  });

  await waitFor(() => responses.some((r) => r.id === 1), 5000);
  const init = responses.find((r) => r.id === 1);
  assert.equal(init.result.serverInfo.name, "crisphive");

  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  await waitFor(() => responses.some((r) => r.id === 2), 5000);
  const list = responses.find((r) => r.id === 2);
  assert.equal(list.result.tools.length, 43);
  const listCustomers = list.result.tools.find((t) => t.name === "listCustomers");
  assert.ok(listCustomers, "listCustomers tool present");
  assert.equal(listCustomers.annotations.readOnlyHint, true);

  child.kill();
});

function waitFor(cond, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
      setTimeout(tick, 25);
    };
    tick();
  });
}
