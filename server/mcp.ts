/**
 * Thosaphol Connect MCP server ("Claude link").
 *
 *   Claude (claude.ai connector, Claude Code, any MCP client)
 *        │  POST /mcp/<key>   — MCP Streamable HTTP, stateless JSON responses
 *        ▼
 *   this server ── SSE /api/bridge/<key>/events ──▶ the user's open browser tab
 *        ▲                                              │ runs the tool on the live canvas
 *        └──────────── POST /api/bridge/<key>/result ◀──┘
 *
 * The key is a random secret the browser makes; whoever holds the connector URL can
 * edit that tab's circuit, nothing else. Nothing is stored: links live in memory.
 */
import crypto from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { MCP_INSTRUCTIONS, MCP_TOOLS, toolTimeout } from "../src/core/mcpTools";

const KEY_RE = /^[A-Za-z0-9_-]{20,80}$/;
const PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const LATEST = PROTOCOLS[PROTOCOLS.length - 1];
const VERSION = "1.0.0";

interface BridgeResult {
  ok: boolean;
  result: unknown;
  summary?: string;
  image?: { data: string; mimeType: string };
}
interface Bridge {
  res: Response;
  since: number;
  beat: NodeJS.Timeout;
  calls: number;
}
interface Pending {
  key: string;
  bridge: Bridge;
  resolve: (r: BridgeResult) => void;
  timer: NodeJS.Timeout;
}

const bridges = new Map<string, Bridge>();
const pending = new Map<string, Pending>();

function settle(id: string, r: BridgeResult) {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(r);
  return true;
}

function callBrowser(key: string, name: string, input: Record<string, unknown>): Promise<BridgeResult> {
  const b = bridges.get(key);
  if (!b) return Promise.resolve({ ok: false, result: null, summary: "not connected" });
  const id = crypto.randomUUID();
  const ms = toolTimeout(name, input);
  b.calls++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(id, { ok: false, result: { error: `The Thosaphol Connect tab did not answer within ${Math.round(ms / 1000)} s. It may be asleep in the background — ask the user to bring it to the front.` } }), ms);
    pending.set(id, { key, bridge: b, resolve, timer });
    b.res.write(`event: call\ndata: ${JSON.stringify({ id, name, input })}\n\n`);
  });
}

const notOpen = (publicUrl: string) =>
  `The user's Thosaphol Connect tab is not linked right now. Ask them to open ${publicUrl}, open the ⋯ menu → "Claude link" and switch it on (the connector URL there must match this one), keep the tab open, then try again.`;

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

async function handleRpc(key: string, msg: Rpc, publicUrl: string): Promise<object | null> {
  const id = msg?.id;
  const isNote = id === undefined || id === null;
  const ok = (result: object) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid Request");
  const method = msg.method;
  switch (method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "thosaphol-connect", title: "Thosaphol Connect", version: VERSION, websiteUrl: publicUrl },
        instructions: MCP_INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: MCP_TOOLS });
    case "resources/list":
      return ok({ resources: [] });
    case "resources/templates/list":
      return ok({ resourceTemplates: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (!MCP_TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      if (typeof args !== "object" || Array.isArray(args)) return fail(-32602, "arguments must be an object");
      if (!bridges.has(key)) return ok({ content: [{ type: "text", text: notOpen(publicUrl) }], isError: true });
      const r = await callBrowser(key, name, args);
      if (r.summary === "not connected") return ok({ content: [{ type: "text", text: notOpen(publicUrl) }], isError: true });
      const content: object[] = [];
      if (r.image?.data) content.push({ type: "image", data: r.image.data, mimeType: r.image.mimeType || "image/png" });
      const body = typeof r.result === "string" ? r.result : JSON.stringify(r.result ?? null);
      content.push({ type: "text", text: r.summary ? `${r.summary}\n${body}` : body });
      return ok({ content, isError: !r.ok });
    }
    default:
      if (isNote || method.startsWith("notifications/")) return null;
      return fail(-32601, `Method not found: ${method}`);
  }
}

function cors(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  next();
}

function keyOf(req: Request): string | null {
  const fromPath = String(req.params.key ?? "");
  if (fromPath && KEY_RE.test(fromPath)) return fromPath;
  const auth = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (auth && KEY_RE.test(auth)) return auth;
  return null;
}

export function mountMcp(app: Express, publicUrl: string, build: string | null = null) {
  // ---------------------------------------------------------------- browser side
  app.get("/api/bridge/:key/events", (req, res) => {
    const key = req.params.key;
    if (!KEY_RE.test(key)) {
      res.status(400).json({ error: "bad key" });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
    const old = bridges.get(key);
    if (old) {
      old.res.write(`event: replaced\ndata: {}\n\n`);
      clearInterval(old.beat);
      old.res.end();
    }
    const b: Bridge = { res, since: Date.now(), calls: 0, beat: setInterval(() => res.write(`: ping\n\n`), 20_000) };
    bridges.set(key, b);
    // `build` lets a linked tab notice a new deploy and reload itself
    res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ ok: true, url: `${publicUrl}/mcp/${key}`, build })}\n\n`);
    req.on("close", () => {
      clearInterval(b.beat);
      if (bridges.get(key) === b) bridges.delete(key);
      for (const [id, p] of pending) if (p.bridge === b) settle(id, { ok: false, result: { error: "The Thosaphol Connect tab closed or lost its connection while working on this." } });
    });
  });

  app.post("/api/bridge/:key/result", (req, res) => {
    const key = req.params.key;
    const id = String(req.body?.id ?? "");
    const p = pending.get(id);
    if (!p || p.key !== key) {
      res.status(404).json({ error: "no such call (it may have timed out)" });
      return;
    }
    const img = req.body?.image as BridgeResult["image"] | undefined;
    settle(id, {
      ok: req.body?.ok !== false,
      result: req.body?.result ?? null,
      summary: typeof req.body?.summary === "string" ? req.body.summary.slice(0, 300) : undefined,
      image: img && typeof img.data === "string" ? { data: img.data, mimeType: String(img.mimeType || "image/png") } : undefined,
    });
    res.json({ ok: true });
  });

  app.get("/api/bridge/:key/status", (req, res) => {
    const b = bridges.get(req.params.key);
    res.json({ linked: !!b, since: b?.since, calls: b?.calls ?? 0 });
  });

  // ---------------------------------------------------------------- MCP side
  // This server has no OAuth: answer discovery probes with JSON 404s instead of the app's HTML.
  app.get(/^\/\.well-known\//, (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  const post = async (req: Request, res: Response) => {
    const key = keyOf(req);
    if (!key) {
      res.status(404).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Use the connector URL from Thosaphol Connect → ⋯ → Claude link (it ends in /mcp/<key>)." } });
      return;
    }
    const body = req.body as Rpc | Rpc[] | undefined;
    if (!body || (typeof body !== "object" && !Array.isArray(body))) {
      res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: send JSON-RPC as application/json" } });
      return;
    }
    const list = Array.isArray(body) ? body : [body];
    const replies = (await Promise.all(list.map((m) => handleRpc(key, m, publicUrl)))).filter(Boolean);
    if (!replies.length) {
      res.status(202).end();
      return;
    }
    res.json(Array.isArray(body) ? replies : replies[0]);
  };
  const noStream = (req: Request, res: Response) => {
    res.setHeader("Allow", "POST, OPTIONS");
    if (req.method === "GET" && req.accepts(["text/event-stream", "html"]) === "html") {
      res.status(405).type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Thosaphol Connect MCP</title><body style="font:16px system-ui;background:#1f1f22;color:#eee;padding:24px;max-width:640px;margin:auto"><h1 style="font-weight:600">Thosaphol Connect · MCP</h1><p>This address is a connector for Claude, not a web page. In Claude: <b>Settings → Connectors → Add custom connector</b>, paste this URL, then keep your Thosaphol Connect tab open with <b>⋯ → Claude link</b> switched on.</p><p><a style="color:#e6c9a8" href="${publicUrl}">Open Thosaphol Connect</a></p></body>`);
      return;
    }
    res.status(405).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "This MCP server answers POST requests only (no SSE stream)." } });
  };
  app.options(["/mcp", "/mcp/:key"], cors, (_req, res) => {
    res.status(204).end();
  });
  app.post(["/mcp", "/mcp/:key"], cors, post);
  app.get(["/mcp", "/mcp/:key"], cors, noStream);
  app.delete(["/mcp", "/mcp/:key"], cors, noStream);
}
