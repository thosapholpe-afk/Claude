import { Activity, ArrowRight, Box, Cpu, Droplets, Flame, Plus, Thermometer, Waves, Wifi } from "lucide-react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { getBoard } from "../core/boards";
import { getPart } from "../core/parts";
import { useStudio, type User } from "../store";
import { Board2D, SvgDefs } from "./render/Board2D";
import { Part2D } from "./render/Parts2D";
import { Brand } from "./Logo";

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

function useClock() {
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
  return t;
}

const fireAt = (t: number) => Math.max(0, Math.sin((((t % 10) + 10) % 10) / 10 * Math.PI)) ** 1.5;

/** Live hero: an ESP32 + flame sensor reacting to a fire that grows and fades. */
function HeroScene({ t }: { t: number }) {
  const board = getBoard("esp32-devkit-v1");
  const flameDef = getPart("flame")!;
  const ledDef = getPart("led")!;
  const fire = fireAt(t);
  const alarm = fire > 0.45;
  const pts = Array.from({ length: 80 }, (_, i) => `${i * 1.6},${40 - fireAt(t - (79 - i) * 0.1) * 30 - Math.sin(i * 1.7) * 0.8}`);
  return (
    <svg viewBox="-6 -22 150 118" className="hero-scene" role="img" aria-label="An ESP32 with a flame sensor raising an alarm as a simulated fire grows">
      <SvgDefs />
      <defs>
        <linearGradient id="heroGrad" x1="0" x2="1">
          <stop offset="0" stopColor="#bcd9a2" />
          <stop offset="0.5" stopColor="#e8d4a2" />
          <stop offset="1" stopColor="#f5b0a3" />
        </linearGradient>
      </defs>
      <g opacity={0.9}>
        {Array.from({ length: 14 }, (_, i) => (
          <circle
            key={i}
            cx={66 + Math.sin(i * 2.1 + t * 3) * 3}
            cy={-4 - ((t * 0.8 + i / 14) % 1) * 18 * fire}
            r={(2 + (i % 3)) * fire * (1 - ((t * 0.8 + i / 14) % 1))}
            fill={i % 3 ? "#f5b0a3" : "#e8d4a2"}
            opacity={0.8}
            filter="url(#tc-glow)"
          />
        ))}
      </g>
      <Board2D board={board} powered ledOn={alarm && Math.floor(t * 6) % 2 === 0} showLabels={false} />
      <g transform="translate(78 -6)">
        <Part2D inst={{ id: "f", type: "flame", label: "", x: 0, y: 0, rot: 0, props: { sensitivity: 0.6 } }} def={flameDef} live={{ powered: true, indicator: alarm }} t={t} />
      </g>
      <g transform="translate(70 22)">
        <Part2D inst={{ id: "l", type: "led", label: "", x: 0, y: 0, rot: 0, props: { color: "red" } }} def={ledDef} live={{ brightness: alarm ? (Math.floor(t * 6) % 2 ? 1.2 : 0.1) : 0 }} t={t} />
      </g>
      <path d="M 50.5 1.3 C 55 -14, 95 -16, 108.7 4.6" stroke="#ff9f1c" strokeWidth={0.8} fill="none" />
      <path d="M 45.4 1.3 C 52 -10, 92 -6, 108.7 7.1" stroke="#ef3b36" strokeWidth={0.8} fill="none" />
      <path d="M 7 1.3 C 0 -18, 100 -22, 108.7 2" stroke="#55555a" strokeWidth={0.8} fill="none" />
      <path d="M 17.2 26.7 C 18 40, 72 42, 73.8 33.4" stroke="#bcd9a2" strokeWidth={0.8} fill="none" />
      <g transform="translate(0 52)">
        <rect x={-2} y={0} width={132} height={44} rx={3} fill="var(--panel-2)" />
        <text x={2} y={6} fontSize={3} fill="var(--text-2)" fontFamily="IBM Plex Mono">
          flame IR · GPIO32
        </text>
        <polyline points={pts.join(" ")} transform="translate(2 2)" fill="none" stroke="url(#heroGrad)" strokeWidth={0.9} strokeLinejoin="round" />
        <text x={126} y={6} fontSize={3} fill={alarm ? "#f5b0a3" : "var(--text-2)"} textAnchor="end" fontFamily="IBM Plex Mono">
          {alarm ? "ALARM" : "clear"}
        </text>
      </g>
    </svg>
  );
}

const PLANETS = [
  { icon: Flame, orbit: 0, speed: 0.32, phase: 0, tone: "peach" },
  { icon: Droplets, orbit: 1, speed: -0.24, phase: 2, tone: "sky" },
  { icon: Waves, orbit: 2, speed: 0.2, phase: 4, tone: "sage" },
  { icon: Wifi, orbit: 0, speed: 0.32, phase: Math.PI, tone: "sand" },
  { icon: Thermometer, orbit: 1, speed: -0.24, phase: 5.2, tone: "peach" },
] as const;
const ORBITS = [
  { rx: 49, ry: 20, rot: -16 },
  { rx: 44, ry: 26, rot: 24 },
  { rx: 50, ry: 14, rot: 8 },
];

/** Orbit rings with sensor "planets" circling the hero circuit (positions in % of the stage). */
function Orbits({ t }: { t: number }) {
  return (
    <>
      <svg className="orbits" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="orbitGrad" x1="0" x2="1">
            <stop offset="0" stopColor="#bcd9a2" stopOpacity="0.9" />
            <stop offset="0.5" stopColor="#e8d4a2" stopOpacity="0.4" />
            <stop offset="1" stopColor="#f5b0a3" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {ORBITS.map((o, i) => (
          <ellipse key={i} cx="50" cy="50" rx={o.rx} ry={o.ry} transform={`rotate(${o.rot + Math.sin(t * 0.3 + i) * 2} 50 50)`} fill="none" stroke="url(#orbitGrad)" strokeWidth="0.25" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {PLANETS.map((p, i) => {
        const o = ORBITS[p.orbit];
        const a = t * p.speed + p.phase;
        const ex = Math.cos(a) * o.rx;
        const ey = Math.sin(a) * o.ry;
        const r = ((o.rot + Math.sin(t * 0.3 + p.orbit) * 2) * Math.PI) / 180;
        const x = 50 + ex * Math.cos(r) - ey * Math.sin(r);
        const y = 50 + ex * Math.sin(r) + ey * Math.cos(r);
        const depth = (Math.sin(a) + 1) / 2; // 0 back … 1 front
        const Icon = p.icon;
        return (
          <span key={i} className={`planet ${p.tone}`} style={{ left: `${x}%`, top: `${y}%`, transform: `translate(-50%,-50%) scale(${0.7 + depth * 0.5})`, opacity: 0.45 + depth * 0.55, zIndex: depth > 0.5 ? 3 : 1 }}>
            <Icon size={16} />
          </span>
        );
      })}
    </>
  );
}

const MARQUEE = ["ESP32 DevKit", "Arduino Uno R3", "Raspberry Pi Pico", "Raspberry Pi 4", "DHT22", "HC-SR04", "Servo SG90", "MG996R", "MQ-2", "ADXL335", "NeoPixel", "LCD 16×2", "MQTT", "FFT", "STL", "DXF"];

const FEATURES = [
  { title: "Simulate", body: "Drag boards and sensors onto a breadboard, or type “GP10 → LED1” and the wiring picks free pins. Arduino C++, MicroPython and Python run against a real circuit solver.", icon: Cpu },
  { title: "Stimulate", body: "Tell the copilot where the board lives — a burning building, rising water, a motor with a bad bearing — and every sensor reacts on a timeline you control.", icon: Flame },
  { title: "Stream & measure", body: "Plot any signal, compare runs in the historian, read the FFT, and publish the twin over MQTT to the rest of your system.", icon: Activity },
  { title: "Make it physical", body: "Export true-scale drawings in SVG and DXF, and generate a printable enclosure as STL — vented, waterproof or with mounting ears.", icon: Box },
];

const rise = {
  hidden: { opacity: 0, y: 28, filter: "blur(10px)" },
  show: (i: number) => ({ opacity: 1, y: 0, filter: "blur(0px)", transition: { delay: 0.15 + i * 0.12, duration: 0.8, ease: [0.2, 0.8, 0.2, 1] as const } }),
};

export function Landing({ me, onLocal }: { me: MeResponse | null; onLocal: () => void }) {
  const offline = !me;
  const t = useClock();
  const heroRef = useRef<HTMLElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 60, damping: 18 });
  const sy = useSpring(my, { stiffness: 60, damping: 18 });
  const stageX = useTransform(sx, (v) => v * 18);
  const stageY = useTransform(sy, (v) => v * 14);
  const stageRX = useTransform(sy, (v) => v * -6);
  const stageRY = useTransform(sx, (v) => v * 8);
  const arcRot = useTransform(sx, (v) => v * 4);
  const [glow, setGlow] = useState({ x: 70, y: 40 });
  const fire = fireAt(t);
  const temp = 26 + fire * 52;
  const canGuest = offline || me?.guest;
  const enter = () => (canGuest ? onLocal() : document.getElementById("signin")?.scrollIntoView({ behavior: "smooth" }));
  return (
    <div className="landing">
      <motion.svg className="sweep" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden style={{ rotate: arcRot }}>
        <motion.path d="M 980 -40 C 520 40, 430 330, 640 560 C 820 760, 760 980, 560 1100" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2.4, ease: [0.3, 0.7, 0.2, 1] }} />
      </motion.svg>
      <header className="land-top">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <Brand size={34} />
        </motion.div>
        <motion.nav className="land-nav" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}>
          {FEATURES.map((f) => (
            <a key={f.title} href="#how">
              {f.title}
            </a>
          ))}
          <button className="btn ghost pill" onClick={() => document.getElementById("signin")?.scrollIntoView({ behavior: "smooth" })}>
            Sign in
          </button>
        </motion.nav>
      </header>
      <section
        className="hero"
        ref={heroRef}
        onPointerMove={(e) => {
          const r = heroRef.current!.getBoundingClientRect();
          mx.set(((e.clientX - r.left) / r.width - 0.5) * 2);
          my.set(((e.clientY - r.top) / r.height - 0.5) * 2);
          setGlow({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
        }}
        onPointerLeave={() => {
          mx.set(0);
          my.set(0);
        }}
        style={{ ["--gx" as string]: `${glow.x}%`, ["--gy" as string]: `${glow.y}%` }}
      >
        <div className="hero-copy">
          <motion.p className="eyebrow" variants={rise} initial="hidden" animate="show" custom={0}>
            Digital twin studio for makers
          </motion.p>
          <h1>
            {["Wire it.", "Run it.", "Put it through fire."].map((line, i) => (
              <motion.span key={line} className="grad-text line" variants={rise} initial="hidden" animate="show" custom={i + 1}>
                {line}
              </motion.span>
            ))}
          </h1>
          <motion.p className="lede" variants={rise} initial="hidden" animate="show" custom={4}>
            Simulate ESP32, Arduino and Raspberry Pi circuits with real voltages and real firmware — then drop the board into flames, floods or a failing motor and watch your sensors respond.
          </motion.p>
          <motion.p className="lede th" variants={rise} initial="hidden" animate="show" custom={5}>
            จำลองวงจรไมโครคอนโทรลเลอร์ แล้วโยนบอร์ดเข้าไปในสถานการณ์จริง
          </motion.p>
          <motion.div className="cta-row" variants={rise} initial="hidden" animate="show" custom={6}>
            <button className="btn primary pill big magnetic" onClick={enter}>
              Open the studio <ArrowRight size={17} />
            </button>
            <a className="btn ghost pill big" href="#how">
              See how it works
            </a>
          </motion.div>
          <motion.div className="signin" id="signin" variants={rise} initial="hidden" animate="show" custom={7}>
            <span className="muted small">Sign in with</span>
            {PROVIDERS.map((p) => {
              const enabled = !!me?.providers[p.id];
              return (
                <a
                  key={p.id}
                  className={`provider-dot ${enabled ? "" : "disabled"}`}
                  href={enabled ? `/auth/${p.id}` : undefined}
                  aria-label={`Sign in with ${p.label}${enabled ? "" : " (not configured on this server)"}`}
                  title={enabled ? `Sign in with ${p.label}` : `${p.label} sign-in isn't configured on this server yet`}
                  onClick={(e) => !enabled && e.preventDefault()}
                >
                  <BrandIcon id={p.id} />
                </a>
              );
            })}
            {canGuest && (
              <button className="link small guest" onClick={onLocal}>
                or continue without an account
              </button>
            )}
          </motion.div>
          {offline && <p className="muted small">The login server isn't reachable, so sign-in is off. Your work stays in this browser.</p>}
        </div>
        <motion.div className="hero-stage" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.1, delay: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
          <motion.div className="stage-inner" style={{ x: stageX, y: stageY, rotateX: stageRX, rotateY: stageRY }}>
            <Orbits t={t} />
            <div className="hero-art float">
              <HeroScene t={t} />
            </div>
          </motion.div>
        </motion.div>
        <motion.aside className="hero-read" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.9, delay: 0.9 }}>
          <span className="big grad-text">{temp.toFixed(0)}°</span>
          <span>room temperature</span>
          <span className="big grad-text">{Math.round(fire * 100)}%</span>
          <span>flame IR at GPIO32</span>
        </motion.aside>
        <motion.button className="plus-btn" aria-label="Open the studio" onClick={enter} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 160, damping: 14, delay: 1.2 }} whileHover={{ rotate: 90, scale: 1.08 }} whileTap={{ scale: 0.92 }}>
          <Plus size={22} />
        </motion.button>
      </section>
      <div className="marquee" aria-hidden>
        <div className="track">
          {[...MARQUEE, ...MARQUEE].map((m, i) => (
            <span key={i}>
              {m}
              <i />
            </span>
          ))}
        </div>
      </div>
      <section className="how" id="how">
        <motion.h2 className="how-title" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.7 }}>
          From breadboard to <span className="grad-text">the real world</span>
        </motion.h2>
        <div className="how-cards">
          {FEATURES.map((f, i) => (
            <motion.article
              key={f.title}
              className="how-card tilt"
              initial={{ opacity: 0, y: 60, rotate: i % 2 ? 2 : -2 }}
              whileInView={{ opacity: 1, y: 0, rotate: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.8, delay: i * 0.12, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ ["--i" as string]: i }}
            >
              <span className="step">{String(i + 1).padStart(2, "0")}</span>
              <f.icon size={26} className="how-icon" />
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </motion.article>
          ))}
        </div>
      </section>
      <footer className="land-foot">
        <Brand size={24} />
        <span className="muted small">Built for makers, students and engineers</span>
      </footer>
      <div className="grad-bar" />
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
          <h2>
            Welcome to <span className="grad-text">Thosaphol Connect</span>
          </h2>
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
    const raw = localStorage.getItem("tconnect.localUser");
    if (raw) useStudio.setState({ user: JSON.parse(raw) as User });
  } catch {
    /* ignore */
  }
}

export function startLocal() {
  const name = (prompt("What should we call you?", "") ?? "").trim() || "Maker";
  const u: User = { id: `local-${Date.now()}`, name, provider: "local", local: true };
  try {
    localStorage.setItem("tconnect.localUser", JSON.stringify(u));
  } catch {
    /* ignore */
  }
  // record local sign-ups too when a server is reachable
  void fetch("/api/profile/local", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => undefined);
  useStudio.setState({ user: u });
}
