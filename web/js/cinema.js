// The show: trunk runs up through time, forks into each repo at its first
// change, the camera stops on visits and reveals that week's history,
// finished repos merge back, living ones keep running parallel to the trunk.
// Ends with a fly-over of the whole way and the author leaderboard.
//
// Two cuts of the same film:
//   «Главное» — stops only at key visits (births, merges, MRs, big diffs);
//               the rest lights up in the background as the trunk flies by.
//   «Полностью» — stops at every visit.

import { CONFIG } from "./config.js";
import { authorSummary, withBranchCommits } from "./data.js";
import { t, w } from "./i18n.js";
import { flightPlan, visitFrame } from "./framing.js";
import { keyVisits, specialPlays } from "./story.js";
import { clamp, fmtDay, fmtInt, fmtMonthName, lerp, truncate } from "./util.js";

const FULL = {            // milliseconds at 1×
  TRUNK_PX_PER_S: 560,
  TRUNK_MIN: 260,
  TRUNK_MAX: 2400,
  FORK: 620,
  CAMERA: 720,
  VISIT_BUDGET: 1700,     // reveal time per visit, split between its nodes
  NODE_MIN: 80,
  NODE_MAX: 300,
  MR: 520,
  HOLD: 320,
  MERGE: 640,
  FLYOVER: 5200,
};
const HIGHLIGHTS = {
  ...FULL,
  TRUNK_PX_PER_S: 1000,
  TRUNK_MAX: 1800,
  FORK: 500,
  CAMERA: 620,
  VISIT_BUDGET: 900,
  NODE_MIN: 20,
  MR: 300,
  HOLD: 160,
  MERGE: 480,
  FLYOVER: 4600,
};
export const HIGHLIGHT_STOPS = Math.max(1, Math.round(CONFIG.film.highlightStops));
export const MODES = { highlights: HIGHLIGHTS, full: FULL };

// Narrow screens may pull back further so outward labels stay on screen.
const narrow = () => typeof document !== "undefined" && (document.querySelector(".stage")?.clientWidth ?? 1e9) <= 760;
const ZOOM = { RUN: 1.05, FORK: 1.15, VISIT_MAX: 1.15, get VISIT_MIN() { return narrow() ? 0.5 : 0.85; } };
const ACCENT = CONFIG.film.accent || "#3dd6c6";
const MR_COLOR = "#8fb0ff";
const FAREWELL_MS = CONFIG.film.farewellSeconds * 1000; // real time on screen for a «Good bye» card
const STAR_FADE_MS = 2600; // real time for the runner to go out at the end
const CARD_MIN_MS = CONFIG.film.cardMinSeconds * 1000;  // real time a repo card stays before the next one replaces it

export function createCinema({ L, scene, camera, hud, player, projects, dataset, period, periodLabel, mode = "highlights", person = null, onVisit = null }) {
  const T = MODES[mode] || HIGHLIGHTS;
  const stops = person
    ? keyVisits(L.visits, { person })
    : mode === "full" ? null : keyVisits(L.visits, { max: HIGHLIGHT_STOPS });
  const isStop = (v) => !stops || stops.has(v.index);

  let tipH = 0;
  let cardPid = null;
  let current = null;     // { project, side, events[] } — what the focus card shows
  const background = [];  // non-stop visits waiting for the trunk to pass them

  const sec = (ms) => ms / player.speed; // real-time duration for camera moves
  const runnerAt = (x, y, color = ACCENT) => scene.runner(x, y, color);

  let month = -1;
  function chapterFor(t) {
    const d = new Date(t);
    const m = d.getFullYear() * 12 + d.getMonth();
    if (month !== -1 && m !== month) hud.chapter(fmtMonthName(t), String(d.getFullYear()));
    month = m;
  }

  /** Show a visit's result at once (seek, background visits). */
  function applyVisit(v) {
    const rec = scene.lanes.get(v.lane.project.id);
    if (v.first) {
      rec.started = true;
      rec.fork.set(1);
      rec.forkHalo.set(1);
      rec.pill?.classList.add("shown");
    }
    for (const node of v.nodes) {
      scene.showNode(node.event.id);
      const br = node.branch && scene.branches.get(node.branch.id);
      if (br && !br.started) {
        br.started = true;
        br.fork.set(1);
        br.forkHalo.set(1);
      }
      if (node.kind === "mr") {
        br.growTo(node.branch.hTop);
        br.merge.set(1);
        br.mergeHalo.set(1);
        br.ended = true;
        br.bead?.classList.add("shown");
        rec.growTo(node.branch.h3);
      } else if (br) {
        br.growTo(node.h);
      } else {
        rec.growTo(node.h);
      }
    }
    if (v.last && !v.lane.alive) {
      rec.growTo(v.lane.endH);
      rec.ended = true;
      rec.merge.set(1);
      rec.mergeHalo.set(1);
    }
  }

  function flushBackground() {
    while (background.length && background[0].row.h0 <= tipH + 1) applyVisit(background.shift());
  }

  async function trunkTo(h, zoom = ZOOM.RUN) {
    if (h <= tipH + 0.5) { flushBackground(); return; }
    const from = tipH;
    const ms = clamp(((h - from) / T.TRUNK_PX_PER_S) * 1000, T.TRUNK_MIN, T.TRUNK_MAX);
    await player.tween(ms, (p) => {
      tipH = lerp(from, h, p);
      const y = L.y(tipH);
      scene.trunkTo(tipH);
      scene.setGlow(tipH / L.hEnd);
      flushBackground();
      runnerAt(L.trunkX, y);
      camera.follow(L.trunkX, y, zoom, { ay: 0.66, lag: 0.14 });
      hud.clock(L.tAt(tipH));
      chapterFor(L.tAt(tipH));
    });
  }

  // A card must be readable — also in a recorded video: it stays at least
  // CARD_MIN_MS of *real* time before the next repo may replace it.
  let cardAt = 0;
  const markCard = () => { cardAt = performance.now(); };
  async function holdCard() {
    if (!hud.cardOpen || !cardAt) return;
    const left = CARD_MIN_MS - (performance.now() - cardAt);
    if (left > 0) await player.wait(left * player.speed);
  }

  async function openFocus(project, side) {
    if (cardPid === project.id && hud.cardOpen && hud.intent.side === side) return;
    await holdCard();
    const flips = hud.cardOpen && hud.intent.side !== side; // the card glides across first (~0.3 s)
    hud.focus(project, { side, period: periodLabel });
    markCard();
    if (flips) cardAt += 320;
    cardPid = project.id;
    current = { project, side, events: [] };
  }

  let pendingSpecial = null;
  function reveal(rec, project) {
    const e = rec.node.event;
    if (specialPlays(rec.node, person)) pendingSpecial = rec.node;
    scene.showNode(e.id);
    hud.pushHistory(project, e);
    current?.events.push(e);
    hud.clock(e.t);
  }

  async function playVisit(v) {
    onVisit?.(v);
    try { await visit(v); } finally { onVisit?.(null); }
  }

  async function visit(v) {
    const lane = v.lane;
    const p = lane.project;
    const rec = scene.lanes.get(p.id);
    const side = lane.side > 0 ? "left" : "right"; // card opposite the lane → never covers it
    const n = v.nodes.length;

    await openFocus(p, side); // may hold the previous card a little longer first
    scene.focus(p.id);
    hud.idle(false);
    hud.caption(
      t(v.first ? "cap.newRoad" : "cap.again", { name: p.name }),
      t("cap.week", { n, changes: w(n, "change"), day: fmtDay(v.row.t0) }) + (p.alive ? t("cap.alive") : "")
    );

    if (v.first) {
      rec.started = true;
      rec.pill?.classList.add("shown");
      // A lane far out to the side: pull back and take a little longer, so
      // the camera keeps the star in frame instead of chasing it off screen.
      const fly = flightPlan(lane.x - L.trunkX, camera.safeRect().width, { z: ZOOM.FORK, minZ: ZOOM.VISIT_MIN * 0.55 });
      await player.tween(T.FORK * fly.slow, (k) => {
        const pt = rec.fork.set(k);
        rec.forkHalo.set(k);
        runnerAt(pt.x, pt.y, p.color);
        camera.follow(pt.x, pt.y, fly.z, { ay: 0.6, lag: fly.slow > 1 ? 0.14 : 0.2 });
      });
    }

    // Short visit → frame it whole. Long one → readable zoom, start at its
    // bottom and let the camera ride up the lane with each revealed node.
    // A lane too far from the trunk to show both: the lane wins.
    const { box, z, tall, winH } = visitFrame(v, camera.safeRect(), { minZ: ZOOM.VISIT_MIN, maxZ: ZOOM.VISIT_MAX });
    camera.frame(box, { ms: sec(T.CAMERA), minZ: ZOOM.VISIT_MIN, maxZ: ZOOM.VISIT_MAX });
    await player.wait(T.CAMERA * 0.8);
    const perNode = clamp(T.VISIT_BUDGET / Math.max(1, n), T.NODE_MIN, T.NODE_MAX);

    for (const node of v.nodes) {
      await playSpecial();
      const nodeRec = scene.nodes.get(node.event.id);
      if (tall && node.y < box.y0 + winH * 0.45) {
        camera.follow((box.x0 + box.x1) / 2, node.y, z, { ay: 0.45, lag: 0.35 });
      }
      const b = node.branch;
      if (!b) {
        rec.growTo(node.h);
        runnerAt(node.x, node.y, p.color);
        reveal(nodeRec, p);
        await player.wait(perNode);
        continue;
      }

      // MR branch: fork off the lane on its first appearance…
      const br = scene.branches.get(b.id);
      if (!br.started) {
        br.started = true;
        rec.growTo(b.h0);
        const be = b.event;
        hud.caption(
          be.branch ? t("cap.branchNamed", { branch: truncate(be.branch, 40), name: p.name }) : t("cap.branch", { iid: be.iid, name: p.name }),
          truncate(`${be.branch ? `!${be.iid} ` : ""}${be.title || ""}`, 70),
        );
        await player.tween(T.MR, (k) => {
          const pt = br.fork.set(k);
          br.forkHalo.set(k);
          runnerAt(pt.x, pt.y, MR_COLOR);
        });
      }
      if (node.kind === "mr-commit") {
        // …its commits light up one by one as the branch grows…
        await player.tween(Math.min(perNode, 220), (k) => {
          const hh = lerp(Math.max(b.h1, br.grown + b.h1), node.h, k);
          br.growTo(hh);
          runnerAt(b.x, L.y(hh), MR_COLOR);
        });
        reveal(nodeRec, p);
        await player.wait(perNode * 0.5);
        continue;
      }
      // …then the diamond, and the branch pours back into the lane.
      br.growTo(b.hTop);
      runnerAt(b.x, node.y, MR_COLOR);
      reveal(nodeRec, p);
      await player.wait(perNode * 0.6);
      await player.tween(T.MR, (k) => {
        const pt = br.merge.set(k);
        br.mergeHalo.set(k);
        runnerAt(pt.x, pt.y, MR_COLOR);
      });
      br.ended = true;
      br.bead?.classList.add("shown");
      rec.growTo(b.h3);
      const kc = b.event.commitCount ?? b.commits.length;
      const be = b.event;
      hud.caption(
        be.branch ? t("cap.mergedNamed", { branch: truncate(be.branch, 40), target: be.target || p.defaultBranch || "main" }) : t("cap.merged", { iid: be.iid, name: p.name }),
        `${be.branch ? `!${be.iid} · ` : ""}${kc ? `${kc} ${w(kc, "commit")} · ` : ""}${fmtDay(be.t)}`,
      );
      await player.wait(perNode * 0.5);
    }

    await playSpecial();

    if (v.last && !lane.alive) {
      hud.caption(t("cap.repoDone", { name: p.name }), t("cap.repoDoneLine"));
      rec.growTo(lane.endH);
      rec.ended = true;
      const fly = flightPlan(lane.x - L.trunkX, camera.safeRect().width, { z: ZOOM.FORK, minZ: ZOOM.VISIT_MIN * 0.55 });
      await player.tween(T.MERGE * fly.slow, (k) => {
        const pt = rec.merge.set(k);
        rec.mergeHalo.set(k);
        runnerAt(pt.x, pt.y, p.color);
        camera.follow(pt.x, pt.y, fly.z, { ay: 0.5, lag: fly.slow > 1 ? 0.16 : 0.25 });
      });
    } else {
      await player.wait(T.HOLD);
    }
  }

  /** Overview: fit the world's width, fly from the first week up to «настоящее». */
  async function flyover({ animate }) {
    const safe = camera.safeRect();
    const z = clamp(camera.fitZoom({ x0: 0, x1: L.width, y0: 0, y1: 1 }, 24), 0.08, 0.9);
    const winH = safe.height / z;
    const box = (yTop) => ({ x0: 0, x1: L.width, y0: yTop, y1: yTop + winH });
    const topBox = box(Math.max(0, L.endY - 90));
    if (!animate) { camera.frame(topBox, { ms: 0, minZ: 0.02, maxZ: 1, pad: 24 }); return; }
    camera.frame(box(Math.max(0, L.startY + 60 - winH)), { ms: sec(1400), minZ: 0.02, maxZ: 1, pad: 24 });
    await player.wait(1500);
    camera.frame(topBox, { ms: sec(T.FLYOVER), minZ: 0.02, maxZ: 1, pad: 24 });
    await player.wait(T.FLYOVER);
  }

  const authors = authorSummary(projects, { dataset, period });

  // ---- special scenes: «Journey: finish» and «Journey: goodbye» ----------------
  async function playSpecial() {
    const node = pendingSpecial;
    pendingSpecial = null;
    if (!node) return;
    if (node.event.special === "finish") await finishScene(node);
    else await goodbyeScene(node);
  }

  async function finishScene(node) {
    const p = node.lane.project;
    const all = withBranchCommits(p.events);
    const people = [...new Set(all.map((e) => e.author))];
    // Frame the node *and* its outward label, so a narrow (9:16) stage doesn't clip it.
    const side = node.lane.side;
    const xs = [node.x - side * 60, node.x + side * 280];
    camera.frame({ x0: Math.min(...xs), x1: Math.max(...xs), y0: node.y - 130, y1: node.y + 130 }, { ms: sec(700), minZ: ZOOM.VISIT_MIN, maxZ: 1.5 });
    await player.wait(600);
    hud.chapter(t("cap.congrats"), t("cap.congratsSub", { name: p.name }), { big: true, tone: "gold" });
    hud.confetti([p.color, "#e8c96a", "#3dd6c6", "#ffffff"]);
    markCard();
    hud.finishCard(p, {
      from: all[0]?.t ?? p.createdAt, to: node.event.t, people,
      commits: all.filter((e) => e.type === "commit").length, mrs: all.filter((e) => e.type === "mr").length,
      note: node.event.note,
    }, { side: node.lane.side > 0 ? "left" : "right" });
    hud.caption(t("cap.projectDone", { name: p.name }), node.event.note || t("cap.crewThanks", { n: people.length, people: w(people.length, "person") }));
    cardPid = null; // next visit re-opens the regular card
    await player.wait(4200);
  }

  async function goodbyeScene(node) {
    const name = node.event.author;
    const mine = projects.flatMap((p) => withBranchCommits(p.events)).filter((e) => e.author === name);
    const row = authors.find((a) => a.name === name);
    scene.highlightAuthor(name);
    const zFit = clamp(camera.fitZoom({ x0: 0, x1: L.width, y0: 0, y1: 1 }, 24), 0.08, 0.9);
    const winH = camera.safeRect().height / zFit;
    camera.frame({ x0: 0, x1: L.width, y0: node.y - winH * 0.6, y1: node.y + winH * 0.4 }, { ms: sec(1400), minZ: 0.05, maxZ: 1, pad: 24 });
    await player.wait(900);
    hud.caption(t("cap.goodbye", { name }), node.event.note || t("cap.goodbyeLine"));
    hud.farewell({
      name,
      note: node.event.note,
      first: Math.min(...mine.map((e) => e.t)),
      last: node.event.t,
      commits: row?.commits ?? mine.filter((e) => e.type === "commit").length,
      mrs: row?.mrs ?? mine.filter((e) => e.type === "mr").length,
      repos: row?.projects ?? new Set(projects.filter((p) => withBranchCommits(p.events).some((e) => e.author === name)).map((p) => p.id)).size,
    }, { holdMs: FAREWELL_MS });
    // A goodbye is not hurried: 15 real seconds whatever the playback speed
    // (pause still pauses), unless the viewer clicks on / presses Enter.
    await Promise.race([player.wait(FAREWELL_MS * player.speed), hud.farewellDismissed()]);
    hud.farewell(null);
    await player.wait(900); // let the card fade before the camera moves on
    scene.highlightAuthor(person);
    await player.wait(500);
  }

  async function finale({ animate = true } = {}) {
    scene.focus(null);
    scene.revealAll();
    scene.runnerFade(600); // skipped straight here: a short fade instead of a cut
    scene.runnerVisible(false);
    scene.setFinale(true);
    hud.clock(L.to);
    const marks = projects.flatMap((p) => withBranchCommits(p.events)).filter((e) => e.special);
    let personInfo = null;
    if (person) {
      const repos = projects
        .map((p) => ({ name: p.name, color: p.color, count: withBranchCommits(p.events).filter((e) => e.author === person).length }))
        .filter((r) => r.count)
        .sort((a, b) => b.count - a.count);
      const ts = projects.flatMap((p) => withBranchCommits(p.events)).filter((e) => e.author === person).map((e) => e.t);
      if (ts.length) personInfo = { first: Math.min(...ts), last: Math.max(...ts), repos: repos.slice(0, 8) };
    }
    hud.finale(authors, projects, periodLabel, {
      farewells: new Set(marks.filter((e) => e.special === "goodbye").map((e) => e.author)),
      finished: projects.filter((p) => p.finish).length,
      person, personInfo,
    });
    cardPid = null;
    current = null;
    const alive = projects.filter((p) => p.alive).length;
    const me = person && authors.find((a) => a.name === person);
    if (me) hud.caption(t("cap.personRoad", { name: me.name }), t("cap.personLine", { c: me.commits, m: me.mrs, a: fmtInt(me.add), d: fmtInt(me.del) }));
    else hud.caption(t("cap.team"), t("cap.teamLine", { p: projects.length, alive, n: authors.length, authors: w(authors.length, "author") }));
    await flyover({ animate });
  }

  return {
    get current() { return current; },
    authors,
    mode,
    stopCount: stops ? stops.size : L.visits.length,

    /** Play from the start, or from row `fromRow` with everything before it already drawn. */
    async play({ fromRow = 0 } = {}) {
      scene.runnerVisible(true);
      fromRow = clamp(fromRow, 0, Math.max(0, L.rows.length - 1));
      if (fromRow > 0) {
        for (const row of L.rows.slice(0, fromRow)) row.visits.forEach(applyVisit);
        tipH = Math.max(0, L.rows[fromRow].h0 - 120);
        scene.trunkTo(tipH);
      }
      const t0 = L.tAt(tipH);
      scene.setGlow(tipH / L.hEnd);
      month = new Date(t0).getFullYear() * 12 + new Date(t0).getMonth();
      runnerAt(L.trunkX, L.y(tipH));
      camera.snap(L.trunkX, L.y(tipH), ZOOM.RUN, { ay: 0.66 });
      hud.clock(t0);
      scene.highlightAuthor(person);
      if (fromRow === 0) {
        hud.chapter(person ? person : t("chapter.title"), person ? t("cap.personStart", { period: periodLabel }) : t("chapter.sub", { period: periodLabel, p: projects.length }), { big: true });
        hud.caption(t("cap.start"), t("cap.startLine", { period: periodLabel, p: projects.length, mode: t(mode === "full" ? "cap.modeFull" : "cap.modeHighlights") }));
        await player.wait(1600);
      } else {
        hud.chapter(fmtMonthName(t0), String(new Date(t0).getFullYear()));
        hud.caption(t("cap.seek"), t("cap.seekLine", { day: fmtDay(L.rows[fromRow].t0) }));
        await player.wait(500);
      }

      for (const row of L.rows.slice(fromRow)) {
        background.push(...row.visits.filter((v) => !isStop(v)));
        if (!row.visits.some(isStop)) continue; // fly past — the next trunk run lights these up
        if (row.h0 > tipH + 60) {
          // The last lane stays lit while the trunk runs on: un-dimming the whole
          // map and dimming it back costs a full restyle twice per stop.
          hud.idle(true); // card stays where it is (no flicker), just steps back
          hud.caption(t("cap.trunk"), t("cap.trunkLine", { day: fmtDay(row.t0), n: row.visits.length }));
        }
        await trunkTo(row.h0);
        for (const v of row.visits) {
          if (isStop(v)) await playVisit(v);
        }
      }

      await holdCard();
      scene.focus(null);
      hud.closeCard();
      cardPid = null;
      hud.caption(t("cap.toNow"), t("cap.toNowLine"));
      hud.chapter(t("cap.now"), t("cap.nowSub", { n: projects.filter((p) => p.alive).length }));
      await trunkTo(L.hEnd, 0.9);
      flushBackground();
      // The way is walked: the star lingers at «настоящее» and slowly goes out.
      hud.caption(t("cap.walked"), t("cap.walkedLine"));
      scene.runnerFade(STAR_FADE_MS);
      await player.wait(STAR_FADE_MS * player.speed);
      await finale({ animate: true });
    },

    finale,
  };
}
