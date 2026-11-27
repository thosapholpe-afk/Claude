/**
 * Claude link — lets Claude (claude.ai connector, Claude Code or any MCP client) work in this tab.
 * The server relays MCP tool calls over Server-Sent Events; this tab runs them on the live
 * studio and posts the result back. See server/mcp.ts.
 */
import { useStudio } from "../store";
import { executeTool, validate } from "./ai";

const KEY = "tconnect.mcpKey";
const ON = "tconnect.mcpOn";

export interface LinkLog {
  t: number;
  tool: string;
  summary: string;
  ok: boolean;
}
export type LinkStatus = "off" | "connecting" | "online" | "elsewhere" | "error";

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

function randomKey() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function linkKey(): string {
  let k = store.get(KEY);
  if (!k || !/^[A-Za-z0-9_-]{20,80}$/.test(k)) {
    k = randomKey();
    store.set(KEY, k);
  }
  return k;
}

export const connectorUrl = () => `${location.origin}/mcp/${linkKey()}`;

const setLink = (patch: Partial<ReturnType<typeof useStudio.getState>["link"]>) => useStudio.setState((s) => ({ link: { ...s.link, ...patch } }));

let es: EventSource | null = null;
let queue: Promise<void> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let keepAlive: ReturnType<typeof setInterval> | null = null;

function close() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (keepAlive) clearInterval(keepAlive);
  keepAlive = null;
  es?.close();
  es = null;
}

function open() {
  close();
  const key = linkKey();
  setLink({ on: true, status: "connecting" });
  const src = new EventSource(`/api/bridge/${key}/events`);
  es = src;
  // free hosting tiers sleep after ~15 min without incoming requests: keep the server awake while linked
  keepAlive = setInterval(() => void fetch(`/api/bridge/${key}/status`).catch(() => undefined), 4 * 60_000);
  src.addEventListener("hello", () => setLink({ status: "online" }));
  src.addEventListener("replaced", () => {
    // another tab took over this key: stop here rather than fight over it
    close();
    setLink({ status: "elsewhere" });
  });
  src.addEventListener("call", (e) => {
    let call: { id: string; name: string; input: Record<string, unknown> };
    try {
      call = JSON.parse((e as MessageEvent).data);
    } catch {
      return;
    }
    queue = queue.then(() => run(key, call)).catch(() => undefined);
  });
  src.onerror = () => {
    if (es !== src) return;
    if (src.readyState === EventSource.CLOSED) {
      // the server refused (static hosting, no API): retry slowly
      setLink({ status: "error" });
      retryTimer = setTimeout(() => useStudio.getState().link.on && open(), 15_000);
    } else setLink({ status: "connecting" });
  };
}

async function run(key: string, call: { id: string; name: string; input: Record<string, unknown> }) {
  setLink({ busy: call.name });
  let out: { ok: boolean; result: unknown; summary: string; image?: { data: string; mimeType: string } };
  try {
    if (call.name === "screenshot") out = await screenshot(call.input);
    else {
      const bad = validate(call.name, call.input ?? {});
      out = bad ? { ok: false, result: { ok: false, error: bad }, summary: `${call.name}: ${bad}` } : await executeTool(call.name, call.input ?? {});
    }
  } catch (e) {
    out = { ok: false, result: { ok: false, error: (e as Error).message }, summary: `${call.name} failed` };
  }
  const entry: LinkLog = { t: Date.now(), tool: call.name, summary: out.summary, ok: out.ok };
  useStudio.setState((s) => ({ link: { ...s.link, busy: null, last: entry, log: [...s.link.log.slice(-49), entry] } }));
  try {
    await fetch(`/api/bridge/${key}/result`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: call.id, ...out }) });
  } catch {
    /* the server will time the call out */
  }
}

export function setLinkOn(on: boolean) {
  store.set(ON, on ? "1" : "0");
  if (on) open();
  else {
    close();
    setLink({ on: false, status: "off", busy: null });
  }
}

/** A new key: the old connector URL stops working. */
export function regenerateKey() {
  store.set(KEY, randomKey());
  if (useStudio.getState().link.on) open();
}

export function initClaudeLink() {
  if (store.get(ON) === "1") open();
}

// ---------------------------------------------------------------------------
// screenshot: the canvas SVG with its computed styles inlined, drawn into a PNG
// ---------------------------------------------------------------------------
const STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "visibility",
  "display",
  "paint-order",
  "stop-color",
  "stop-opacity",
];

function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  let style = src.getAttribute("style") ?? "";
  for (const k of STYLE_PROPS) {
    let v = cs.getPropertyValue(k);
    // web fonts can't load inside an SVG image: fall back to a clean sans instead of Times
    if (k === "font-family" && v) v += ", Arial, Helvetica, sans-serif";
    if (v) style += `;${k}:${v}`;
  }
  dst.setAttribute("style", style);
  const a = src.children;
  const b = dst.children;
  for (let i = 0; i < a.length && i < b.length; i++) inlineStyles(a[i], b[i]);
}

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    // rAF stops in background tabs: fall back to a timer
    const t = setTimeout(resolve, 120 * n);
    let left = n;
    const step = () => (--left <= 0 ? (clearTimeout(t), resolve()) : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

async function svgToImage(svg: SVGSVGElement, bg: string) {
  const w = Math.max(1, svg.clientWidth);
  const h = Math.max(1, svg.clientHeight);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await img.decode();
  const scale = Math.max(1, Math.min(2, 1600 / w));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png").split(",")[1];
}

async function screenshot(input: Record<string, unknown>) {
  const st = useStudio.getState();
  const want = input.view ? String(input.view) : st.view === "2d" ? "board" : st.view === "diagram" ? "wiring" : "3d";
  const view = want === "wiring" ? "diagram" : want === "3d" ? "3d" : "2d";
  if (st.view !== view) {
    useStudio.setState({ view });
    await frames(3);
  }
  if (input.fit !== false && view !== "3d") {
    window.dispatchEvent(new Event("tconnect:fit"));
    await frames(3);
  }
  if (view === "3d") {
    // the 3D engine is loaded on demand: wait for its canvas, then for a few rendered frames
    let gl: HTMLCanvasElement | null = null;
    for (let i = 0; i < 60 && !gl; i++) {
      gl = document.querySelector(".twin3d canvas");
      if (!gl) await new Promise((r) => setTimeout(r, 200));
    }
    if (!gl) throw new Error("the 3D view did not load");
    await new Promise((r) => setTimeout(r, 1500));
    await frames(4);
    const data = gl.toDataURL("image/jpeg", 0.85).split(",")[1];
    return { ok: true, result: { ok: true, view: want, size: [gl.width, gl.height] }, summary: "Screenshot (3D)", image: { data, mimeType: "image/jpeg" } };
  }
  const svg = document.querySelector("svg.canvas") as SVGSVGElement | null;
  if (!svg) throw new Error("the canvas is not on screen");
  const wrap = svg.closest(".canvas-wrap") ?? document.body;
  const bg = getComputedStyle(wrap).backgroundColor || "#1f1f22";
  const data = await svgToImage(svg, bg && bg !== "rgba(0, 0, 0, 0)" ? bg : getComputedStyle(document.body).backgroundColor || "#1f1f22");
  return { ok: true, result: { ok: true, view: want, size: [svg.clientWidth, svg.clientHeight] }, summary: `Screenshot (${want})`, image: { data, mimeType: "image/png" } };
}
