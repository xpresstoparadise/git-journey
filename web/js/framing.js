// Pure camera planning (no DOM): which world box a visit is framed with.
// Imported by the node tests, so a far-away lane can never fall off screen again.

import { clamp } from "./util.js";

/** Zoom that fits `box` into a `safe` {width, height} rect with `pad` px around. */
export function fitZoom(box, safe, pad = 48) {
  const zx = (safe.width - pad * 2) / Math.max(1, box.x1 - box.x0);
  const zy = (safe.height - pad * 2) / Math.max(1, box.y1 - box.y0);
  return Math.min(zx, zy);
}

/**
 * Box to frame a visit with.
 *  - Fits whole (lane + trunk on a first visit) when the zoom allows.
 *  - Too wide (a lane far from the trunk): keep the lane, slide the window
 *    toward the trunk as far as it reaches — the lane is never cut off.
 *  - Too tall: a readable window at the bottom; `tall` tells the caller to
 *    ride up the lane as nodes appear.
 */
export function visitFrame(v, safe, { minZ, maxZ, pad = 48, bottom = 96 }) {
  let box = v.bbox;
  let z = clamp(fitZoom(box, safe, pad), minZ, maxZ);
  const winW = (safe.width - pad * 2) / z;
  if (box.x1 - box.x0 > winW + 1) {
    const core = v.core ?? box;
    let x0, x1;
    if (core.x1 - core.x0 >= winW) {
      const cx = (core.x0 + core.x1) / 2;
      [x0, x1] = [cx - winW / 2, cx + winW / 2];
    } else if (v.lane.side > 0) {
      [x0, x1] = [core.x1 - winW, core.x1]; // lane right of the trunk: hug its outer edge
    } else {
      [x0, x1] = [core.x0, core.x0 + winW];
    }
    box = { ...box, x0, x1 };
    z = clamp(fitZoom(box, safe, pad), minZ, maxZ);
  }
  const winH = (safe.height - bottom) / z;
  const tall = box.y1 - box.y0 > winH;
  if (tall) box = { ...box, y0: box.y1 - winH };
  return { box, z, tall, winH };
}

/** Zoom and duration factor for a flight along a curve `dx` world px wide. */
export function flightPlan(dx, safeWidth, { z, minZ }) {
  const screens = (Math.abs(dx) * z) / Math.max(1, safeWidth);
  if (screens <= 0.55) return { z, slow: 1 };
  return {
    z: clamp((safeWidth * 0.55) / Math.abs(dx), minZ, z), // pull back so the curve reads as one move
    slow: clamp(1 + (screens - 0.55) * 0.35, 1, 1.9),     // and give it a little more time
  };
}
