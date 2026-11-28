/**
 * Sound effects for the live simulation, synthesized with Web Audio (no sound files):
 * lamps and LEDs switching, relay / contactor clacks, buttons, selectors, E-stop,
 * pneumatic exhaust and cylinder end stops, sensor "detect" blips, motor hum, servo
 * whine, buzzer and continuity tones. Everything goes through one master bus with a
 * compressor so many parts at once never clip.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
const voices = new Map<string, { osc: OscillatorNode; gain: GainNode; filter?: BiquadFilterNode; src?: AudioBufferSourceNode }>();
let muted = false;
let volume = 0.8;

export function setMuted(m: boolean) {
  muted = m;
  if (m) stopAll();
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : volume, ctx.currentTime, 0.02);
}
export const isMuted = () => muted;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
const out = () => {
  ac();
  return master!;
};

function noise(c: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** A pitched blip: sine/triangle/square that glides from f0 to f1 and decays. */
function blip(f0: number, f1: number, dur: number, peak: number, type: OscillatorType = "sine", delay = 0) {
  const c = ac();
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out());
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A filtered noise burst: clicks, clacks, hisses and whooshes. */
function burst(dur: number, peak: number, filter: BiquadFilterType, f0: number, f1 = f0, q = 1, delay = 0) {
  const c = ac();
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const bq = c.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  bq.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.01, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bq).connect(g).connect(out());
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

// ---------------------------------------------------------------------------
// one-shot effects
// ---------------------------------------------------------------------------
export const fx = {
  /** LED lighting up: a bright little blip. */
  ledOn: () => blip(1700, 2500, 0.07, 0.05),
  ledOff: () => blip(1100, 700, 0.05, 0.025),
  /** Panel pilot lamp: soft tick + warm ping. */
  lampOn: () => {
    burst(0.02, 0.05, "highpass", 3000);
    blip(880, 1320, 0.16, 0.05, "triangle", 0.005);
  },
  lampOff: () => blip(660, 440, 0.09, 0.025, "triangle"),
  /** LED driven too hard: pop and crackle. */
  burnt: () => {
    burst(0.05, 0.4, "lowpass", 3000, 400);
    for (let i = 1; i < 6; i++) burst(0.015, 0.08, "bandpass", 2500 + Math.random() * 2500, 2000, 4, i * 0.035 + Math.random() * 0.02);
  },
  /** Small signal relay. */
  relay: (on: boolean) => {
    burst(0.018, on ? 0.22 : 0.14, "bandpass", on ? 2600 : 3400, on ? 1800 : 2600, 2);
    if (on) blip(160, 90, 0.04, 0.06, "sine", 0.003);
  },
  /** Contactor pulling in: heavy clack with a thump; dropping out: lighter clack. */
  contactor: (on: boolean) => {
    burst(0.03, on ? 0.35 : 0.22, "bandpass", 1800, 900, 1.4);
    blip(on ? 120 : 160, 55, on ? 0.09 : 0.06, on ? 0.16 : 0.08, "sine", 0.004);
  },
  button: (down: boolean) => burst(0.012, down ? 0.16 : 0.09, "bandpass", down ? 4200 : 5200, 3000, 3),
  detent: () => {
    burst(0.012, 0.13, "bandpass", 3800, 2600, 3);
    burst(0.01, 0.09, "bandpass", 4600, 3200, 3, 0.045);
  },
  estop: () => {
    burst(0.06, 0.35, "lowpass", 1400, 300);
    blip(110, 50, 0.12, 0.18, "sine");
  },
  breaker: () => {
    burst(0.025, 0.4, "highpass", 2000, 4000);
    blip(200, 80, 0.06, 0.1, "sine");
  },
  /** 5/2 valve shifting: solenoid tick and a "pssht" from the exhaust. */
  valve: () => {
    burst(0.014, 0.12, "bandpass", 3000, 2000, 3);
    burst(0.32, 0.12, "bandpass", 5200, 2600, 0.8, 0.01);
  },
  /** Cylinder reaching an end stop. */
  cylinderEnd: () => {
    blip(210, 120, 0.07, 0.14, "sine");
    burst(0.03, 0.12, "lowpass", 2200, 600);
  },
  airOpen: () => burst(0.45, 0.1, "highpass", 3000, 6000, 0.7),
  /** Sensor detections, each with its own character. */
  sensor: (type: string) => {
    switch (type) {
      case "pir":
        blip(880, 880, 0.07, 0.05);
        blip(1320, 1320, 0.09, 0.05, "sine", 0.08);
        break;
      case "flame":
        burst(0.45, 0.14, "lowpass", 300, 2600, 0.8);
        break;
      case "rain":
      case "water":
        blip(1500, 480, 0.09, 0.07);
        blip(1300, 420, 0.08, 0.04, "sine", 0.13);
        break;
      case "sw420":
        for (let i = 0; i < 4; i++) burst(0.012, 0.09, "bandpass", 2200 + i * 300, 1600, 3, i * 0.03);
        break;
      case "mq2":
      case "mq135":
        blip(420, 380, 0.18, 0.06, "triangle");
        blip(420, 380, 0.18, 0.06, "triangle", 0.24);
        break;
      case "pulse":
        blip(70, 45, 0.08, 0.2);
        blip(65, 40, 0.07, 0.14, "sine", 0.13);
        break;
      case "touch":
        blip(2400, 2400, 0.03, 0.05);
        break;
      case "hall":
      case "ir-obstacle":
      case "limit-switch":
        blip(1500, 1800, 0.045, 0.05, "triangle");
        break;
      case "sound":
        blip(1000, 1600, 0.05, 0.04);
        break;
      default:
        blip(1200, 1500, 0.05, 0.045);
    }
  },
  /** Simulation start / stop chimes. */
  powerOn: () => {
    blip(523, 523, 0.09, 0.04, "triangle");
    blip(784, 784, 0.12, 0.04, "triangle", 0.08);
  },
  powerOff: () => {
    blip(784, 784, 0.08, 0.035, "triangle");
    blip(392, 392, 0.12, 0.035, "triangle", 0.07);
  },
};

// ---------------------------------------------------------------------------
// continuous voices (keyed per part)
// ---------------------------------------------------------------------------
function voice(id: string, make: (c: AudioContext) => { osc: OscillatorNode; gain: GainNode; filter?: BiquadFilterNode; src?: AudioBufferSourceNode }) {
  let v = voices.get(id);
  if (!v) {
    v = make(ac());
    voices.set(id, v);
  }
  return v;
}

/** Buzzers and the multimeter's continuity beeper. */
export function setTone(id: string, hz: number, level = 0.035) {
  if (muted || hz <= 0) return stopTone(id);
  const c = ac();
  const v = voice(id, (c2) => {
    const osc = c2.createOscillator();
    const gain = c2.createGain();
    osc.type = "square";
    gain.gain.value = 0;
    osc.connect(gain).connect(out());
    osc.start();
    return { osc, gain };
  });
  v.osc.frequency.setTargetAtTime(Math.min(8000, hz), c.currentTime, 0.005);
  v.gain.gain.setTargetAtTime(level, c.currentTime, 0.01);
}

/** Motors: a filtered sawtooth whose pitch and loudness follow the speed. */
export function setHum(id: string, rpm: number, maxRpm: number) {
  const k = Math.min(1, Math.abs(rpm) / Math.max(1, maxRpm));
  if (muted || k < 0.02) return stopTone(id);
  const c = ac();
  const v = voice(id, (c2) => {
    const osc = c2.createOscillator();
    const filter = c2.createBiquadFilter();
    const gain = c2.createGain();
    osc.type = "sawtooth";
    filter.type = "lowpass";
    filter.Q.value = 2;
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(out());
    osc.start();
    return { osc, gain, filter };
  });
  v.osc.frequency.setTargetAtTime(45 + k * 160, c.currentTime, 0.08);
  v.filter!.frequency.setTargetAtTime(300 + k * 1400, c.currentTime, 0.08);
  v.gain.gain.setTargetAtTime(0.012 + k * 0.03, c.currentTime, 0.08);
}

/** Servos while moving: a small geared whine. */
export function setWhine(id: string, on: boolean) {
  if (muted || !on) return stopTone(id);
  const c = ac();
  const v = voice(id, (c2) => {
    const osc = c2.createOscillator();
    const filter = c2.createBiquadFilter();
    const gain = c2.createGain();
    osc.type = "square";
    osc.frequency.value = 340;
    filter.type = "bandpass";
    filter.frequency.value = 900;
    filter.Q.value = 1.5;
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(out());
    osc.start();
    return { osc, gain, filter };
  });
  v.osc.frequency.setTargetAtTime(320 + Math.random() * 40, c.currentTime, 0.02);
  v.gain.gain.setTargetAtTime(0.02, c.currentTime, 0.02);
}

/** Air rushing while a cylinder strokes. */
export function setHiss(id: string, level: number) {
  if (muted || level < 0.02) return stopTone(id);
  const c = ac();
  const v = voice(id, (c2) => {
    const src = c2.createBufferSource();
    src.buffer = noise(c2);
    src.loop = true;
    const filter = c2.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 4200;
    filter.Q.value = 0.7;
    const gain = c2.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(out());
    src.start();
    // an oscillator slot is required by the voice record; keep a silent one
    const osc = c2.createOscillator();
    return { osc, gain, filter, src };
  });
  v.gain.gain.setTargetAtTime(0.025 * Math.min(1, level), c.currentTime, 0.05);
}

export function stopTone(id: string) {
  const v = voices.get(id);
  if (!v || !ctx) return;
  v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
  const { osc, src } = v;
  setTimeout(() => {
    try {
      osc.stop();
    } catch {
      /* never started */
    }
    try {
      src?.stop();
    } catch {
      /* ignore */
    }
  }, 120);
  voices.delete(id);
}

export function stopAll() {
  for (const id of [...voices.keys()]) stopTone(id);
}

/** Generic UI click (kept for existing callers). */
export function click() {
  if (muted) return;
  fx.relay(true);
}
