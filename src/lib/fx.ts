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
