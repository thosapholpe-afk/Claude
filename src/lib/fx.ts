/** Global press feedback: a ripple from the pointer on every button-like element. */
export function installRipples() {
  if (typeof document === "undefined") return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (reduce) return;
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("button, .ripple, [role=tab], .card-pick");
      if (!el || el.hasAttribute("disabled") || el.dataset.noRipple !== undefined) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.2;
      const dot = document.createElement("span");
      dot.className = "fx-ripple";
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${e.clientX - r.left - size / 2}px`;
      dot.style.top = `${e.clientY - r.top - size / 2}px`;
      const pos = getComputedStyle(el).position;
      if (pos === "static") el.style.position = "relative";
      el.style.overflow = el.style.overflow || "hidden";
      el.appendChild(dot);
      setTimeout(() => dot.remove(), 650);
    },
    { passive: true },
  );
}

/** Cursor-driven 3D tilt for `.tilt` cards and a magnetic pull on `.magnetic` / primary buttons. */
export function installTilt() {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  let active: HTMLElement | null = null;
  let magnet: HTMLElement | null = null;
  const reset = (el: HTMLElement | null) => {
    if (!el) return;
    el.style.removeProperty("--rx");
    el.style.removeProperty("--ry");
    el.style.removeProperty("--mx");
    el.style.removeProperty("--my");
  };
  document.addEventListener(
    "pointermove",
    (e) => {
      const target = e.target as HTMLElement | null;
      const card = target?.closest<HTMLElement>(".tilt");
      if (card !== active) {
        reset(active);
        active = card ?? null;
      }
      if (card) {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty("--rx", `${(-py * 10).toFixed(2)}deg`);
        card.style.setProperty("--ry", `${(px * 12).toFixed(2)}deg`);
        card.style.setProperty("--mx", `${((px + 0.5) * 100).toFixed(1)}%`);
        card.style.setProperty("--my", `${((py + 0.5) * 100).toFixed(1)}%`);
      }
      const btn = target?.closest<HTMLElement>(".magnetic, .btn.run, .btn.primary");
      if (btn !== magnet) {
        if (magnet) magnet.style.transform = "";
        magnet = btn ?? null;
      }
      if (btn && !btn.hasAttribute("disabled")) {
        const r = btn.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = `translate(${(dx * 0.12).toFixed(1)}px, ${(dy * 0.22).toFixed(1)}px)`;
      }
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => {
    reset(active);
    if (magnet) magnet.style.transform = "";
  });
}
