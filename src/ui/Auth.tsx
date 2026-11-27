import { useEffect, useState } from "react";
import { getBoard } from "../core/boards";
import { getPart } from "../core/parts";
import { useStudio, type User } from "../store";
import { Board2D, SvgDefs } from "./render/Board2D";
import { Part2D } from "./render/Parts2D";

interface MeResponse {
  user: User | null;
  providers: Record<string, boolean>;
  guest: boolean;
  formConfigured?: boolean;
}

const PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
] as const;

function BrandIcon({ id }: { id: string }) {
  switch (id) {
    case "google":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1C3.4 21.3 7.4 24 12 24z" />
          <path fill="#FBBC05" d="M5.4 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6h-4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.4l4-3.1z" />
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.7 1.4 6.6l4 3.1c.9-2.8 3.5-4.9 6.6-4.9z" />
        </svg>
      );
    case "github":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path fill="currentColor" d="M12 .5C5.7.5.5 5.7.5 12a11.5 11.5 0 0 0 7.9 10.9c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 23.5 12C23.5 5.7 18.3.5 12 .5z" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v2.9h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <defs>
            <linearGradient id="ig" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#feda75" />
              <stop offset=".35" stopColor="#fa7e1e" />
              <stop offset=".6" stopColor="#d62976" />
              <stop offset="1" stopColor="#4f5bd5" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig)" />
          <circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="1.8" />
          <circle cx="17.3" cy="6.7" r="1.2" fill="#fff" />
        </svg>
      );
  }
}

/** Live hero: an ESP32 + flame sensor reacting to a fire that grows and fades. */
function HeroScene() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setT(5);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      setT((now - t0) / 1000);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  const board = getBoard("esp32-devkit-v1");
  const flameDef = getPart("flame")!;
  const ledDef = getPart("led")!;
  const phase = (t % 10) / 10;
  const fire = Math.max(0, Math.sin(phase * Math.PI)) ** 1.5;
  const alarm = fire > 0.45;
  const pts = Array.from({ length: 80 }, (_, i) => {
    const p = ((t - (79 - i) * 0.1) % 10) / 10;
    const f = Math.max(0, Math.sin(Math.max(0, p) * Math.PI)) ** 1.5;
    return `${i * 1.6},${40 - f * 30 - Math.sin(i * 1.7) * 0.8}`;
  });
  return (
    <svg viewBox="-6 -22 150 118" className="hero-scene" role="img" aria-label="An ESP32 with a flame sensor raising an alarm as a simulated fire grows">
      <SvgDefs />
      <g opacity={0.9}>
        {Array.from({ length: 14 }, (_, i) => (
          <circle
            key={i}
            cx={66 + Math.sin(i * 2.1 + t * 3) * 3}
            cy={-4 - (((t * 0.8 + i / 14) % 1) * 18) * fire}
            r={(2 + (i % 3)) * fire * (1 - ((t * 0.8 + i / 14) % 1))}
            fill={i % 3 ? "#ff7a1a" : "#ffd23f"}
            opacity={0.75}
            filter="url(#xt-glow)"
          />
        ))}
      </g>
      <g transform="translate(0 0)">
        <Board2D board={board} powered ledOn={alarm && Math.floor(t * 6) % 2 === 0} showLabels={false} />
      </g>
      <g transform="translate(78 -6)">
        <Part2D inst={{ id: "f", type: "flame", label: "", x: 0, y: 0, rot: 0, props: { sensitivity: 0.6 } }} def={flameDef} live={{ powered: true, indicator: alarm }} t={t} />
      </g>
      <g transform="translate(70 22)">
        <Part2D inst={{ id: "l", type: "led", label: "", x: 0, y: 0, rot: 0, props: { color: "red" } }} def={ledDef} live={{ brightness: alarm ? (Math.floor(t * 6) % 2 ? 1.2 : 0.1) : 0 }} t={t} />
      </g>
      <path d="M 50.5 1.3 C 55 -14, 95 -16, 108.7 4.6" stroke="#ff9f1c" strokeWidth={0.8} fill="none" />
      <path d="M 45.4 1.3 C 52 -10, 92 -6, 108.7 7.1" stroke="#ef3b36" strokeWidth={0.8} fill="none" />
      <path d="M 7 1.3 C 0 -18, 100 -22, 108.7 2" stroke="#2b2f33" strokeWidth={0.8} fill="none" />
      <path d="M 17.2 26.7 C 18 40, 72 42, 73.8 33.4" stroke="#3ddc97" strokeWidth={0.8} fill="none" />
      <g transform="translate(0 52)">
        <rect x={-2} y={0} width={132} height={44} rx={2} fill="var(--panel-2)" stroke="var(--line)" strokeWidth={0.3} />
        <text x={2} y={6} fontSize={3} fill="var(--text-2)" fontFamily="IBM Plex Mono">
          flame IR · GPIO32
        </text>
        <polyline points={pts.join(" ")} transform="translate(2 2)" fill="none" stroke="var(--accent)" strokeWidth={0.8} strokeLinejoin="round" />
        <text x={126} y={6} fontSize={3} fill={alarm ? "#ff5a5f" : "var(--text-2)"} textAnchor="end" fontFamily="IBM Plex Mono">
          {alarm ? "ALARM" : "clear"}
        </text>
      </g>
    </svg>
  );
}

export function Landing({ me, onLocal }: { me: MeResponse | null; onLocal: () => void }) {
  const offline = !me;
  return (
    <div className="landing">
      <header className="land-top">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--accent-ink-bg)" />
            <path d="M8 9l6.5 7L8 23M24 9l-6.5 7L24 23" stroke="var(--accent)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="16" cy="16" r="1.8" fill="var(--accent)" />
          </svg>
          <span className="wordmark">Thosaphol Connect</span>
        </div>
        <nav className="land-nav">
          <a href="#how">How it works</a>
          <a href="#signin" className="btn primary">
            Open the studio
          </a>
        </nav>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <h1>
            Wire it.
            <br />
            Run it.
            <br />
            Then put it through fire.
          </h1>
          <p className="lede">A digital twin for ESP32, Arduino and Raspberry Pi circuits. Real voltages, real firmware, and a world around the board — flames, floods, failing motors — that your sensors actually feel.</p>
          <p className="lede th">จำลองวงจรไมโครคอนโทรลเลอร์ แล้วโยนบอร์ดเข้าไปในสถานการณ์จริง</p>
          <div className="signin" id="signin">
            {PROVIDERS.map((p) => {
              const enabled = !!me?.providers[p.id];
              return (
                <a key={p.id} className={`btn provider ${enabled ? "" : "disabled"}`} href={enabled ? `/auth/${p.id}` : undefined} aria-disabled={!enabled} title={enabled ? `Sign in with ${p.label}` : `${p.label} sign-in is not configured on this server yet`} onClick={(e) => !enabled && e.preventDefault()}>
                  <BrandIcon id={p.id} />
                  Continue with {p.label}
                </a>
              );
            })}
            {(offline || me?.guest) && (
              <button className="btn ghost provider" onClick={onLocal}>
                {offline ? "Try it locally — no server needed" : "Continue without an account"}
              </button>
            )}
          </div>
          {offline && <p className="muted small">The login server isn't reachable, so sign-in is off. Your work stays in this browser.</p>}
        </div>
        <div className="hero-art">
          <HeroScene />
        </div>
      </section>
      <section className="how" id="how">
        <div>
          <h3>Simulate</h3>
          <p>Drag boards, sensors and actuators onto a breadboard, or type “GP10 → LED1” and let the wiring pick free pins. Arduino C++, MicroPython and Python run in the browser against a real nodal circuit solver.</p>
        </div>
        <div>
          <h3>Stimulate</h3>
          <p>Tell the copilot where the board lives. A burning building, rising water, a motor with a bad bearing — every sensor model reacts on a timeline you control.</p>
        </div>
        <div>
          <h3>Stream & measure</h3>
          <p>Plot any signal, compare against saved runs in the historian, read the FFT, and publish the twin over MQTT to the rest of your system.</p>
        </div>
        <div>
          <h3>Make it physical</h3>
          <p>Export true-scale board drawings in SVG and DXF, and generate a printable enclosure as STL — ventilated, waterproof or with mounting ears.</p>
        </div>
      </section>
      <footer className="land-foot muted small">Thosaphol Connect · built for makers, students and engineers</footer>
    </div>
  );
}

export function Onboarding({ user, onDone }: { user: User; onDone: (u: User) => void }) {
  const [name, setName] = useState(user.name ?? "");
  const [role, setRole] = useState("student");
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="modal-back">
      <form
        className="modal onboard"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          setErr(null);
          try {
            const r = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), role, organization: org.trim() }) });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error ?? "Could not save your profile");
            onDone(j.user as User);
          } catch (e2) {
            setErr((e2 as Error).message);
          }
          setBusy(false);
        }}
      >
        <header>
          <h2>Welcome to Thosaphol Connect</h2>
        </header>
        <p className="muted">Choose the name other people will see on your projects.</p>
        <label className="field">
          <span>Display name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={40} required />
        </label>
        <label className="field">
          <span>I am a…</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="student">Student</option>
            <option value="teacher">Teacher</option>
            <option value="maker">Maker / hobbyist</option>
            <option value="engineer">Engineer</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field">
          <span>School or company (optional)</span>
          <input value={org} onChange={(e) => setOrg(e.target.value)} maxLength={80} />
        </label>
        {err && <p className="warn-text">{err}</p>}
        <button className="btn primary wide" disabled={busy || !name.trim()}>
          {busy ? "Saving…" : "Start building"}
        </button>
      </form>
    </div>
  );
}

export function useAuth() {
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);
  const user = useStudio((s) => s.user);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/me");
        if (!r.ok) throw new Error();
        const j = (await r.json()) as MeResponse;
        if (cancelled) return;
        setMe(j);
        if (j.user) useStudio.setState({ user: j.user });
        else restoreLocal();
      } catch {
        if (cancelled) return;
        setMe(null);
        restoreLocal();
      }
      useStudio.setState({ authChecked: true });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { me, user };
}

function restoreLocal() {
  try {
    const raw = localStorage.getItem("xtwin.localUser");
    if (raw) useStudio.setState({ user: JSON.parse(raw) as User });
  } catch {
    /* ignore */
  }
}

export function startLocal() {
  const name = (prompt("What should we call you?", "") ?? "").trim() || "Maker";
  const u: User = { id: `local-${Date.now()}`, name, provider: "local", local: true };
  try {
    localStorage.setItem("xtwin.localUser", JSON.stringify(u));
  } catch {
    /* ignore */
  }
  // record local sign-ups too when a server is reachable
  void fetch("/api/profile/local", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => undefined);
  useStudio.setState({ user: u });
}
