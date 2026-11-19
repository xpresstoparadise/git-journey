// SVG scene: builds the journey drawing from a layout once, then exposes
// small imperative handles (reveal trunk to h, grow a lane, pop a node, …).
// Nothing in here knows about timing — that is the cinema's job.

import { CONFIG } from "./config.js";
import { t, w } from "./i18n.js";
import { escapeHtml as esc, fmtDay, fmtMonthShort, truncate } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
const COMET_SEGMENTS = 18;
const COMET_MS = 320;      // how far back in time the tail reaches
const COMET_JUMP = 180;    // a move longer than this in one step is a cut, not motion
const SPARKS = 420;        // particle pool
const SPARK_LIFE = [420, 900]; // ms, ordinary sparks
const SPARKLER_LIFE = [140, 420]; // ms, sparkler sparks: short, fast, crackling
const SPARK_TINTS = ["hot", "gold", "", "hot", "gold"]; // white-hot, gold, star colour
const f = (n) => Number(n).toFixed(1);

function nodeLabel(n) {
  const e = n.event;
  const who = truncate(e.author, 20);
  const delta = e.additions != null
    ? ` · <tspan class="plus">+${e.additions}</tspan> <tspan class="minus">−${e.deletions ?? 0}</tspan>`
    : "";
  if (n.kind === "created") return { title: t("node.created"), meta: `${fmtDay(e.t)} · ${esc(who)}` };
  if (n.kind === "mr") {
    const k = e.commitCount ?? e.commits?.length ?? 0;
    const commits = k ? `${k} ${w(k, "commit")} · ` : "";
    // «feature/x → main» when the source branch is known, else «merged into main».
    const target = esc(e.target || n.lane?.project.defaultBranch || "main");
    const into = e.branch ? `${esc(truncate(e.branch, 32))} → ${target}` : t("node.merged", { target });
    return { title: `!${e.iid} ${truncate(e.title, 28)}`, meta: `${fmtDay(e.t)} · ${into} · ${commits}${esc(who)}` };
  }
  return { title: truncate(e.message || e.sha, 30), meta: `${fmtDay(e.t)}${delta} · ${esc(who)}` };
}

function nodeShape(n, color) {
  if (n.kind === "mr") {
    return `<rect class="shape" x="-6.5" y="-6.5" width="13" height="13" rx="2" transform="rotate(45)" />`;
  }
  if (n.kind === "created") {
    return `<circle class="halo" r="15" style="stroke:${color}" /><circle class="shape" r="8" />`;
  }
  if (n.kind === "mr-commit") return `<circle class="shape" r="4.5" />`;
  return `<circle class="shape" r="5.5" />`;
}

/** Size of a change in lines (MR without stats: by its commits). */
export function changeSize(e) {
  const lines = (e.additions || 0) + (e.deletions || 0);
  if (lines) return lines;
  if (e.type === "mr") return (e.commitCount ?? e.commits?.length ?? 1) * 40;
  return e.type === "created" ? 200 : 1;
}

/** 0…1 on a log scale, so a few giant commits don't flatten everything else. */
export function changeWeights(L) {
  const sizes = L.lanes.flatMap((l) => l.nodes.map((n) => changeSize(n.event)));
  const max = Math.log1p(Math.max(1, ...sizes));
  return (e) => Math.min(1, Math.log1p(changeSize(e)) / max);
}

/** Stable pseudo-random phase per node, so the map twinkles out of sync. */
function phase(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function buildMarkup(L, authorIdx) {
  const { width, height, trunkX } = L;
  const weight = changeWeights(L);
  const out = [];
  // Every <text> lives in a second, light SVG on top. Chrome re-lays out the whole
  // tree of an SVG root that holds text on each zoom step — with thousands of
  // shapes that was ~0.3 s per frame of a camera move on a big team.
  const tx = [];
  const labels = new Map(); // node id → label markup
  out.push(`<svg xmlns="${NS}" class="world" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${t("aria.world")}">`);
  out.push(`<style class="author-style"></style>`);

  // Grid: month guides across the whole world, labels hugging the trunk.
  out.push(`<g class="grid">`);
  tx.push(`<g class="grid">`);
  for (const m of L.months) {
    const label = m.isYear ? new Date(m.t).getFullYear() : fmtMonthShort(m.t);
    const cls = `month${m.isYear ? " year" : ""}`;
    out.push(`<g class="${cls}" data-y="${f(m.y)}"><line x1="0" x2="${width}" y1="${f(m.y)}" y2="${f(m.y)}" /></g>`);
    tx.push(`<g class="${cls}"><text x="${f(trunkX - 16)}" y="${f(m.y + 4)}" text-anchor="end">${label}</text></g>`);
  }
  out.push(`<g class="now-mark"><line x1="0" x2="${width}" y1="${f(L.endY)}" y2="${f(L.endY)}" /></g>`);
  tx.push(`<g class="now-mark"><text x="${f(trunkX)}" y="${f(L.endY - 16)}" text-anchor="middle">${t("now")}</text></g>`);
  out.push(`</g>`);
  tx.push(`</g>`);

  // Lanes and MR branches grow alongside the trunk (vertical lines, revealed by dash offset).
  out.push(`<g class="grow">`);
  for (const lane of L.lanes) {
    const c = lane.project.color;
    out.push(`<path class="lane-el lane-grow${lane.alive ? " alive" : ""}" data-pid="${esc(lane.project.id)}" d="${lane.growD}" style="--c:${c}" />`);
    for (const b of lane.branches) {
      out.push(`<path class="lane-el mr-run" data-pid="${esc(lane.project.id)}" data-bid="${esc(b.id)}" d="${b.runD}" />`);
    }
  }
  out.push(`</g>`);

  // Curves cross over lanes with a background halo → reads as an overpass.
  out.push(`<g class="curves">`);
  for (const lane of L.lanes) {
    const pid = esc(lane.project.id);
    const c = lane.project.color;
    for (const [cls, d] of [["fork", lane.forkD], ["merge", lane.mergeD]]) {
      if (!d) continue;
      out.push(`<path class="lane-el curve-halo ${cls}-halo" data-pid="${pid}" d="${d}" />`);
      out.push(`<path class="lane-el curve ${cls}" data-pid="${pid}" d="${d}" style="--c:${c}" />`);
    }
    for (const b of lane.branches) {
      const bid = esc(b.id);
      for (const [cls, d] of [["mr-fork", b.forkD], ["mr-merge", b.mergeD]]) {
        out.push(`<path class="lane-el curve-halo mr-halo ${cls}-halo" data-pid="${pid}" data-bid="${bid}" d="${d}" />`);
        out.push(`<path class="lane-el curve mr-branch ${cls}" data-pid="${pid}" data-bid="${bid}" d="${d}" />`);
      }
    }
  }
  out.push(`</g>`);

  // Trunk: soft under-glow + live line + look-ahead ghost.
  const trunkD = `M ${f(trunkX)} ${f(L.startY)} L ${f(trunkX)} ${f(L.endY)}`;
  out.push(`<g class="trunk">
    <path class="trunk-glow" d="${trunkD}" />
    <path class="trunk-line" d="${trunkD}" />
    <path class="trunk-ahead" d="M ${f(trunkX)} ${f(L.startY)} L ${f(trunkX)} ${f(L.startY)}" />
  </g>`);
  // The trunk is everyone's default branch — name the one most repos use.
  const branches = {};
  for (const l of L.lanes) branches[l.project.defaultBranch || "main"] = (branches[l.project.defaultBranch || "main"] || 0) + 1;
  const trunkBranch = Object.entries(branches).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "main";
  tx.push(`<g class="trunk"><text class="trunk-tag" x="${f(trunkX + 16)}" y="${f(L.startY)}">GitLab · ${esc(trunkBranch)}</text></g>`);

  // Nodes + labels (labels only show for the lane in focus, or on hover).
  out.push(`<g class="nodes">`);
  tx.push(`<g class="nodes">`);
  for (const lane of L.lanes) {
    const pid = esc(lane.project.id);
    const c = lane.project.color;
    const anchor = lane.side > 0 ? "start" : "end";
    for (const n of lane.nodes) {
      if (n.kind === "mr") {
        out.push(`<circle class="lane-el merge-bead" data-pid="${pid}" data-bid="${esc(n.branch.id)}" cx="${f(lane.x)}" cy="${f(n.branch.mergeY)}" r="3.6" />`);
      }
      const { title, meta } = nodeLabel(n);
      const lx = (n.labelX - n.x).toFixed(1);
      const w = weight(n.event);
      out.push(`<g class="lane-el node kind-${n.kind}" data-pid="${pid}" data-nid="${esc(n.event.id)}" data-a="${authorIdx.get(n.event.author)}" transform="translate(${f(n.x)} ${f(n.y)})" style="--c:${c};--w:${w.toFixed(3)};--ph:${(-phase(n.event.id) * 3).toFixed(2)}s">
        <g class="pop">${w > 0.55 ? `<circle class="spark" r="11" />` : ""}${nodeShape(n, c)}</g></g>`);
      // Labels are not in the DOM until needed (see createScene: showLabel).
      labels.set(n.event.id, `<g class="node-label" transform="translate(${f(n.x)} ${f(n.y)})" style="--c:${c}">
        <g class="label" text-anchor="${anchor}">
          <text class="t1" x="${lx}" y="-2">${esc(title)}</text>
          <text class="t2" x="${lx}" y="13">${meta}</text>
        </g></g>`);
    }
    // Name pill below the lane start, on the outer side (never between lanes).
    const name = truncate(lane.project.name, 26);
    const pw = Math.round(Math.min(230, name.length * 7.3 + 26));
    const px = lane.side > 0 ? lane.x + 14 : lane.x - 14 - pw;
    const py = L.y(lane.startH) + 22;
    out.push(`<g class="lane-el pill" data-pid="${pid}" style="--c:${c}">
      <rect x="${f(px)}" y="${f(py)}" width="${pw}" height="26" rx="13" />
      <circle cx="${f(px + 13)}" cy="${f(py + 13)}" r="4" /></g>`);
    tx.push(`<g class="lane-el pill" data-pid="${pid}" style="--c:${c}"><text x="${f(px + 23)}" y="${f(py + 17.5)}">${esc(name)}</text></g>`);
    // Map labels for the finale overview: vertical names along each lane.
    const vx = lane.x - lane.side * 18; // inner side: the outer one belongs to MR branches
    tx.push(`<text class="lane-el lane-name" data-pid="${pid}" style="--c:${c}" text-anchor="start"
      transform="translate(${f(vx)} ${f(L.y(lane.startH) - 12)}) rotate(-90)">${esc(lane.project.name)}</text>`);
    if (lane.alive) {
      out.push(`<g class="lane-el alive-tag" data-pid="${pid}" style="--c:${c}">
        <circle class="beacon" cx="${f(lane.x)}" cy="${f(L.endY)}" r="5" /></g>`);
      tx.push(`<g class="lane-el alive-tag" data-pid="${pid}" style="--c:${c}">
        <text text-anchor="end" transform="translate(${f(vx)} ${f(L.endY + 26)}) rotate(-90)">${esc(lane.project.name)}</text></g>`);
    }
  }
  out.push(`</g>`);

  out.push(`<g class="runner">`);
  // Comet tail: tapered segments along the recent path, a blurred copy underneath for the glow.
  out.push(`<defs><filter id="comet-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter></defs>`);
  const segs = Array.from({ length: COMET_SEGMENTS }, () => `<line x1="0" y1="0" x2="0" y2="0" />`).join("");
  out.push(`<g class="comet comet-glow" filter="url(#comet-blur)">${segs}</g><g class="comet comet-core">${segs}</g>`);
  // Sparks: a small pool of particles the star sheds as it travels.
  // Sparks are short streaks along their flight — tracers, not dots.
  out.push(`<g class="sparks">${Array.from({ length: SPARKS }, (_, i) => `<line class="${SPARK_TINTS[i % SPARK_TINTS.length]}" x1="0" y1="0" x2="0" y2="0" stroke-width="0" />`).join("")}</g>`);
  out.push(`<circle class="head-glow" r="16" cx="${f(trunkX)}" cy="${f(L.startY)}" /><circle class="head" r="6.5" cx="${f(trunkX)}" cy="${f(L.startY)}" />`);
  out.push(`</g></svg>`);
  tx.push(`</g><g class="node-labels"></g>`);
  out.push(`<svg xmlns="${NS}" class="world world-text" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${tx.join("")}</svg>`);
  return { html: out.join(""), labels };
}

/** Reveal helper for any path: draw the first `p` share of it. */
function revealer(path) {
  const len = Math.max(1, path.getTotalLength());
  path.style.strokeDasharray = `${len} ${len}`;
  path.style.strokeDashoffset = String(len);
  return {
    len,
    set(p) {
      path.style.strokeDashoffset = String(len * (1 - Math.min(1, Math.max(0, p))));
      return path.getPointAtLength(len * Math.min(1, Math.max(0, p)));
    },
  };
}

export function createScene(host, L) {
  const authorIdx = new Map();
  for (const lane of L.lanes) for (const n of lane.nodes) {
    if (!authorIdx.has(n.event.author)) authorIdx.set(n.event.author, authorIdx.size);
  }
  const { html, labels } = buildMarkup(L, authorIdx);
  host.innerHTML = html;
  host.style.width = `${L.width}px`;
  host.style.height = `${L.height}px`;
  const svg = host.querySelector("svg.world:not(.world-text)");
  const textSvg = host.querySelector("svg.world-text");
  const authorStyle = svg.querySelector(".author-style");
  const q = (sel) => svg.querySelector(sel);
  const qa = (sel) => [...svg.querySelectorAll(sel)];
  const qt = (sel) => [...textSvg.querySelectorAll(sel)];
  // State classes on the root apply to both layers.
  const rootToggle = (cls, on) => { svg.classList.toggle(cls, on); textSvg.classList.toggle(cls, on); };
  // One handle for a shape and its text twin (pill, alive tag).
  const pair = (els) => (els.length ? { classList: { add: (c) => els.forEach((e) => e.classList.add(c)) } } : null);

  const trunk = revealer(q(".trunk-line"));
  const trunkGlow = revealer(q(".trunk-glow"));
  const ahead = q(".trunk-ahead");
  const tag = textSvg.querySelector(".trunk-tag");
  const monthText = qt(".grid .month");
  const months = qa(".grid .month").map((el, i) => ({ el: pair([el, monthText[i]]), y: Number(el.dataset.y) }));

  // Lane elements by repo, for focus without touching the rest of the map.
  const byPid = new Map();
  for (const el of host.querySelectorAll(".lane-el")) {
    const pid = el.dataset.pid;
    if (!byPid.has(pid)) byPid.set(pid, []);
    byPid.get(pid).push(el);
  }
  let litPid = null;

  const lanes = new Map();
  for (const lane of L.lanes) {
    const sel = (cls) => svg.querySelector(`.${cls}[data-pid="${CSS.escape(lane.project.id)}"]`);
    const grow = sel("lane-grow");
    const growLen = Math.max(1, lane.endH - lane.startH);
    grow.style.strokeDasharray = `${growLen} ${growLen}`;
    grow.style.strokeDashoffset = String(growLen);
    const fork = sel("fork"), merge = sel("merge");
    lanes.set(lane.project.id, {
      lane,
      grown: 0,
      fork: revealer(fork), forkHalo: revealer(sel("fork-halo")),
      merge: merge ? revealer(merge) : null, mergeHalo: merge ? revealer(sel("merge-halo")) : null,
      pill: pair([...host.querySelectorAll(`.pill[data-pid="${CSS.escape(lane.project.id)}"]`)]),
      alive: pair([...host.querySelectorAll(`.alive-tag[data-pid="${CSS.escape(lane.project.id)}"]`)]),
      /** Show the lane up to height h (never shrinks). */
      growTo(h) {
        const v = Math.min(growLen, Math.max(this.grown, h - lane.startH));
        if (v === this.grown) return;
        this.grown = v;
        grow.style.strokeDashoffset = String(growLen - v);
      },
    });
  }

  const nodes = new Map();
  for (const el of qa(".node")) nodes.set(el.dataset.nid, { el });

  // Node labels exist only for the lane in focus and the node under the cursor.
  // Even display:none SVG <text> is re-laid out by Chrome on every zoom step, so
  // 2000 hidden labels cost ~0.3 s per frame of a camera move; a dozen cost nothing.
  const labelLayer = textSvg.querySelector(".node-labels");
  const labelEls = new Map();
  let hoverId = null;
  const nodeIdsByPid = new Map(L.lanes.map((l) => [l.project.id, l.nodes.map((n) => n.event.id)]));
  const isShown = (id) => nodes.get(id)?.el.classList.contains("shown");
  function showLabel(id, on) {
    const have = labelEls.get(id);
    if (on && !have && labels.has(id)) {
      const g = document.createElementNS(NS, "g");
      g.innerHTML = labels.get(id);
      const el = g.firstElementChild;
      labelLayer.appendChild(el);
      labelEls.set(id, el);
    } else if (!on && have) {
      have.remove();
      labelEls.delete(id);
    }
  }
  const pidOf = (id) => nodes.get(id)?.node?.lane?.project.id ?? nodes.get(id)?.el.dataset.pid;
  for (const lane of L.lanes) for (const n of lane.nodes) nodes.get(n.event.id).node = n;

  // MR branches: fork off the lane, run up through their commits, merge back.
  const branches = new Map();
  for (const lane of L.lanes) for (const b of lane.branches) {
    const sel = (cls) => svg.querySelector(`.${cls}[data-bid="${CSS.escape(b.id)}"]`);
    const run = sel("mr-run");
    const runLen = Math.max(1, b.hTop - b.h1);
    run.style.strokeDasharray = `${runLen} ${runLen}`;
    run.style.strokeDashoffset = String(runLen);
    branches.set(b.id, {
      b,
      grown: 0,
      fork: revealer(sel("mr-fork")), forkHalo: revealer(sel("mr-fork-halo")),
      merge: revealer(sel("mr-merge")), mergeHalo: revealer(sel("mr-merge-halo")),
      bead: sel("merge-bead"),
      growTo(h) {
        const v = Math.min(runLen, Math.max(this.grown, h - b.h1));
        if (v === this.grown) return;
        this.grown = v;
        run.style.strokeDashoffset = String(runLen - v);
      },
    });
  }

  const head = q(".runner .head");
  const headGlow = q(".runner .head-glow");
  const runnerG = q(".runner");
  const calm = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sparks = qa(".runner .sparks line").map((el) => ({ el, alive: false }));
  let sparkIdx = 0;
  let lastTick = performance.now();
  let emitDebt = 0;           // fractional sparks carried between frames
  let motion = { vx: 0, vy: 0, speed: 0 };
  let fade = null;            // { t0, ms } while the star goes out
  let runnerColor = null, sparklerTxt = null; // last values written to the runner group
  let glow = 0;               // 0 → 1 along the way: the star burns brighter as time goes on
  const fadeK = (now) => (fade ? Math.min(1, (now - fade.t0) / fade.ms) : 0);

  // How much of a sparkler the star is: none for most of the way, full at «настоящее».
  const sparklerness = () => (CONFIG.film.sparkler ? Math.min(1, Math.max(0, (glow - 0.62) / 0.33)) ** 1.5 : 0);

  function emit(x, y, now, k, opts = {}) {
    const sp = sparks[sparkIdx++ % sparks.length];
    const sparkler = opts.sparkler ?? Math.random() < sparklerness();
    let a, v, life, w;
    if (sparkler) {
      // Бенгальский огонь: every direction, fast, short-lived, thin and bright.
      a = opts.angle ?? Math.random() * Math.PI * 2;
      v = (opts.speed ?? 240 + Math.random() * 460);
      life = (opts.life ?? SPARKLER_LIFE[0] + Math.random() * (SPARKLER_LIFE[1] - SPARKLER_LIFE[0]));
      w = (opts.width ?? 0.8 + Math.random() * 1.2);
    } else {
      const dir = motion.speed > 1 ? Math.atan2(-motion.vy, -motion.vx) : Math.random() * Math.PI * 2; // backwards
      a = dir + (Math.random() - 0.5) * (motion.speed > 1 ? 1.6 : Math.PI * 2);
      v = (40 + Math.random() * 120) * (0.7 + glow * 0.7);
      life = SPARK_LIFE[0] + Math.random() * (SPARK_LIFE[1] - SPARK_LIFE[0]);
      w = (1.2 + Math.random() * 2) * (0.8 + glow * 0.8);
    }
    Object.assign(sp, {
      alive: true, x, y, t0: now, sparkler,
      vx: Math.cos(a) * v + (sparkler ? 0 : motion.vx * 0.15), vy: Math.sin(a) * v + (sparkler ? 0 : motion.vy * 0.15),
      life, w0: w * (1 - k * 0.6),
      forks: sparkler && !opts.child && Math.random() < 0.3, // will crackle into 2–3 tiny sparks
    });
  }
  const coreSegs = qa(".runner .comet-core line");
  const glowSegs = qa(".runner .comet-glow line");
  const history = []; // newest first: {x, y, t}
  let monthIdx = 0;

  return {
    svg, lanes, nodes, branches,

    /** Trunk drawn up to height h; living lanes and month marks follow. */
    trunkTo(h) {
      const p = h / L.hEnd;
      trunk.set(p);
      trunkGlow.set(p);
      const y = L.y(h);
      const aheadTop = Math.max(L.endY, y - 300);
      ahead.setAttribute("d", `M ${f(L.trunkX)} ${f(y)} L ${f(L.trunkX)} ${f(aheadTop)}`);
      tag.setAttribute("y", f(y + 4));
      while (monthIdx < months.length && months[monthIdx].y >= y - 60) months[monthIdx++].el.classList.add("shown");
      for (const rec of lanes.values()) {
        if (rec.started && !rec.ended) rec.growTo(h);
      }
      for (const rec of branches.values()) { // open MRs keep growing while time runs
        if (rec.started && !rec.ended) rec.growTo(h);
      }
    },

    runner(x, y, color) {
      const now = performance.now();
      // A cut (next visit, back to the trunk) must not drag the tail across the screen.
      if (history.length && Math.hypot(history[0].x - x, history[0].y - y) > COMET_JUMP) history.length = 0;
      if (!history.length || history[0].x !== x || history[0].y !== y) history.unshift({ x, y, t: now });
      else history[0].t = now;
      for (const el of [head, headGlow]) { el.setAttribute("cx", f(x)); el.setAttribute("cy", f(y)); }
      // On the runner group, never the <svg>: an inherited property set on the root
      // re-styles every element of the world (≈20k on a big team) at each colour change.
      if (color && color !== runnerColor) { runnerColor = color; runnerG.style.setProperty("--runner", color); }
    },

    /** Every frame: the tail follows the recent path and shrinks back when the runner rests. */
    tick() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTick) / 1000);
      lastTick = now;
      const k = fadeK(now);
      // ---- the star: shimmer, sparks, and going out at the end
      if (history.length) {
        const h0 = history[0];
        const prev = history[1];
        if (prev && now - h0.t < 120) {
          const span = Math.max(16, h0.t - prev.t) / 1000;
          motion = { vx: (h0.x - prev.x) / span, vy: (h0.y - prev.y) / span, speed: Math.hypot(h0.x - prev.x, h0.y - prev.y) / span };
        } else {
          motion = { vx: 0, vy: 0, speed: 0 };
        }
        const shimmer = Math.sin(now / 85) * 1.6 + Math.sin(now / 37) * 0.9;
        const sp = sparklerness();
        headGlow.setAttribute("r", ((16 + glow * 6 + sp * 10 + shimmer * (1 + glow + sp * 2)) * (1 - k * 0.85)).toFixed(2));
        const spTxt = sp.toFixed(3);
        if (spTxt !== sparklerTxt) { sparklerTxt = spTxt; runnerG.style.setProperty("--sparkler", spTxt); }
        head.setAttribute("r", (6.5 * (1 - k * 0.7)).toFixed(2));
        if (!calm && CONFIG.film.sparks && svg.classList.contains("runner-on")) {
          // moving: up to ~60 sparks/s by speed; resting: a rare twinkle
          const base = motion.speed > 5 ? Math.min(140, 20 + motion.speed * 0.15) : 7;
          // a steady sparkle in January, a shower later, a full sparkler at «настоящее»
          const rate = (base * (0.5 + glow * 1.8) + sparklerness() * 220) * (1 - k);
          emitDebt += rate * dt;
          while (emitDebt >= 1) { emitDebt -= 1; emit(h0.x, h0.y, now, k); }
        }
      }
      for (const sp of sparks) {
        if (!sp.alive) continue;
        const age = (now - sp.t0) / sp.life;
        if (age >= 1) { sp.alive = false; sp.el.setAttribute("stroke-width", "0"); continue; }
        if (sp.forks && age > 0.5) {
          // the crackle: one spark bursts into a few tiny ones
          sp.forks = false;
          const n = 2 + (Math.random() < 0.5 ? 1 : 0);
          const base = Math.atan2(sp.vy, sp.vx);
          for (let i = 0; i < n; i++) {
            emit(sp.x, sp.y, now, k, {
              sparkler: true, child: true,
              angle: base + (Math.random() - 0.5) * 2.2,
              speed: 80 + Math.random() * 160, life: 90 + Math.random() * 160, width: 0.5 + Math.random() * 0.6,
            });
          }
        }
        const drag = sp.sparkler ? 3.2 : 2.2;
        sp.vx *= 1 - drag * dt; sp.vy = sp.vy * (1 - drag * dt) + (sp.sparkler ? 140 : 60) * dt; // drag + a little fall
        sp.x += sp.vx * dt; sp.y += sp.vy * dt;
        const streak = sp.sparkler ? 0.07 : 0.022; // seconds of flight drawn as the tracer
        sp.el.setAttribute("x1", f(sp.x));
        sp.el.setAttribute("y1", f(sp.y));
        sp.el.setAttribute("x2", f(sp.x - sp.vx * streak));
        sp.el.setAttribute("y2", f(sp.y - sp.vy * streak));
        sp.el.setAttribute("stroke-width", (sp.w0 * (1 - age * 0.7)).toFixed(2));
        sp.el.setAttribute("opacity", ((1 - age) ** 1.2).toFixed(3));
      }
      const cometMs = COMET_MS * (0.7 + glow * 0.8);
      while (history.length > 1 && now - history[history.length - 1].t > cometMs) history.pop();
      // Sample the path every COMET_MS / N ms of age, newest first.
      const pts = [];
      if (history.length) {
        pts.push(history[0]);
        let j = 0;
        for (let k = 1; k <= COMET_SEGMENTS; k++) {
          const age = (cometMs * k) / COMET_SEGMENTS;
          while (j < history.length - 1 && now - history[j + 1].t < age) j++;
          if (j >= history.length - 1) break;
          const a = history[j], b = history[j + 1];
          const u = Math.min(1, Math.max(0, (now - age - b.t) / Math.max(1, a.t - b.t)));
          pts.push({ x: b.x + (a.x - b.x) * u, y: b.y + (a.y - b.y) * u });
        }
        if (pts.length === 1 || history.length > 1) pts.push(history[history.length - 1]);
      }
      for (let i = 0; i < COMET_SEGMENTS; i++) {
        const a = pts[i], b = pts[i + 1];
        const k = 1 - i / COMET_SEGMENTS; // 1 at the head → 0 at the tip
        for (const [el, w, o] of [[coreSegs[i], 6.5 * k, 0.85 * k], [glowSegs[i], 14 * k, 0.5 * k]]) {
          if (!a || !b || (a.x === b.x && a.y === b.y)) { el.setAttribute("stroke-opacity", "0"); continue; }
          el.setAttribute("x1", f(a.x)); el.setAttribute("y1", f(a.y));
          el.setAttribute("x2", f(b.x)); el.setAttribute("y2", f(b.y));
          el.setAttribute("stroke-width", w.toFixed(2));
          el.setAttribute("stroke-opacity", o.toFixed(3));
        }
      }
    },
    runnerVisible(on) {
      svg.classList.toggle("runner-on", !!on);
      if (on) { fade = null; runnerG.style.removeProperty("opacity"); runnerG.style.removeProperty("transition"); }
    },

    /** How far along the way the star is (0…1): sparks, glow and tail grow with it. */
    setGlow(v) { glow = Math.min(1, Math.max(0, v)); },

    /** The star goes out: fewer sparks, the glow shrinks, then darkness. */
    runnerFade(ms = 2400) {
      if (fade) return;
      fade = { t0: performance.now(), ms };
      runnerG.style.transition = `opacity ${ms}ms cubic-bezier(0.5, 0, 0.75, 0)`;
      requestAnimationFrame(() => { runnerG.style.opacity = "0"; });
    },

    /** Dim everything except one lane (null → no focus). Only the old and the
     *  new lane's elements change class: re-styling the whole map per visit is
     *  what made big teams (thousands of nodes) stutter on every camera move. */
    focus(pid) {
      rootToggle("focusing", pid != null);
      if (pid === litPid) return;
      for (const el of byPid.get(litPid) ?? []) el.classList.remove("lit");
      for (const id of nodeIdsByPid.get(litPid) ?? []) if (id !== hoverId) showLabel(id, false);
      for (const el of byPid.get(pid) ?? []) el.classList.add("lit");
      for (const id of nodeIdsByPid.get(pid) ?? []) if (isShown(id)) showLabel(id, true);
      litPid = pid;
    },

    /** The node under the cursor shows its label (null → none). */
    hover(id) {
      if (id === hoverId) return;
      if (hoverId != null && pidOf(hoverId) !== litPid) showLabel(hoverId, false);
      hoverId = id;
      if (id != null && isShown(id)) showLabel(id, true);
    },

    showNode(id) {
      const rec = nodes.get(id);
      rec?.el.classList.add("shown");
      if (rec && litPid != null && pidOf(id) === litPid) showLabel(id, true);
      return rec;
    },

    /** Final state at once (skip / reduced motion). */
    revealAll() {
      trunk.set(1);
      trunkGlow.set(1);
      ahead.setAttribute("d", "M 0 0");
      tag.setAttribute("y", f(L.endY + 4));
      months.forEach((m) => m.el.classList.add("shown"));
      for (const rec of lanes.values()) {
        rec.fork.set(1); rec.forkHalo.set(1);
        rec.started = true;
        rec.growTo(Infinity);
        rec.merge?.set(1); rec.mergeHalo?.set(1);
        rec.ended = !rec.lane.alive;
        rec.pill?.classList.add("shown");
        rec.alive?.classList.add("shown");
      }
      for (const rec of nodes.values()) rec.el.classList.add("shown");
      for (const rec of branches.values()) {
        for (const r of [rec.fork, rec.forkHalo, rec.merge, rec.mergeHalo]) r.set(1);
        rec.started = rec.ended = true;
        rec.growTo(Infinity);
        rec.bead?.classList.add("shown");
      }
    },

    setFinale(on) { rootToggle("finale", !!on); },

    /** One person's way: their nodes stay lit, their lanes stay bright, the rest fades. */
    highlightAuthor(name) {
      const i = name == null ? undefined : authorIdx.get(name);
      rootToggle("author-focus", i !== undefined);
      if (i === undefined) { authorStyle.textContent = ""; return null; }
      const lanes = L.lanes.filter((l) => l.nodes.some((n) => n.event.author === name));
      authorStyle.textContent = `
        svg.world.author-focus .node[data-a="${i}"] { --dim: 1; }
        svg.world.author-focus .node:not([data-a="${i}"]) { --dim: 0.3 !important; }
        svg.world.author-focus .node[data-a="${i}"] .pop { filter: drop-shadow(0 0 10px var(--c)); }
        ${lanes.map((l) => `svg.world.author-focus .lane-el:not(.node)[data-pid="${CSS.escape(l.project.id)}"] { --dim: 0.85; }`).join("\n")}`;
      const nodes = lanes.flatMap((l) => l.nodes.filter((n) => n.event.author === name));
      if (!nodes.length) return null;
      const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
      return { x0: Math.min(...xs) - 120, x1: Math.max(...xs) + 120, y0: Math.min(...ys) - 120, y1: Math.max(...ys) + 120, count: nodes.length, lanes: lanes.length };
    },
  };
}
