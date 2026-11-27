import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMcp } from "../server/mcp";

let server: Server;
let base = "";
const KEY = "testKey_0123456789abcdefXYZ";

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  mountMcp(app, "http://example.test");
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

const rpc = async (body: unknown, key = KEY) => {
  const r = await fetch(`${base}/mcp/${key}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
  return { status: r.status, json: r.status === 202 ? null : await r.json() };
};

/** A fake browser tab: answers every relayed call with a canned result. */
async function fakeTab(key: string, answer: (call: { id: string; name: string; input: Record<string, unknown> }) => object) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/bridge/${key}/events`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let hello!: () => void;
  const ready = new Promise<void>((r) => (hello = r));
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (ev === "hello") hello();
          if (ev === "call" && data) {
            const call = JSON.parse(data);
            await fetch(`${base}/api/bridge/${key}/result`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: call.id, ...answer(call) }) });
          }
        }
      }
    } catch {
      /* aborted */
    }
  })();
  await ready;
  return () => ctrl.abort();
}

describe("MCP server", () => {
  it("initializes and lists the tools", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(init.json.result.protocolVersion).toBe("2025-06-18");
    expect(init.json.result.capabilities.tools).toBeTruthy();
    expect(init.json.result.instructions).toMatch(/write_ladder/);
    const odd = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(odd.json.result.protocolVersion).toBe("2025-11-25");
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const tools = list.json.result.tools as { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[];
    const names = tools.map((t) => t.name);
    for (const n of ["get_circuit", "add_part", "wire", "write_ladder", "operate", "observe", "screenshot", "set_mode"]) expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect(tools.find((t) => t.name === "get_circuit")!.annotations.readOnlyHint).toBe(true);
    const unknown = await rpc({ jsonrpc: "2.0", id: 4, method: "nope" });
    expect(unknown.json.error.code).toBe(-32601);
  });

  it("explains how to connect when no tab is linked", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_circuit", arguments: {} } }, "nobodyHasThisKey_123456789");
    expect(r.json.result.isError).toBe(true);
    expect(r.json.result.content[0].text).toMatch(/Claude link/);
    const bad = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "rm_rf", arguments: {} } });
    expect(bad.json.error.code).toBe(-32602);
  });

  it("relays calls to the linked tab and returns its result and image", async () => {
    const seen: string[] = [];
    const stop = await fakeTab(KEY, (call) => {
      seen.push(call.name);
      if (call.name === "screenshot") return { ok: true, result: { ok: true }, summary: "Screenshot", image: { data: "iVBORw0KGgo=", mimeType: "image/png" } };
      if (call.name === "wire") return { ok: false, result: { ok: false, error: "no terminal" }, summary: "wire failed" };
      return { ok: true, result: { echo: call.input }, summary: `ran ${call.name}` };
    });
    const st = await (await fetch(`${base}/api/bridge/${KEY}/status`)).json();
    expect(st.linked).toBe(true);
    const a = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "add_part", arguments: { type: "led" } } });
    expect(a.json.result.isError).toBe(false);
    expect(a.json.result.content[0].text).toBe('ran add_part\n{"echo":{"type":"led"}}');
    const s = await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "screenshot", arguments: {} } });
    expect(s.json.result.content[0]).toEqual({ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });
    const w = await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "wire", arguments: { from: "X0", to: "S1.9" } } });
    expect(w.json.result.isError).toBe(true);
    // batches work too
    const batch = await rpc([
      { jsonrpc: "2.0", id: 10, method: "ping" },
      { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "get_circuit", arguments: {} } },
    ]);
    expect(batch.json).toHaveLength(2);
    expect(seen).toEqual(["add_part", "screenshot", "wire", "get_circuit"]);
    stop();
  });

  it("serves the key from an Authorization header and refuses a missing key", async () => {
    const stop = await fakeTab(KEY, () => ({ ok: true, result: "ok", summary: "fine" }));
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_circuit", arguments: {} } }) });
    expect((await r.json()).result.content[0].text).toBe("fine\nok");
    const none = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(none.status).toBe(404);
    const get = await fetch(`${base}/mcp/${KEY}`);
    expect(get.status).toBe(405);
    const wk = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(wk.status).toBe(404);
    stop();
  });
});
