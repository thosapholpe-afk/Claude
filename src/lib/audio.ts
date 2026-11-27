/** Buzzer and relay sounds driven by the live simulation. */
let ctx: AudioContext | null = null;
const voices = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
  if (m) for (const id of [...voices.keys()]) stopTone(id);
}
export const isMuted = () => muted;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setTone(id: string, hz: number) {
  if (muted || hz <= 0) return stopTone(id);
  const c = ac();
  let v = voices.get(id);
  if (!v) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    gain.gain.value = 0;
    osc.connect(gain).connect(c.destination);
    osc.start();
    v = { osc, gain };
    voices.set(id, v);
  }
  v.osc.frequency.setTargetAtTime(Math.min(8000, hz), c.currentTime, 0.005);
  v.gain.gain.setTargetAtTime(0.035, c.currentTime, 0.01);
}

export function stopTone(id: string) {
  const v = voices.get(id);
  if (!v || !ctx) return;
  v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
  const osc = v.osc;
  setTimeout(() => osc.stop(), 80);
  voices.delete(id);
}

export function stopAll() {
  for (const id of [...voices.keys()]) stopTone(id);
}

export function click() {
  if (muted) return;
  const c = ac();
  const buf = c.createBuffer(1, 600, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 60);
  const src = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = 0.25;
  src.buffer = buf;
  src.connect(g).connect(c.destination);
  src.start();
}
