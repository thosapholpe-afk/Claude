/**
 * Thosaphol Connect API server
 *  - OAuth sign-in: Google, GitHub, Facebook, Instagram (server-side code flow)
 *  - Signed session cookie, JSON-file user store
 *  - Display-name onboarding, recorded to a Google Form
 *  - Claude proxy for the in-app copilot and board scanning (the browser runs the tools)
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_MODEL, AGENT_SYSTEM, AGENT_TOOLS } from "../src/core/agentTools";
import { BOARDS } from "../src/core/boards";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "http://localhost:5173").replace(/\/$/, "");
const PROD = process.env.NODE_ENV === "production";
const SECRET = process.env.SESSION_SECRET ?? crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) console.warn("[thosaphol-connect] SESSION_SECRET is not set — sessions reset when the server restarts.");

// ------------------------------------------------------------------ user store
interface StoredUser {
  id: string;
  provider: string;
  providerId: string;
  email?: string;
  providerName?: string;
  name: string;
  avatar?: string;
  role?: string;
  organization?: string;
  needsProfile: boolean;
  createdAt: string;
  lastLogin: string;
  logins: number;
}
const DATA_DIR = path.join(here, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
let users: Record<string, StoredUser> = {};
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
} catch {
  users = {};
}
const saveUsers = () => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
const publicUser = (u: StoredUser) => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar, provider: u.provider, needsProfile: u.needsProfile, role: u.role, organization: u.organization });

// ------------------------------------------------------------------ sessions
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
function sign(payload: object) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expect = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (expect.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(mac))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp?: number };
    if (data.exp && data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}
const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: PROD, path: "/" };
function currentUser(req: Request): StoredUser | null {
  const s = verify<{ uid: string }>(req.cookies?.tc_session);
  return s ? users[s.uid] ?? null : null;
}

// ------------------------------------------------------------------ Google Form logging
const FORM = {
  id: process.env.GFORM_ID,
  name: process.env.GFORM_ENTRY_NAME,
  email: process.env.GFORM_ENTRY_EMAIL,
  provider: process.env.GFORM_ENTRY_PROVIDER,
  role: process.env.GFORM_ENTRY_ROLE,
  org: process.env.GFORM_ENTRY_ORG,
  event: process.env.GFORM_ENTRY_EVENT,
  time: process.env.GFORM_ENTRY_TIME,
};
async function recordToForm(fields: { name: string; email?: string; provider: string; role?: string; org?: string; event: string }) {
  if (!FORM.id || !FORM.name) return false;
  const body = new URLSearchParams();
  const put = (entry: string | undefined, v: string | undefined) => entry && v !== undefined && body.append(`entry.${entry.replace(/^entry\./, "")}`, v);
  put(FORM.name, fields.name);
  put(FORM.email, fields.email ?? "");
  put(FORM.provider, fields.provider);
  put(FORM.role, fields.role ?? "");
  put(FORM.org, fields.org ?? "");
  put(FORM.event, fields.event);
  put(FORM.time, new Date().toISOString());
  try {
    const r = await fetch(`https://docs.google.com/forms/d/e/${FORM.id}/formResponse`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual",
    });
    if (r.status >= 400) console.warn(`[thosaphol-connect] Google Form responded ${r.status} — check GFORM_ID and entry IDs`);
    return r.status < 400;
  } catch (e) {
    console.warn("[thosaphol-connect] Google Form submit failed:", (e as Error).message);
    return false;
  }
}

// ------------------------------------------------------------------ OAuth providers
interface Profile {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
}
interface Provider {
  id: string;
  clientId?: string;
  clientSecret?: string;
  authorize: string;
  token: string;
  scope: string;
  extraAuth?: Record<string, string>;
  profile: (accessToken: string, tokenJson: Record<string, unknown>) => Promise<Profile>;
}
const getJson = async (url: string, headers: Record<string, string> = {}) => {
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "thosaphol-connect", ...headers } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
};
const PROVIDERS: Record<string, Provider> = {
  google: {
    id: "google",
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    extraAuth: { prompt: "select_account" },
    profile: async (at) => {
      const p = await getJson("https://openidconnect.googleapis.com/v1/userinfo", { Authorization: `Bearer ${at}` });
      return { id: String(p.sub), name: String(p.name ?? p.email ?? "Google user"), email: p.email as string, avatar: p.picture as string };
    },
  },
  github: {
    id: "github",
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    profile: async (at) => {
      const h = { Authorization: `Bearer ${at}` };
      const p = await getJson("https://api.github.com/user", h);
      let email = p.email as string | undefined;
      if (!email) {
        try {
          const r = await fetch("https://api.github.com/user/emails", { headers: { ...h, "User-Agent": "thosaphol-connect" } });
          const list = (await r.json()) as { email: string; primary: boolean }[];
          email = list.find((e) => e.primary)?.email;
        } catch {
          /* optional */
        }
      }
      return { id: String(p.id), name: String(p.name ?? p.login), email, avatar: p.avatar_url as string };
    },
  },
  facebook: {
    id: "facebook",
    clientId: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    authorize: "https://www.facebook.com/v21.0/dialog/oauth",
    token: "https://graph.facebook.com/v21.0/oauth/access_token",
    scope: "public_profile,email",
    profile: async (at) => {
      const p = await getJson(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(at)}`);
      const pic = (p.picture as { data?: { url?: string } } | undefined)?.data?.url;
      return { id: String(p.id), name: String(p.name ?? "Facebook user"), email: p.email as string, avatar: pic };
    },
  },
  instagram: {
    // Instagram API with Instagram Login (professional accounts). Basic Display was retired in Dec 2024.
    id: "instagram",
    clientId: process.env.INSTAGRAM_APP_ID,
    clientSecret: process.env.INSTAGRAM_APP_SECRET,
    authorize: "https://www.instagram.com/oauth/authorize",
    token: "https://api.instagram.com/oauth/access_token",
    scope: "instagram_business_basic",
    profile: async (at, tok) => {
      const p = await getJson(`https://graph.instagram.com/v21.0/me?fields=user_id,username,name,profile_picture_url&access_token=${encodeURIComponent(at)}`);
      return { id: String(p.user_id ?? p.id ?? tok.user_id), name: String(p.name || p.username || "Instagram user"), avatar: p.profile_picture_url as string };
    },
  },
};
const enabled = (p: Provider) => !!(p.clientId && p.clientSecret);
const redirectUri = (id: string) => `${PUBLIC_URL}/auth/${id}/callback`;

// ------------------------------------------------------------------ app
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));
app.use(cookieParser());

app.get("/auth/:provider", (req, res) => {
  const p = PROVIDERS[req.params.provider];
  if (!p || !enabled(p)) {
    res.status(404).send("This sign-in provider is not configured on the server.");
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("tc_oauth", sign({ state, p: p.id, exp: Date.now() + 10 * 60_000 }), { ...cookieOpts, maxAge: 10 * 60_000 });
  const q = new URLSearchParams({ client_id: p.clientId!, redirect_uri: redirectUri(p.id), response_type: "code", scope: p.scope, state, ...(p.extraAuth ?? {}) });
  res.redirect(`${p.authorize}?${q}`);
});

app.get("/auth/:provider/callback", async (req, res) => {
  const p = PROVIDERS[req.params.provider];
  const st = verify<{ state: string; p: string }>(req.cookies?.tc_oauth);
  res.clearCookie("tc_oauth", cookieOpts);
  if (!p || !enabled(p) || !st || st.p !== p.id || st.state !== req.query.state || typeof req.query.code !== "string") {
    res.redirect(`${PUBLIC_URL}/?login=failed`);
    return;
  }
  try {
    const body = new URLSearchParams({ client_id: p.clientId!, client_secret: p.clientSecret!, code: req.query.code, redirect_uri: redirectUri(p.id), grant_type: "authorization_code" });
    const tr = await fetch(p.token, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body });
    const tok = (await tr.json()) as Record<string, unknown>;
    const at = tok.access_token as string | undefined;
    if (!at) throw new Error(`token exchange failed: ${JSON.stringify(tok).slice(0, 200)}`);
    const prof = await p.profile(at, tok);
    const id = `${p.id}:${prof.id}`;
    const now = new Date().toISOString();
    const existing = users[id];
    users[id] = existing
      ? { ...existing, email: prof.email ?? existing.email, avatar: prof.avatar ?? existing.avatar, providerName: prof.name, lastLogin: now, logins: existing.logins + 1 }
      : { id, provider: p.id, providerId: prof.id, email: prof.email, providerName: prof.name, name: prof.name, avatar: prof.avatar, needsProfile: true, createdAt: now, lastLogin: now, logins: 1 };
    saveUsers();
    if (existing && !existing.needsProfile && process.env.GFORM_LOG_LOGINS === "true") {
      void recordToForm({ name: existing.name, email: existing.email, provider: p.id, role: existing.role, org: existing.organization, event: "login" });
    }
    res.cookie("tc_session", sign({ uid: id, exp: Date.now() + 30 * 86_400_000 }), { ...cookieOpts, maxAge: 30 * 86_400_000 });
    res.redirect(`${PUBLIC_URL}/?login=ok`);
  } catch (e) {
    console.error("[thosaphol-connect] OAuth error:", (e as Error).message);
    res.redirect(`${PUBLIC_URL}/?login=failed`);
  }
});

app.post("/auth/logout", (_req, res) => {
  res.clearCookie("tc_session", cookieOpts);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const u = currentUser(req);
  res.json({
    user: u ? publicUser(u) : null,
    providers: Object.fromEntries(Object.values(PROVIDERS).map((p) => [p.id, enabled(p)])),
    guest: process.env.ALLOW_GUEST !== "false",
    formConfigured: !!(FORM.id && FORM.name),
  });
});

app.post("/api/profile", async (req, res) => {
  const u = currentUser(req);
  if (!u) {
    res.status(401).json({ error: "Sign in first" });
    return;
  }
  const name = String(req.body?.name ?? "").trim().slice(0, 40);
  if (name.length < 2) {
    res.status(400).json({ error: "Pick a name with at least 2 characters" });
    return;
  }
  const first = u.needsProfile;
  u.name = name;
  u.role = String(req.body?.role ?? "").slice(0, 30) || undefined;
  u.organization = String(req.body?.organization ?? "").slice(0, 80) || undefined;
  u.needsProfile = false;
  saveUsers();
  void recordToForm({ name, email: u.email, provider: u.provider, role: u.role, org: u.organization, event: first ? "signup" : "profile-update" });
  res.json({ user: publicUser(u) });
});

app.post("/api/profile/local", async (req, res) => {
  if (process.env.GFORM_LOG_GUESTS === "true") {
    const name = String(req.body?.name ?? "").trim().slice(0, 40) || "Guest";
    void recordToForm({ name, provider: "local", event: "guest" });
  }
  res.json({ ok: true });
});

// ------------------------------------------------------------------ AI
const aiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
const anthropic = aiKey ? new Anthropic() : null;
const hits = new Map<string, number[]>();
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = currentUser(req)?.id ?? req.ip ?? "anon";
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  const limit = Number(process.env.AI_RATE_PER_MIN ?? 40);
  if (list.length >= limit) {
    res.status(429).json({ error: "Too many AI requests — wait a minute" });
    return;
  }
  list.push(now);
  hits.set(key, list);
  next();
}
function requireAiAccess(req: Request, res: Response, next: NextFunction) {
  if (!anthropic) {
    res.status(503).json({ error: "AI is not configured (set ANTHROPIC_API_KEY on the server)" });
    return;
  }
  if (process.env.AI_REQUIRE_LOGIN === "true" && !currentUser(req)) {
    res.status(401).json({ error: "Sign in to use the copilot" });
    return;
  }
  next();
}

app.get("/api/ai/status", (_req, res) => res.json({ configured: !!anthropic, model: AGENT_MODEL }));

app.post("/api/ai/chat", requireAiAccess, rateLimit, async (req, res) => {
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: "messages[] required" });
    return;
  }
  try {
    const msg = await anthropic!.beta.messages.create({
      model: AGENT_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: AGENT_SYSTEM,
      tools: AGENT_TOOLS as Anthropic.Beta.BetaTool[],
      messages: messages as Anthropic.Beta.BetaMessageParam[],
    });
    res.json({ content: msg.content, stop_reason: msg.stop_reason, model: msg.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) res.status(429).json({ error: "Claude is rate-limited — try again shortly" });
    else if (e instanceof Anthropic.AuthenticationError) res.status(500).json({ error: "The server's Anthropic API key was rejected" });
    else if (e instanceof Anthropic.BadRequestError) res.status(400).json({ error: e.message });
    else if (e instanceof Anthropic.APIError) res.status(502).json({ error: `Claude API error ${e.status}` });
    else res.status(500).json({ error: (e as Error).message });
  }
});

const SCAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["match", "name", "confidence", "width_mm", "height_mm", "logic_v", "pins_top", "pins_bottom", "notes"],
  properties: {
    match: { type: "string", enum: [...BOARDS.map((b) => b.id), "unknown"] },
    name: { type: "string" },
    confidence: { type: "number" },
    width_mm: { type: "number" },
    height_mm: { type: "number" },
    logic_v: { type: "number" },
    pins_top: { type: "array", items: { type: "string" } },
    pins_bottom: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};

app.post("/api/ai/identify-board", requireAiAccess, rateLimit, async (req, res) => {
  const image = String(req.body?.image ?? "");
  const mediaType = String(req.body?.mediaType ?? "image/jpeg");
  if (!image || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType)) {
    res.status(400).json({ error: "Send a JPEG, PNG, WebP or GIF image" });
    return;
  }
  try {
    const msg = await anthropic!.beta.messages.create({
      model: AGENT_MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCAN_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: image } },
            {
              type: "text",
              text: `Identify this microcontroller / single-board computer from the photo.
Known boards: ${BOARDS.map((b) => `${b.id} = ${b.name} (${b.width}×${b.height} mm)`).join("; ")}.
If it is one of them, set match to its id. Otherwise set match "unknown" and describe it: name, approximate PCB size in mm, logic voltage, and the pin labels printed along the top edge (left→right) and the bottom edge (left→right) when the board is held with its USB connector on the left. Use the silkscreen text exactly (e.g. GP0, D13, 3V3, GND). Confidence is 0..1. Keep notes to one sentence.`,
            },
          ],
        },
      ],
    });
    if (msg.stop_reason === "refusal") {
      res.status(422).json({ error: "The model declined to analyse this image" });
      return;
    }
    const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    res.json(JSON.parse(text));
  } catch (e) {
    if (e instanceof Anthropic.APIError) res.status(502).json({ error: `Claude API error ${e.status}: ${e.message}` });
    else res.status(500).json({ error: (e as Error).message });
  }
});

// ------------------------------------------------------------------ static (production)
const dist = path.join(here, "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: "1h", index: false }));
  app.get(/^(?!\/(api|auth)\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  const on = Object.values(PROVIDERS).filter(enabled).map((p) => p.id);
  console.log(`[thosaphol-connect] API on http://localhost:${PORT} · public URL ${PUBLIC_URL}`);
  console.log(`[thosaphol-connect] sign-in providers: ${on.length ? on.join(", ") : "none configured (guest/local mode only)"}`);
  console.log(`[thosaphol-connect] copilot: ${anthropic ? `Claude (${AGENT_MODEL})` : "offline assistant (no ANTHROPIC_API_KEY)"}`);
  console.log(`[thosaphol-connect] Google Form logging: ${FORM.id && FORM.name ? "on" : "off"}`);
});
