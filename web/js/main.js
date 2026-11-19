// Wiring: data → layout → scene → cinema, plus controls, keyboard, resize,
// presentation/recording and the "fresh export available" check.

import { CONFIG } from "./config.js";
import { createCamera } from "./camera.js";
import { createCinema } from "./cinema.js";
import { eventIndex, loadDataset, periodBounds, periodOptions, sliceProjects } from "./data.js";
import { createHud } from "./hud.js";
import { buildLayout } from "./layout.js";
import { MOCK_META, MOCK_RAW } from "./mock.js";
import { Cancelled, createPlayer } from "./player.js";
import { LETTERBOX, RECORD_PRESETS, canRecord, createPresenter, startRecording } from "./present.js";
import { createScene } from "./scene.js";
import { LANG, setLang, t, translateDom, w } from "./i18n.js";
import { clamp, fmtDate, fmtDay } from "./util.js";

const $ = (sel) => document.querySelector(sel);
const SPEEDS = [1, 2, 4];
const MODES = ["highlights", "full"];
const FRESH_CHECK_MS = 5 * 60 * 1000;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadAliases() {
  try {
    const r = await fetch("data/authors.json", { cache: "no-store" });
    return r.ok ? await r.json() : {};
  } catch {
    return {};
  }
}

function applyConfig() {
  if (CONFIG.title) {
    document.title = CONFIG.title;
    $(".brand h1").textContent = CONFIG.title;
  }
  if (!CONFIG.film.grain) document.body.classList.add("no-grain");
  if (CONFIG.film.accent) document.documentElement.style.setProperty("--accent", CONFIG.film.accent);
}

function boot(dataset, live) {
  translateDom();
  applyConfig();
  const langBtn = $("#lang");
  langBtn.textContent = LANG === "ru" ? "EN" : "RU";
  langBtn.addEventListener("click", () => setLang(LANG === "ru" ? "en" : "ru"));
  const hud = createHud();
  hud.setAvatars(dataset.avatars);
  const viewport = $("#viewport");
  const canvas = $("#canvas");
  const params = new URL(location.href).searchParams;
  // ?debug — a small overlay with the numbers that matter on big teams (fps,
  // world size, DOM, off-screen visits). Screenshot it when reporting a problem.
  const debug = params.has("debug") ? createDebug() : null;

  const state = {
    period: null,
    speed: Number(params.get("speed")) > 0 ? Number(params.get("speed")) : Number(CONFIG.film.speed) || 1,
    mode: MODES.includes(params.get("mode")) ? params.get("mode") : MODES.includes(CONFIG.film.mode) ? CONFIG.film.mode : "highlights",
    person: params.get("person") || "",
    L: null, scene: null, cinema: null, projects: [], finished: false, author: null,
  };

  // ---- runtime ------------------------------------------------------------
  let camera;
  const player = createPlayer({ onTick: (dt) => { camera?.step(dt); state.scene?.tick(); } });
  const presenter = createPresenter();
  camera = createCamera({
    viewport,
    canvas,
    onUserMove: () => { if (!state.finished && !player.paused) setPaused(true); },
    safeInsets: () => {
      const vr = viewport.getBoundingClientRect();
      const bottom = $(".dock").getBoundingClientRect();
      let ins;
      if (presenter.on) {
        const bar = vr.height * LETTERBOX;
        ins = { top: bar + 16, bottom: bar + 16, left: 32, right: 32 };
      } else {
        const top = $(".topbar").getBoundingClientRect();
        ins = { top: top.bottom - vr.top + 12, bottom: vr.bottom - bottom.top + 12, left: 24, right: 24 };
      }
      const it = hud.intent;
      if (it.open) {
        // From the card's *intended* place, not its animated rect.
        const gutter = parseFloat(getComputedStyle(hud.card).getPropertyValue("--gutter")) || 20;
        if (vr.width <= 760) {
          // Bottom sheet: keep the frame above its real top edge (offsetHeight ignores the slide-in transform).
          const cardBottom = parseFloat(getComputedStyle(hud.card).bottom) || bottom.height + 20;
          ins.bottom = Math.max(ins.bottom, cardBottom + (hud.card.offsetHeight || 0) + 16);
        } else {
          const w = Math.min(it.mode === "finale" ? 420 : 348, vr.width - 2 * gutter);
          ins[it.side === "left" ? "left" : "right"] = gutter + w + 24;
        }
      }
      return ins;
    },
  });

  // ---- controls -------------------------------------------------------------
  const periodSel = $("#period");
  const options = periodOptions(dataset);
  periodSel.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
  const wanted = params.get("period") || dataset.period || String(dataset.years[dataset.years.length - 1] ?? "");
  state.period = options.some((o) => o.value === wanted) ? wanted : options[options.length - 1]?.value ?? "all";
  periodSel.value = state.period;
  periodSel.disabled = options.length < 2;
  const periodLabel = () => options.find((o) => o.value === state.period)?.label ?? state.period;

  const sub = $("#source");
  sub.textContent = (CONFIG.subtitle ? `${CONFIG.subtitle} · ` : "") + (live
    ? `${(dataset.source || "GitLab").replace(/^https?:\/\//, "")} · ${t("source.repos", { n: dataset.projects.length })}${dataset.fetchedAt ? ` · ${t("source.fetched", { date: fmtDate(dataset.fetchedAt) })}` : ""}`
    : demo ? t("source.demoParam") : t("source.demo"));
  sub.classList.toggle("demo", !live);

  function setUrl(key, value) {
    const url = new URL(location.href);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    history.replaceState(null, "", url);
  }

  const speedBtns = [...document.querySelectorAll("[data-speed]")];
  function setSpeed(v) {
    state.speed = v;
    player.speed = v;
    speedBtns.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === v)));
  }

  // ---- person: whose way the film follows ------------------------------------------
  const personSel = $("#person");
  function fillPeople(authors) {
    const names = authors.map((a) => a.name);
    if (state.person && !names.includes(state.person)) names.unshift(state.person);
    personSel.innerHTML = `<option value="">${t("person.all")}</option>${names
      .map((n) => `<option value="${n.replace(/"/g, "&quot;")}">${n.replace(/</g, "&lt;")}</option>`).join("")}`;
    personSel.value = state.person;
  }
  personSel.addEventListener("change", () => {
    state.person = personSel.value;
    setUrl("person", state.person);
    cut(() => start({ instant: false }));
  });

  const modeBtns = [...document.querySelectorAll("[data-mode]")];
  function setMode(m, { restart = true } = {}) {
    state.mode = m;
    modeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    if (restart) { setUrl("mode", m); cut(() => start({ instant: false })); }
  }

  const pauseBtn = $("#pause");
  function setPaused(on) {
    if (state.finished) on = false;
    player.paused = on;
    document.body.classList.toggle("paused", on);
    pauseBtn.setAttribute("aria-pressed", String(on));
    pauseBtn.querySelector("span").textContent = on ? t("btn.continue") : t("btn.pause");
    if (!on && hud.card.dataset.mode === "event") restoreCard();
  }

  function restoreCard() {
    const cur = state.cinema?.current;
    if (!cur) { hud.closeCard(); return; }
    hud.focus(cur.project, { side: cur.side, period: periodLabel() });
    cur.events.forEach((e) => hud.pushHistory(cur.project, e));
  }

  // ---- cinematic cut: fade to black, change the scene, fade back -------------
  const cutEl = $("#cut");
  let cutting = false;
  async function cut(change) {
    if (cutting) return;
    cutting = true;
    cutEl.classList.add("on");
    await sleep(reducedMotion() ? 0 : 320);
    change();
    await nextFrame();
    await nextFrame();
    cutEl.classList.remove("on");
    cutting = false;
  }

  // ---- one run ----------------------------------------------------------------
  function finish() {
    state.finished = true;
    document.body.classList.add("finished");
    if (state.person && state.scene) {
      state.author = state.person;
      state.scene.highlightAuthor(state.person);
      hud.markAuthor(state.person);
    }
    onFinished?.();
  }
  let onFinished = null;

  function start({ instant = reducedMotion(), fromRow = 0 } = {}) {
    player.cancel();
    setPaused(false);
    state.finished = false;
    state.author = null;
    document.body.classList.remove("finished");

    const bounds = periodBounds(dataset, state.period);
    const projects = sliceProjects(dataset, bounds);
    state.projects = projects;
    hud.closeCard();
    hud.tooltip(null);
    if (!projects.length) {
      canvas.innerHTML = "";
      hud.caption(t("cap.silence"), t("cap.silenceLine"));
      return;
    }

    const L = buildLayout(projects, bounds);
    const scene = createScene(canvas, L);
    state.L = L;
    state.scene = scene;
    camera.setBounds({ minZ: 0.03, maxZ: 2.6 });
    hud.timeline(projects, bounds);

    const cinema = createCinema({
      L, scene, camera, hud, player, projects, dataset,
      period: state.period, periodLabel: periodLabel(), mode: state.mode,
      person: state.person || null,
      onVisit: debug?.visit,
    });
    state.cinema = cinema;
    fillPeople(cinema.authors);

    const run = instant ? cinema.finale({ animate: false }) : cinema.play({ fromRow });
    run.then(finish, (err) => { if (!(err instanceof Cancelled)) console.error(err); });
  }

  function skipToFinale() {
    if (!state.cinema || state.finished) return;
    player.cancel();
    setPaused(false);
    state.cinema.finale({ animate: !reducedMotion() }).then(finish, (err) => {
      if (!(err instanceof Cancelled)) console.error(err);
    });
  }

  // ---- timeline: hover preview + click to seek ----------------------------------
  const timeline = $("#timeline");
  const timeAt = (ev) => {
    const r = timeline.getBoundingClientRect();
    const f = clamp((ev.clientX - r.left) / r.width, 0, 1);
    const [a, b] = hud.timelineBounds;
    return { f, t: a + f * (b - a) };
  };
  const rowAt = (t) => {
    const rows = state.L?.rows || [];
    const i = rows.findIndex((row) => row.t1 > t);
    return i < 0 ? rows.length - 1 : i;
  };
  timeline.addEventListener("pointermove", (ev) => {
    if (!state.L) return;
    const { f, t } = timeAt(ev);
    hud.scrub(f, `▶ ${fmtDay(state.L.rows[rowAt(t)]?.t0 ?? t)}`);
  });
  timeline.addEventListener("pointerleave", () => hud.scrub(null));
  timeline.addEventListener("click", (ev) => {
    if (!state.L) return;
    const row = rowAt(timeAt(ev).t);
    cut(() => start({ instant: false, fromRow: row }));
  });
  // Scripting hook (trailers, demos): seek to a share of the period, 0…1.
  window.__journey = {
    seek(f) {
      if (!state.L) return;
      const [a, b] = hud.timelineBounds;
      cut(() => start({ instant: false, fromRow: rowAt(a + clamp(f, 0, 1) * (b - a)) }));
    },
  };

  // ---- finale: one author's way ---------------------------------------------------
  hud.onAuthor = (name) => {
    if (!state.finished || !state.scene) return;
    state.author = state.author === name ? null : name;
    const box = state.scene.highlightAuthor(state.author);
    hud.markAuthor(state.author);
    const L = state.L;
    const zFit = clamp(camera.fitZoom({ x0: 0, x1: L.width, y0: 0, y1: 1 }, 24), 0.03, 0.9);
    const winH = camera.safeRect().height / zFit;
    if (!box) {
      hud.caption(t("cap.team"), t("cap.clickAuthor"));
      camera.frame({ x0: 0, x1: L.width, y0: Math.max(0, L.endY - 90), y1: Math.max(0, L.endY - 90) + winH }, { ms: 1400, minZ: 0.02, maxZ: 1, pad: 24 });
      return;
    }
    hud.caption(t("cap.authorRoad", { name: state.author }), t("cap.authorRoadLine", { n: box.count, changes: w(box.count, "change"), r: box.lanes }));
    const win = (yTop) => ({ x0: 0, x1: L.width, y0: yTop, y1: yTop + winH });
    const tour = ++authorTour;
    if (box.y1 - box.y0 <= winH) {
      camera.frame(win((box.y0 + box.y1) / 2 - winH / 2), { ms: 1600, minZ: 0.02, maxZ: 1, pad: 24 });
      return;
    }
    // Their way is longer than the screen: start at their first change, ride up to the last.
    camera.frame(win(box.y1 - winH), { ms: 1400, minZ: 0.02, maxZ: 1, pad: 24 });
    const ride = clamp((box.y1 - box.y0) / winH * 1800, 2500, 7000);
    setTimeout(() => {
      if (tour === authorTour) camera.frame(win(box.y0), { ms: ride, minZ: 0.02, maxZ: 1, pad: 24 });
    }, 1500);
  };
  let authorTour = 0;

  // ---- node hover / click -------------------------------------------------------
  let index = new Map();
  const eventOf = (el) => {
    if (index.size === 0 || index.projects !== state.projects) {
      index = eventIndex(state.projects);
      index.projects = state.projects;
    }
    const hit = index.get(el.dataset.nid);
    return hit && { p: hit.project, e: hit.event };
  };
  // Hover is a class on the one node under the cursor, not CSS :hover — a
  // `.node:hover .label` rule made Chrome re-style every label in the world
  // whenever the moving map slid a group under a resting mouse.
  let hovered = null;
  const hover = (el) => {
    if (el === hovered) return;
    hovered?.classList.remove("hover");
    el?.classList.add("hover");
    hovered = el;
    state.scene?.hover(el ? el.dataset.nid : null);
  };
  canvas.addEventListener("pointermove", (ev) => {
    const el = ev.target.closest?.(".node.shown");
    hover(el ?? null);
    const hit = el && eventOf(el);
    if (hit?.e) hud.tooltip(hit.p, hit.e, ev.clientX, ev.clientY);
    else hud.tooltip(null);
  });
  canvas.addEventListener("pointerleave", () => { hover(null); hud.tooltip(null); });
  canvas.addEventListener("click", (ev) => {
    const el = ev.target.closest?.(".node.shown");
    const hit = el && eventOf(el);
    if (!hit?.e) return;
    if (!state.finished) setPaused(true);
    const lane = state.L.lanes.find((l) => l.project.id === hit.p.id);
    hud.event(hit.p, hit.e, { side: lane?.side > 0 ? "left" : "right" });
  });

  // ---- presentation & recording ---------------------------------------------------
  const recBtn = $("#record");
  const recMenu = $("#rec-menu");
  let recording = null;   // { stop, restore }
  recBtn.hidden = !canRecord();
  recMenu.innerHTML = Object.entries(RECORD_PRESETS).map(([key, p]) =>
    `<button type="button" role="menuitem" data-preset="${key}"><b>${p.label}</b><span>${p.hint}</span></button>`).join("");

  const setFrame = (frame) => {
    if (frame) document.body.dataset.frame = frame;
    else delete document.body.dataset.frame;
  };

  async function stopRecording({ saved = true } = {}) {
    if (!recording) return;
    const r = recording;
    recording = null;
    onFinished = null;
    document.body.classList.remove("recording");
    recBtn.setAttribute("aria-pressed", "false");
    const res = saved ? await r.stop() : null;
    r.restore();
    if (res) {
      const tip = res.ext === "mp4" ? t("cap.recMp4") : t("cap.recWebm");
      hud.caption(t("cap.recSaved"), `${res.width}×${res.height} · ${tip}`);
    }
  }

  function toggleMenu(open = recMenu.hidden) {
    recMenu.hidden = !open;
    recBtn.setAttribute("aria-expanded", String(open));
    if (open) recMenu.querySelector("button")?.focus();
  }

  async function startPresetRecording(key) {
    toggleMenu(false);
    const preset = RECORD_PRESETS[key];
    const before = { mode: state.mode, speed: state.speed, present: presenter.on };
    const restore = () => {
      setFrame(null);
      if (!before.present) presenter.exit();
      setSpeed(before.speed);
      if (state.mode !== before.mode) { state.mode = before.mode; setMode(before.mode, { restart: false }); }
    };
    try {
      recording = { restore, stop: null };
      const rec = await startRecording({
        fileName: `journey-${state.period}-${key}.webm`,
        cropEl: $(".stage"),
        preset,
        onEnded: () => stopRecording({ saved: false }),
        prepare: async () => {
          document.body.classList.add("recording");
          setFrame(preset.frame);
          await presenter.enter();
          await sleep(700); // fullscreen + reflow settle before the frame is measured
        },
      });
      recording.stop = rec.stop;
    } catch {
      recording = null;
      restore();
      document.body.classList.remove("recording");
      hud.caption(t("cap.recCancelled"), t("cap.recDenied"));
      return;
    }
    recBtn.setAttribute("aria-pressed", "true");
    if (preset.mode) { state.mode = preset.mode; setMode(preset.mode, { restart: false }); }
    if (preset.speed) setSpeed(preset.speed);
    onFinished = () => setTimeout(() => stopRecording(), 4000); // let the fly-over breathe, then cut
    await cut(() => start({ instant: false }));
  }

  recBtn.addEventListener("click", () => {
    if (recording) stopRecording();
    else toggleMenu();
  });
  recMenu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (b) startPresetRecording(b.dataset.preset);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!recMenu.hidden && !e.target.closest("#rec-menu, #record")) toggleMenu(false);
  });

  $("#present").addEventListener("click", () => presenter.toggle());

  // ---- fresh export check -----------------------------------------------------------
  if (live && dataset.fetchedAt) {
    setInterval(async () => {
      try {
        const text = await (await fetch("data/gitlab_raw.js", { cache: "no-store" })).text();
        const m = text.slice(0, 600).match(/"fetchedAt":\s*"([^"]+)"/);
        if (m && Date.parse(m[1]) > dataset.fetchedAt) $("#fresh").classList.add("on");
      } catch { /* server away — try later */ }
    }, FRESH_CHECK_MS);
    $("#fresh button").addEventListener("click", () => location.reload());
  }

  // ---- buttons & keys -----------------------------------------------------------
  periodSel.addEventListener("change", () => {
    state.period = periodSel.value;
    setUrl("period", state.period);
    cut(() => start());
  });
  $("#replay").addEventListener("click", () => cut(() => start({ instant: false })));
  $("#skip").addEventListener("click", skipToFinale);
  pauseBtn.addEventListener("click", () => setPaused(!player.paused));
  speedBtns.forEach((b) => b.addEventListener("click", () => setSpeed(Number(b.dataset.speed))));
  modeBtns.forEach((b) => b.addEventListener("click", () => { if (b.dataset.mode !== state.mode) setMode(b.dataset.mode); }));

  window.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, select, textarea, [contenteditable], .leaders li") || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.code === "Space") { e.preventDefault(); setPaused(!player.paused); }
    else if (k === "r" || k === "к") cut(() => start({ instant: false }));
    else if (e.key === "End" || k === "f" || k === "а") skipToFinale();
    else if (k === "p" || k === "з") presenter.toggle();
    else if (k === "m" || k === "ь") setMode(state.mode === "full" ? "highlights" : "full");
    else if (["1", "2", "3"].includes(e.key)) setSpeed(SPEEDS[Number(e.key) - 1]);
    else if (e.key === "Escape") {
      if (!recMenu.hidden) toggleMenu(false);
      else if (recording) stopRecording();
      else if (hud.card.dataset.mode === "event") (state.finished ? hud.closeCard() : setPaused(false));
      else if (presenter.on) presenter.exit();
    }
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.finished) state.cinema?.finale({ animate: false }); }, 150);
  });

  setSpeed(state.speed);
  setMode(state.mode, { restart: false });
  start();
}

// ?demo shows the built-in demo team even when a real export is present.
const demo = new URL(location.href).searchParams.has("demo");
const raw = window.GITLAB_RAW;
const live = !demo && Array.isArray(raw) && raw.length > 0;
loadAliases().then((aliases) => {
  boot(loadDataset(live ? raw : MOCK_RAW, live ? window.GITLAB_META || {} : MOCK_META, aliases), live);
});

function createDebug() {
  const box = document.createElement("pre");
  box.className = "debug-overlay";
  document.body.appendChild(box);
  let frames = 0, fps = 0, worst = 0, last = performance.now(), t0 = last;
  let visit = null, visitAt = 0, visits = 0, missed = 0;
  const missedNames = [];
  // Is the newest shown node of the visit (or its lane) inside the window?
  const visible = (v) => {
    const shown = v.nodes.map((n) => document.querySelector(`.node.shown[data-nid="${CSS.escape(n.event.id)}"]`)).filter(Boolean);
    const el = shown.at(-1) || document.querySelector(`.lane-grow[data-pid="${CSS.escape(v.lane.project.id)}"]`);
    const r = el?.getBoundingClientRect();
    return !!r && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
  };
  const loop = (now) => {
    frames++;
    worst = Math.max(worst, now - last);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  setInterval(() => {
    const now = performance.now();
    fps = (frames * 1000) / (now - t0);
    frames = 0; t0 = now;
    const onScreen = visit && now - visitAt > 2500 ? (visible(visit) ? " ✓" : " ✗ off screen") : "";
    const svg = document.querySelector("svg.world");
    const z = /scale\(([\d.]+)\)/.exec(document.querySelector(".canvas")?.style.transform || "")?.[1];
    box.textContent = [
      `fps ${fps.toFixed(0)} · worst frame ${worst.toFixed(0)} ms · zoom ${z ? (+z).toFixed(2) : "?"}`,
      `world ${svg?.getAttribute("width")}×${svg?.getAttribute("height")} · DOM ${document.getElementsByTagName("*").length}`,
      `lanes ${document.querySelectorAll(".lane-grow").length} · nodes ${document.querySelectorAll(".node.shown").length}/${document.querySelectorAll(".node").length} · labels ${document.querySelectorAll(".node-label").length}`,
      `visits ${visits} · lane off screen ${missed}${missedNames.length ? ` (${missedNames.slice(-3).join(", ")})` : ""}`,
      visit ? `now: ${visit.lane.project.name}${visit.first ? " (new)" : ""}${onScreen}` : "now: trunk",
    ].join("\n");
    worst = 0;
  }, 500);
  return {
    visit(v) {
      // Judged when the visit ends: all its nodes are out, the camera has landed.
      // (A lane's last visit ends merging back into the trunk — the camera leaves with it.)
      if (visit && !v && !(visit.last && !visit.lane.alive) && !visible(visit)) { missed++; missedNames.push(visit.lane.project.name); }
      visit = v;
      if (v) { visits++; visitAt = performance.now(); }
    },
  };
}

