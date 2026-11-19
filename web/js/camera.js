// One-screen cinema camera over the SVG world.
//
// The camera never thinks in raw viewport pixels: it frames into the *safe
// area* — the viewport minus whatever HUD panel is open (focus card, finale).
// That is what keeps the story card from ever covering the branch in focus.

import { clamp, easeInOut } from "./util.js";

export function createCamera({ viewport, canvas, safeInsets, onUserMove }) {
  const cur = { x: 0, y: 0, z: 1, ax: 0.5, ay: 0.5 };
  const target = { ...cur };
  let tween = null;  // { from, to, start, ms }
  let tau = 0.16;    // damping time constant (s) while following
  let bounds = { minZ: 0.05, maxZ: 3 };

  // Insets glide too: a panel opening/closing never jolts the frame.
  let smooth = null;
  function rectFrom(ins) {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    return { left: ins.left, top: ins.top, width: Math.max(80, w - ins.left - ins.right), height: Math.max(80, h - ins.top - ins.bottom) };
  }
  function smoothRect(dtMs = 0) {
    const raw = safeInsets();
    if (!smooth) smooth = { ...raw };
    const k = 1 - Math.exp(-(dtMs / 1000) / 0.38);
    for (const key of ["left", "right", "top", "bottom"]) smooth[key] += (raw[key] - smooth[key]) * k;
    return rectFrom(smooth);
  }

  /** Where the frame is heading (planning) — uses the target insets, not the smoothed ones. */
  function safeRect() {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    const ins = safeInsets();
    const left = ins.left, top = ins.top;
    return { left, top, width: Math.max(80, w - ins.left - ins.right), height: Math.max(80, h - ins.top - ins.bottom) };
  }

  function apply(dtMs = 0) {
    const s = smoothRect(dtMs);
    const tx = s.left + s.width * cur.ax - cur.x * cur.z;
    const ty = s.top + s.height * cur.ay - cur.y * cur.z;
    canvas.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${cur.z.toFixed(5)})`;
  }

  function step(dtMs) {
    if (tween) {
      const p = clamp((performance.now() - tween.start) / tween.ms, 0, 1);
      const e = easeInOut(p);
      for (const k of ["x", "y", "ax", "ay"]) cur[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * e;
      // Crane move: pull back mid-flight on long hops, push in on arrival.
      const lz = Math.log(tween.from.z) + (Math.log(tween.to.z) - Math.log(tween.from.z)) * e;
      cur.z = Math.exp(lz - tween.arc * Math.sin(Math.PI * e));
      if (p >= 1) tween = null;
    } else {
      const k = 1 - Math.exp(-(dtMs / 1000) / tau);
      for (const key of ["x", "y", "ax", "ay"]) cur[key] += (target[key] - cur[key]) * k;
      cur.z = Math.exp(Math.log(cur.z) + (Math.log(target.z) - Math.log(cur.z)) * k);
      // Land exactly: an endless creep of tiny zoom steps keeps the browser re-rasterizing.
      if (Math.abs(Math.log(cur.z / target.z)) < 0.002) cur.z = target.z;
    }
    apply(dtMs);
  }

  /** Zoom that fits a world box into the safe area. */
  function fitZoom(box, pad = 40) {
    const s = safeRect();
    const zx = (s.width - pad * 2) / Math.max(1, box.x1 - box.x0);
    const zy = (s.height - pad * 2) / Math.max(1, box.y1 - box.y0);
    return Math.min(zx, zy);
  }

  // ---- user pan / zoom (pauses the show through onUserMove) ---------------
  let drag = null;
  viewport.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest?.(".node.shown, .pill")) return;
    drag = { x: e.clientX, y: e.clientY, cx: cur.x, cy: cur.y, moved: false };
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; onUserMove?.(); viewport.classList.add("dragging"); }
    tween = null;
    cur.x = target.x = drag.cx - dx / cur.z;
    cur.y = target.y = drag.cy - dy / cur.z;
    apply();
  });
  const endDrag = () => { drag = null; viewport.classList.remove("dragging"); };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    onUserMove?.();
    tween = null;
    const s = smoothRect(0);
    const r = viewport.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const tx = s.left + s.width * cur.ax - cur.x * cur.z;
    const ty = s.top + s.height * cur.ay - cur.y * cur.z;
    const wx = (mx - tx) / cur.z, wy = (my - ty) / cur.z; // world point under the cursor stays put
    const z = clamp(cur.z * Math.exp(-e.deltaY * 0.0015), bounds.minZ, bounds.maxZ);
    cur.z = target.z = z;
    cur.x = target.x = wx - (mx - s.left - s.width * cur.ax) / z;
    cur.y = target.y = wy - (my - s.top - s.height * cur.ay) / z;
    apply();
  }, { passive: false });

  return {
    step,
    fitZoom,
    safeRect,
    get zoom() { return cur.z; },
    setBounds(b) { bounds = { ...bounds, ...b }; },

    /** Jump instantly. */
    snap(x, y, z = cur.z, { ax = 0.5, ay = 0.5 } = {}) {
      tween = null;
      smooth = null;
      Object.assign(cur, { x, y, z, ax, ay });
      Object.assign(target, cur);
      apply();
    },

    /** Damped chase — for following the runner tip every frame. An eased
     *  move in progress is allowed to land first; the chase picks up from there. */
    follow(x, y, z = target.z, { ax = 0.5, ay = 0.62, lag = 0.16 } = {}) {
      tau = lag;
      Object.assign(target, { x, y, z, ax, ay });
    },

    /** Eased move that frames a world box; resolves when it lands (real time). */
    frame(box, { ms = 700, minZ = 0.4, maxZ = 1.6, pad = 48 } = {}) {
      const z = clamp(fitZoom(box, pad), minZ, maxZ);
      const to = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, z, ax: 0.5, ay: 0.5 };
      Object.assign(target, to);
      if (ms <= 0) { tween = null; Object.assign(cur, to); apply(); return Promise.resolve(); }
      const s = safeRect();
      const hop = Math.hypot(to.x - cur.x, to.y - cur.y) * Math.min(cur.z, z) / Math.max(1, Math.min(s.width, s.height));
      const arc = hop > 0.7 ? Math.min(0.9, Math.log(hop / 0.7 + 1) * 0.55) : 0;
      ms *= 1 + arc * 0.5; // longer hops take a little longer
      tween = { from: { ...cur }, to, start: performance.now(), ms, arc };
      return new Promise((r) => setTimeout(r, ms));
    },
  };
}
