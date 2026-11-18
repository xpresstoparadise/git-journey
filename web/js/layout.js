// Geometry of the journey. Pure: projects + period in, coordinates out.
//
// Time runs bottom → top. Work is done in "height" units h (0 = period start,
// grows with time) and converted to SVG y only at the very end.
//
// Guarantees the UX brief asks for:
//  * no overlap inside a lane — nodes are stacked with a fixed minimum gap,
//    whatever the dates say (time is warped, not squeezed);
//  * same week ⇒ same height band across lanes, so parallel repos stay in sync;
//  * a lane keeps its slot for life and a slot is reused only after the previous
//    owner merged back — branches never drift or stick together.

import { DAY_MS, clamp, weekStart } from "./util.js";

export const GEOMETRY = {
  FIRST_SLOT: 230,   // trunk → first lane
  SLOT_STEP: 270,    // lane → next lane on the same side (fits an outward label column)
  SLOT_PAD: 70,      // vertical clearance before a freed slot is reused
  FORK_RISE: 110,    // trunk → lane S-curve height
  MERGE_RISE: 100,   // lane → trunk S-curve height (finished repos)
  TAIL: 40,          // lane run after its last change before merging back
  NODE_GAP: 44,      // min distance between two nodes of one lane (2-line label)
  MR_OFFSET: 40,     // MR branch distance from its lane (outward), per parallel MR
  MR_TRACKS: 2,      // parallel MR branches per lane before they share a track
  MR_FORK: 26,
  MR_RUN: 30,        // branch length of an MR without known commits
  MR_MERGE: 26,
  PX_PER_DAY: 7,     // calendar gaps between active weeks
  MIN_GAP: 30,
  MAX_GAP: 190,
  START_RUN: 170,    // trunk before the first activity
  END_RUN: [170, 320],
  ROW_MIN: 24,
  PAD_TOP: 150,
  PAD_BOTTOM: 120,
  MARGIN_X: 70,
  LABEL_BUDGET: 250, // room for labels outside the outermost lane
};

const G = GEOMETRY;

const ITEM_ORDER = { created: 0, commit: 1, "mr-commit": 1, mr: 2 };

/** Everything a lane draws, in time order: main-line events, MR branch commits, MR merges. */
function laneItems(p, from) {
  const items = [];
  for (const e of p.events) {
    if (e.type === "mr") {
      for (const c of e.commits || []) items.push({ kind: "mr-commit", event: c, mr: e, t: Math.max(c.t, from) });
      items.push({ kind: "mr", event: e, mr: e, t: e.t });
    } else {
      items.push({ kind: e.type, event: e, t: e.t });
    }
  }
  return items.sort((a, b) => a.t - b.t || ITEM_ORDER[a.kind] - ITEM_ORDER[b.kind]);
}

/** Bucket items into weekly rows; inside a row, projects in order of first activity. */
function buildRows(projects, from, to) {
  const byWeek = new Map();
  for (const p of projects) {
    for (const it of laneItems(p, from)) {
      const w = weekStart(it.t);
      if (!byWeek.has(w)) byWeek.set(w, new Map());
      const row = byWeek.get(w);
      if (!row.has(p.id)) row.set(p.id, { project: p, items: [] });
      row.get(p.id).items.push(it);
    }
  }
  return [...byWeek.keys()].sort((a, b) => a - b).map((w) => ({
    t0: Math.max(w, from),
    t1: Math.min(w + 7 * DAY_MS, to),
    visits: [...byWeek.get(w).values()].sort(
      (a, b) => a.items[0].t - b.items[0].t || a.project.createdAt - b.project.createdAt
    ),
  }));
}

/** Piecewise-linear time ↔ height maps over monotonic anchors. */
function axisMaps(anchors) {
  const hAt = (t) => {
    if (t <= anchors[0].t) return anchors[0].h;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1], b = anchors[i];
      if (t <= b.t) return b.t === a.t ? b.h : a.h + ((t - a.t) / (b.t - a.t)) * (b.h - a.h);
    }
    return anchors[anchors.length - 1].h;
  };
  const tAt = (h) => {
    if (h <= anchors[0].h) return anchors[0].t;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1], b = anchors[i];
      if (h <= b.h) return b.h === a.h ? b.t : a.t + ((h - a.h) / (b.h - a.h)) * (b.t - a.t);
    }
    return anchors[anchors.length - 1].t;
  };
  return { hAt, tAt };
}

/** Slot order: right 1, left 1, right 2, left 2, … — lowest free slot wins. */
function assignSlots(lanes) {
  const slots = []; // slot → [{lo, hi}]
  for (const lane of [...lanes].sort((a, b) => a.forkH - b.forkH)) {
    const lo = lane.forkH - G.SLOT_PAD;
    const hi = lane.alive ? Infinity : lane.mergeH + G.SLOT_PAD;
    let s = 0;
    while ((slots[s] || []).some((r) => lo < r.hi && r.lo < hi)) s++;
    (slots[s] ||= []).push({ lo, hi });
    lane.slot = s;
    lane.side = s % 2 === 0 ? 1 : -1;
    lane.rank = Math.floor(s / 2);
  }
}

export function buildLayout(projects, [from, to]) {
  const rows = buildRows(projects, from, to);
  const lanes = new Map();
  const visits = [];
  const anchors = [{ t: from, h: 0 }];

  let h = 0;
  let prevT = from;
  rows.forEach((row, ri) => {
    const gapPx = ((row.t0 - prevT) / DAY_MS) * G.PX_PER_DAY;
    h += ri === 0 ? clamp(gapPx, G.START_RUN, G.START_RUN + G.MAX_GAP) : clamp(gapPx, G.MIN_GAP, G.MAX_GAP);
    row.h0 = h;
    anchors.push({ t: row.t0, h });
    let top = h + G.ROW_MIN;

    row.visits = row.visits.map((v) => {
      const p = v.project;
      let lane = lanes.get(p.id);
      const first = !lane;
      if (first) {
        lane = {
          project: p, forkH: h, startH: h + G.FORK_RISE, lastH: h + G.FORK_RISE, alive: !!p.alive,
          visits: [], nodes: [], branches: [], open: new Map(),
        };
        lanes.set(p.id, lane);
      }
      // One vertical sequence per lane: main-line nodes and MR-branch nodes take
      // turns, so no two labels of a lane ever share a height.
      let cur = first ? lane.startH : Math.max(h, lane.lastH + G.NODE_GAP);
      const nodes = [];
      const opened = [];
      for (const it of v.items) {
        if (it.kind !== "mr" && it.kind !== "mr-commit") {
          nodes.push({ event: it.event, lane, kind: it.kind, h: cur });
          lane.lastH = cur;
          cur += G.NODE_GAP;
          continue;
        }
        let b = lane.open.get(it.mr.id);
        if (!b) { // the MR branch forks off here
          const busy = new Set([...lane.open.values()].map((o) => o.track));
          const track = [...Array(G.MR_TRACKS).keys()].find((k) => !busy.has(k)) ?? G.MR_TRACKS - 1;
          b = { id: it.mr.id, event: it.mr, lane, track, h0: cur, h1: cur + G.MR_FORK, commits: [] };
          lane.open.set(b.id, b);
          lane.branches.push(b);
          opened.push(b);
          cur = b.h1;
        }
        if (it.kind === "mr-commit") {
          const node = { event: it.event, lane, kind: "mr-commit", branch: b, h: cur };
          b.commits.push(node);
          nodes.push(node);
          lane.lastH = cur;
          cur += G.NODE_GAP;
        } else {
          b.hTop = b.commits.length ? cur : b.h1 + G.MR_RUN;
          b.h3 = b.hTop + G.MR_MERGE;
          b.node = { event: it.event, lane, kind: "mr", branch: b, h: b.hTop };
          nodes.push(b.node);
          lane.open.delete(b.id);
          lane.lastH = b.h3;
          cur = b.h3 + G.NODE_GAP;
        }
      }
      lane.nodes.push(...nodes);
      const visit = {
        index: visits.length, row, lane, nodes, first, opened,
        h0: first ? lane.forkH : Math.min(...nodes.map((n) => n.h), ...opened.map((b) => b.h0)),
        h1: lane.lastH,
      };
      lane.visits.push(visit);
      visits.push(visit);
      top = Math.max(top, lane.lastH);
      return visit;
    });

    row.h1 = top;
    h = top;
    anchors.push({ t: row.t1, h });
    prevT = row.t1;
  });

  const endRun = clamp(((to - prevT) / DAY_MS) * G.PX_PER_DAY, G.END_RUN[0], G.END_RUN[1]);
  const hEnd = h + endRun;
  anchors.push({ t: Math.max(to, prevT), h: hEnd });

  for (const lane of lanes.values()) {
    lane.endH = lane.alive ? hEnd : lane.lastH + G.TAIL;
    lane.mergeH = lane.alive ? null : Math.min(lane.endH + G.MERGE_RISE, hEnd);
    lane.visits[lane.visits.length - 1].last = true;
  }
  assignSlots(lanes.values());

  // ---- horizontal extents ------------------------------------------------
  const laneList = [...lanes.values()];
  const maxRank = (side) => Math.max(-1, ...laneList.filter((l) => l.side === side).map((l) => l.rank));
  const reach = (side) => {
    const r = maxRank(side);
    return r < 0 ? 170 : G.FIRST_SLOT + r * G.SLOT_STEP + G.MR_OFFSET * G.MR_TRACKS + G.LABEL_BUDGET;
  };
  const trunkX = G.MARGIN_X + reach(-1);
  const width = Math.ceil(trunkX + reach(1) + G.MARGIN_X);
  const height = Math.ceil(G.PAD_TOP + hEnd + G.PAD_BOTTOM);
  const y = (hh) => G.PAD_TOP + (hEnd - hh);
  const { hAt, tAt } = axisMaps(anchors);

  // ---- SVG coordinates & paths ------------------------------------------
  const f = (n) => n.toFixed(1);
  const sCurve = (x0, h0, x1, h1) => {
    const ym = y((h0 + h1) / 2);
    return `M ${f(x0)} ${f(y(h0))} C ${f(x0)} ${f(ym)}, ${f(x1)} ${f(ym)}, ${f(x1)} ${f(y(h1))}`;
  };
  for (const lane of laneList) {
    lane.x = trunkX + lane.side * (G.FIRST_SLOT + lane.rank * G.SLOT_STEP);
    lane.forkD = sCurve(trunkX, lane.forkH, lane.x, lane.startH);
    lane.growD = `M ${f(lane.x)} ${f(y(lane.startH))} L ${f(lane.x)} ${f(y(lane.endH))}`;
    lane.mergeD = lane.alive ? null : sCurve(lane.x, lane.endH, trunkX, lane.mergeH);
    lane.labelX = lane.x + lane.side * 16;
    for (const b of lane.branches) {
      b.x = lane.x + lane.side * G.MR_OFFSET * (1 + b.track);
      b.forkD = sCurve(lane.x, b.h0, b.x, b.h1);
      b.runD = `M ${f(b.x)} ${f(y(b.h1))} L ${f(b.x)} ${f(y(b.hTop))}`;
      b.mergeD = sCurve(b.x, b.hTop, lane.x, b.h3);
      b.mergeY = y(b.h3);
    }
    for (const n of lane.nodes) {
      n.y = y(n.h);
      n.x = n.branch ? n.branch.x : lane.x;
      n.labelX = n.x + lane.side * 16;
    }
  }
  for (const v of visits) {
    const xs = [v.lane.x, ...v.nodes.map((n) => n.x), ...v.opened.map((b) => b.x)];
    const outer = v.lane.side > 0 ? Math.max(...xs) + 210 : Math.min(...xs) - 210;
    v.bbox = {
      x0: Math.min(...xs, outer, v.first ? trunkX : Infinity),
      x1: Math.max(...xs, outer, v.first ? trunkX : -Infinity),
      y0: y(v.h1) - 30,
      y1: y(v.h0) + 34,
    };
  }

  const months = [];
  const d0 = new Date(from);
  for (let m = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); m.getTime() <= to; m.setMonth(m.getMonth() + 1)) {
    const t = m.getTime();
    months.push({ t, y: y(hAt(t)), isYear: m.getMonth() === 0 });
  }

  return {
    from, to, width, height, trunkX, hEnd,
    y, hAt, tAt, yAt: (t) => y(hAt(t)), hOfY: (yy) => G.PAD_TOP + hEnd - yy,
    rows, visits, lanes: laneList, months,
    startY: y(0), endY: y(hEnd),
  };
}
