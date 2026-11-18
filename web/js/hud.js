// HTML overlay: caption, clock, timeline, the side card (focus / event / finale)
// and the hover tooltip. Pure presentation — the cinema decides what to show.

import { CONFIG } from "./config.js";
import { DAY_MS, escapeHtml as esc, fmtCompact, fmtDate, fmtDay, fmtInt, fmtMonthName, fmtMonthShort, initials, truncate, weekStart } from "./util.js";
import { projectStats } from "./data.js";
import { t, w } from "./i18n.js";

const $ = (sel, root = document) => root.querySelector(sel);

const kindName = (type) => t(`kind.${type}`);

export function eventUrl(project, e) {
  if (!project.webUrl) return "";
  if (e.type === "commit" && e.sha) return `${project.webUrl}/-/commit/${e.sha}`;
  if (e.type === "mr" && e.iid != null) return `${project.webUrl}/-/merge_requests/${e.iid}`;
  return project.webUrl;
}

function kindLabel(e) {
  return e.type === "commit" && e.mr ? t("kind.commitInMr", { iid: e.mr.iid }) : kindName(e.type);
}

function eventTitle(e) {
  if (e.type === "created") return t("event.created");
  if (e.type === "mr") return `!${e.iid} ${e.title || ""}`;
  return e.message || e.sha || t("event.commit");
}

let AVATARS = new Map();
const CAPTION_MIN_MS = 1400;  // a subtitle line stays at least this long (real time)
const PORTRAIT_MIN_MS = 1600; // the «who's working» portrait changes at most this often
const CHAPTER_MIN_MS = 2200;  // a month title plays its whole animation

/** Small square photo (or initials) before a name. */
function miniAv(name, extra = "") {
  const src = AVATARS.get(name);
  return `<span class="mini-av ${extra}" aria-hidden="true">${esc(initials(name))}${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
}

/** Big portrait opposite the repo name: who is changing it right now. */
function nowAv(name) {
  const src = AVATARS.get(name);
  return `<span class="now-av" title="${esc(name)}"><span class="ini">${esc(initials(name))}</span>${src ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : ""}<small>${esc(truncate(name, 18))}</small></span>`;
}

function deltaHtml(e) {
  const files = e.files != null ? ` · ${e.files} ${w(e.files, "file")}` : "";
  if (e.additions == null) return files;
  return `<span class="plus">+${fmtCompact(e.additions)}</span> <span class="minus">−${fmtCompact(e.deletions || 0)}</span>${files}`;
}

export function createHud() {
  const card = $("#card");
  const caption = $("#caption");
  const clock = $("#clock");
  const tooltip = $("#tooltip");
  const timeline = $("#timeline");
  const chapter = $("#chapter");
  const farewellEl = $("#farewell");
  const fx = $("#fx");
  let bounds = [0, 1];
  let swapTimer = 0;
  let pending = null; // history lines that arrive while the card is mid-swap
  // Where the card is going to be — the camera plans its frame from this,
  // so it never waits for (or jumps after) the card's own fade.
  const intent = { open: false, side: "right", mode: "focus" };

  function setCard(html, { side = "right", mode = "focus", color = null, expanded = false } = {}) {
    const fill = () => {
      card.innerHTML = `<button type="button" class="grip" aria-label="${t("card.expand")}"></button>${html}`;
      card.classList.toggle("expanded", expanded);
      portraitAt = performance.now(); // finale: open on narrow frames too, so the numbers make it into the video
      card.dataset.side = side;
      card.dataset.mode = mode;
      card.style.setProperty("--c", color || "var(--accent)");
      card.classList.remove("idle");
      card.classList.add("open");
      card.scrollTop = 0;
      const queued = pending;
      pending = null;
      queued?.forEach(([p, e]) => api.pushHistory(p, e));
    };
    clearTimeout(swapTimer);
    pending = null;
    // On a narrow stage (phone, 9:16 video) the card is a bottom sheet with no
    // sides — swapping content in place, without the glide out/in blink.
    const narrow = (card.parentElement?.clientWidth ?? 1e9) <= 760;
    const flip = !narrow && card.classList.contains("open") && card.dataset.side !== side;
    Object.assign(intent, { open: true, side, mode });
    if (flip) {
      // Changing sides: glide out, then glide in on the other side.
      card.classList.remove("open");
      pending = [];
      swapTimer = setTimeout(fill, 300);
    } else {
      fill();
    }
  }

  card.addEventListener("click", (ev) => {
    const li = ev.target.closest(".leaders li");
    if (li) { api.onAuthor?.(li.dataset.author); return; }
    if (ev.target.closest(".grip, .kicker, h2")) card.classList.toggle("expanded");
  });
  card.addEventListener("keydown", (ev) => {
    const li = ev.target.closest(".leaders li");
    if (li && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); api.onAuthor?.(li.dataset.author); }
  });

  // Portrait of who is working now: changes at most every PORTRAIT_MIN_MS,
  // always ending on the latest author (so it never flickers in a video).
  let portraitAt = 0, portraitTimer = 0, portraitWant = null;
  function setPortrait(name) {
    portraitWant = name;
    const now = $(".now-av", card);
    if (!now || now.title === name) return;
    const apply = () => {
      const el = $(".now-av", card);
      if (!el || el.title === portraitWant) return;
      el.outerHTML = nowAv(portraitWant);
      $(".now-av", card)?.classList.add("swap");
      portraitAt = performance.now();
    };
    clearTimeout(portraitTimer);
    const wait = PORTRAIT_MIN_MS - (performance.now() - portraitAt);
    if (wait > 0) portraitTimer = setTimeout(apply, wait);
    else apply();
  }
  let captionAt = 0, captionTimer = 0;
  let chapterAt = 0, chapterTimer = 0;

  const api = {
    card,
    onAuthor: null,
    setAvatars(map) { AVATARS = map || new Map(); },

    /** Subtitle line. Each one stays ≥ CAPTION_MIN_MS; lines arriving faster
     *  are coalesced — the newest wins, the ones in between are skipped. */
    caption(title, line = "") {
      clearTimeout(captionTimer);
      if (!title) { caption.classList.remove("on"); captionAt = 0; return; }
      const show = () => {
        captionAt = performance.now();
        caption.innerHTML = `<strong>${esc(title)}</strong><span>${esc(line)}</span>`;
        caption.classList.remove("on");
        void caption.offsetWidth; // restart the fade for each new line
        caption.classList.add("on");
      };
      const wait = CAPTION_MIN_MS - (performance.now() - captionAt);
      if (wait > 0) captionTimer = setTimeout(show, wait);
      else show();
    },

    clock(t) {
      const d = new Date(t);
      clock.innerHTML = `<span class="m">${fmtMonthName(t)}</span><span class="y">${d.getFullYear()}</span><span class="d">${fmtDay(t)}</span>`;
      const [a, b] = bounds;
      timeline.style.setProperty("--p", String(Math.min(1, Math.max(0, (t - a) / Math.max(1, b - a)))));
    },

    /** Weekly activity sparkline + project births under the playhead. */
    timeline(projects, [from, to]) {
      bounds = [from, to];
      const weeks = Math.max(1, Math.ceil((to - weekStart(from)) / (7 * DAY_MS)));
      const bins = new Array(weeks).fill(0);
      for (const p of projects) for (const e of p.events) {
        const i = Math.floor((weekStart(e.t) - weekStart(from)) / (7 * DAY_MS));
        if (i >= 0 && i < weeks) bins[i] += e.type === "mr" ? 3 : 1;
      }
      const max = Math.max(1, ...bins);
      const bars = bins.map((v, i) =>
        `<i style="left:${((i / weeks) * 100).toFixed(2)}%;width:${(100 / weeks).toFixed(2)}%;height:${v ? Math.max(8, (Math.sqrt(v / max)) * 100) : 0}%"></i>`).join("");
      const months = [];
      for (let m = new Date(new Date(from).getFullYear(), new Date(from).getMonth(), 1); m.getTime() <= to; m.setMonth(m.getMonth() + 1)) {
        const x = (m.getTime() - from) / (to - from);
        if (x >= 0) months.push(`<span style="left:${(x * 100).toFixed(2)}%">${fmtMonthShort(m.getTime())}</span>`);
      }
      const births = projects.map((p) => {
        const x = (p.events[0].t - from) / (to - from);
        return `<b title="${esc(p.name)}" style="left:${(x * 100).toFixed(2)}%;--c:${p.color}"></b>`;
      }).join("");
      timeline.innerHTML = `<div class="bars">${bars}</div><div class="births">${births}</div><div class="months">${months.join("")}</div><div class="head"></div><div class="scrub"><span></span></div>`;
    },

    /** Live focus card for a repo; history fills in as the camera reveals it. */
    focus(project, { side, period }) {
      const s = projectStats(project);
      const state = project.alive ? `<em class="live">${t("state.alive")}</em>` : `<em>${t("state.done")}</em>`;
      setCard(`
        <div class="card-head">
          <div class="card-title"><div class="kicker"><i></i>${t("card.inFocus")} ${state}</div><h2>${esc(project.name)}</h2></div>
          ${nowAv(project.author)}
        </div>
        ${project.description && project.description !== project.path ? `<p class="desc">${esc(truncate(project.description, 140))}</p>` : ""}
        <dl class="facts">
          <div><dt>${t("fact.owner")}</dt><dd>${esc(project.author)}</dd></div>
          <div><dt>${t("fact.created")}</dt><dd>${fmtDate(project.createdAt)}</dd></div>
          <div><dt>${t("fact.branch")}</dt><dd>${esc(project.defaultBranch)}</dd></div>
        </dl>
        <div class="stats">
          <div><b>${fmtInt(s.commits)}</b><span>${w(s.commits, "commit")}</span></div>
          <div><b>${fmtInt(s.mrs)}</b><span>${t("stat.mrs")}</span></div>
          <div><b class="plus">+${fmtCompact(s.add)}</b><span>${t("stat.lines")}</span></div>
          <div><b class="minus">−${fmtCompact(s.del)}</b><span>${t("stat.lines")}</span></div>
        </div>
        <div class="hist-head">${t("card.feed", { period: esc(period) })}</div>
        <ol class="hist"></ol>`, { side, mode: "focus", color: project.color });
    },

    pushHistory(project, e) {
      if (pending) { pending.push([project, e]); return; }
      setPortrait(e.author);
      const list = $(".hist", card);
      if (!list) return;
      const li = document.createElement("li");
      li.className = `k-${e.type}${e.mr ? " k-mr-commit" : ""}`;
      li.innerHTML = `${miniAv(e.author, "feed-av")}<time>${fmtDay(e.t)}</time><span class="what">${e.mr ? `<em class="in-mr">!${e.mr.iid}</em> ` : ""}${esc(truncate(eventTitle(e), 70))}${e.type === "mr" && (e.commitCount ?? e.commits?.length) ? ` <em class="in-mr">${e.commitCount ?? e.commits.length} ${w(e.commitCount ?? e.commits.length, "commit")}</em>` : ""}</span><span class="who">${esc(e.author)}${e.sha ? ` · ${esc(e.sha)}` : ""} ${deltaHtml(e)}</span>`;
      list.prepend(li);
      while (list.children.length > 60) list.lastChild.remove();
    },

    /** Click on a node: one event in detail. */
    event(project, e, { side }) {
      const url = eventUrl(project, e);
      setCard(`
        <div class="kicker"><i></i>${kindLabel(e)} · ${esc(project.name)}</div>
        <h2>${esc(eventTitle(e))}</h2>
        <dl class="facts">
          <div><dt>${t("fact.date")}</dt><dd>${fmtDate(e.t)}</dd></div>
          <div><dt>${t("fact.author")}</dt><dd>${miniAv(e.author)}${esc(e.author)}</dd></div>
          ${e.sha ? `<div><dt>SHA</dt><dd>${esc(e.sha)}</dd></div>` : ""}
          ${e.type === "mr" ? `<div><dt>${t("fact.status")}</dt><dd>${t("status.merged", { branch: esc(project.defaultBranch) })}</dd></div>` : ""}
          ${e.files != null ? `<div><dt>${t("fact.files")}</dt><dd>${fmtInt(e.files)}</dd></div>` : ""}
        </dl>
        ${e.additions != null ? `<div class="stats two">
          <div><b class="plus">+${fmtInt(e.additions)}</b><span>${t("stat.added")}</span></div>
          <div><b class="minus">−${fmtInt(e.deletions || 0)}</b><span>${t("stat.deleted")}</span></div></div>` : ""}
        ${url ? `<a class="open-link" href="${esc(url)}" target="_blank" rel="noopener">${t("card.openGitlab")}</a>` : ""}
        <p class="hint">${t("card.spaceHint")}</p>`, { side, mode: "event", color: project.color });
    },

    /** Finale leaderboard. */
    finale(authors, projects, period, { farewells = new Set(), finished = 0, person = null, personInfo = null } = {}) {
      const commits = authors.reduce((n, a) => n + a.commits, 0);
      const mrs = authors.reduce((n, a) => n + a.mrs, 0);
      const add = authors.reduce((n, a) => n + a.add, 0);
      const del = authors.reduce((n, a) => n + a.del, 0);
      const alive = projects.filter((p) => p.alive).length;
      const top = Math.max(1, ...authors.map((a) => a.score));
      const rows = authors.map((a, i) => `
        <li style="--i:${i};--w:${((a.score / top) * 100).toFixed(1)}%" data-author="${esc(a.name)}" tabindex="0" role="button" aria-pressed="false">
          <span class="rank">${i + 1}</span>
          <span class="avatar" style="--c:${["#3dd6c6", "#f0a05a", "#8fb0ff", "#e8c96a", "#ef7f9f", "#b5d98a"][i % 6]}">${esc(initials(a.name))}${AVATARS.get(a.name) ? `<img src="${esc(AVATARS.get(a.name))}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>
          <span class="who"><b title="${esc(a.name)}">${esc(a.name)}${farewells.has(a.name) ? ` <em class="bye-tag">good bye</em>` : ""}</b>
            <small>${t("finale.row", { c: a.commits, m: a.mrs, r: a.projects })}${a.created ? t("finale.rowNew", { n: a.created }) : ""}</small>
            <span class="bar"></span></span>
          <span class="score"><b>${fmtInt(a.score)}</b><small><span class="plus">+${fmtCompact(a.add)}</span> <span class="minus">−${fmtCompact(a.del)}</span></small></span>
        </li>`).join("");
      const me = person ? authors.find((a) => a.name === person) : null;
      if (me) {
        // One person's film ends on *their* card; the team board follows below.
        const rank = authors.indexOf(me) + 1;
        const share = add + del ? Math.round(((me.add + me.del) / (add + del)) * 100) : 0;
        const src = AVATARS.get(me.name);
        const repos = (personInfo?.repos || []).map((r) =>
          `<span class="chip" style="--c:${r.color}"><i></i>${esc(r.name)}<b>${r.count}</b></span>`).join("");
        setCard(`
          <div class="kicker"><i></i>${t("person.kicker", { period: esc(period) })}</div>
          <div class="me">
            <span class="avatar big">${esc(initials(me.name))}${src ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : ""}</span>
            <div><h2>${esc(me.name)}${farewells.has(me.name) ? ` <em class="bye-tag">good bye</em>` : ""}</h2>
              <small>${t("person.rank", { rank, total: authors.length })}${personInfo ? ` · ${fmtDate(personInfo.first)} — ${fmtDate(personInfo.last)}` : ""}</small></div>
          </div>
          <div class="me-lines">
            <div><b class="plus">+${fmtInt(me.add)}</b><span>${t("person.linesAdded")}</span></div>
            <div><b class="minus">−${fmtInt(me.del)}</b><span>${t("person.linesDeleted")}</span></div>
          </div>
          <div class="stats three">
            <div><b>${fmtInt(me.commits)}</b><span>${w(me.commits, "commit")}</span></div>
            <div><b>${fmtInt(me.mrs)}</b><span>${t("stat.mrs")}</span></div>
            <div><b>${me.projects}</b><span>${t("person.repos")}${me.created ? t("finale.rowNew", { n: me.created }) : ""}</span></div>
          </div>
          ${share ? `<div class="share"><span style="--s:${share}%"></span><small>${t("person.share", { s: share })}</small></div>` : ""}
          ${repos ? `<div class="hist-head">${t("person.where")}</div><div class="chips">${repos}</div>` : ""}
          <div class="hist-head">${t("person.team")}</div>
          <ol class="leaders">${rows}</ol>`, { side: "right", mode: "finale", expanded: true });
        return;
      }
      setCard(`
        <div class="kicker"><i></i>${t("finale.kicker", { period: esc(period) })}</div>
        <h2>${t("finale.title")}</h2>
        <div class="stats">
          <div><b>${projects.length}</b><span>${t("finale.repos", { alive })}${finished ? t("finale.finished", { n: finished }) : ""}</span></div>
          <div><b>${authors.length}</b><span>${w(authors.length, "author")}</span></div>
          <div><b>${fmtInt(commits)}</b><span>${w(commits, "commit")}</span></div>
          <div><b>${fmtInt(mrs)}</b><span>${t("stat.mrs")}</span></div>
        </div>
        <div class="lines"><span class="plus">+${fmtInt(add)}</span><span class="minus">−${fmtInt(del)}</span><span>${t("finale.linesPeriod")}</span></div>
        <div class="hist-head">${t("finale.ranking", { c: CONFIG.ranking.commit, m: CONFIG.ranking.mr, n: CONFIG.ranking.newRepo })}</div>
        <ol class="leaders">${rows}</ol>`, { side: "right", mode: "finale", expanded: true });
    },

    /** Hover preview on the timeline: where a click would jump to. */
    scrub(fraction, label) {
      const el = $(".scrub", timeline);
      if (!el) return;
      if (fraction == null) { el.classList.remove("on"); return; }
      el.style.left = `${(fraction * 100).toFixed(2)}%`;
      el.firstElementChild.textContent = label;
      el.classList.add("on");
    },
    get timelineBounds() { return bounds; },

    markAuthor(name) {
      for (const li of card.querySelectorAll(".leaders li")) {
        const on = li.dataset.author === name;
        li.classList.toggle("active", on);
        li.setAttribute("aria-pressed", String(on));
      }
      card.classList.toggle("picking", name != null);
    },

    /** «Поздравляем»: the repo's story in one card. */
    finishCard(project, { from, to, people, commits, mrs, note }, { side }) {
      const avatars = people.slice(0, 8).map((n) => miniAv(n)).join("");
      setCard(`
        <div class="kicker"><i></i>${t("finish.kicker")}</div>
        <h2>${esc(project.name)}</h2>
        ${note ? `<p class="quote">«${esc(note)}»</p>` : ""}
        <dl class="facts">
          <div><dt>${t("fact.road")}</dt><dd>${fmtDate(from)} → ${fmtDate(to)}</dd></div>
          <div><dt>${t("fact.commitsMrs")}</dt><dd>${fmtInt(commits)} · ${fmtInt(mrs)}</dd></div>
        </dl>
        <div class="hist-head">${t("finish.crew", { n: people.length })}</div>
        <div class="crew">${avatars}${people.length > 8 ? `<span class="more">+${people.length - 8}</span>` : ""}</div>
        <p class="crew-names">${people.map(esc).join(" · ")}</p>`, { side, mode: "finish", color: project.color });
    },

    /** «Good bye, <name>»: a centred portrait card over the dimmed map (null hides it). */
    farewell(data, { holdMs = 15000 } = {}) {
      if (!data) { farewellEl.classList.remove("on"); return; }
      farewellEl.style.setProperty("--hold", `${holdMs}ms`);
      const src = AVATARS.get(data.name);
      farewellEl.innerHTML = `
        <div class="portrait">${esc(initials(data.name))}${src ? `<img src="${esc(src)}" alt="">` : ""}</div>
        <span class="hello">${t("farewell.hello")}</span>
        <b class="name">${esc(data.name)}</b>
        ${data.note ? `<p class="quote">«${esc(data.note)}»</p>` : `<p class="quote dim">${t("farewell.thanks")}</p>`}
        <span class="rule"></span>
        <p class="facts-line">${fmtDate(data.first)} — ${fmtDate(data.last)}</p>
        <p class="facts-line"><b>${fmtInt(data.commits)}</b> ${w(data.commits, "commit")} · <b>${fmtInt(data.mrs)}</b> MR · <b>${data.repos}</b> ${t("person.repos")}</p>
        <p class="skip">${t("farewell.skip")}</p>
        <span class="timer"></span>`;
      farewellEl.classList.remove("on");
      void farewellEl.offsetWidth;
      farewellEl.classList.add("on");
    },

    /** Resolves when the viewer dismisses the farewell card (click or Enter). */
    farewellDismissed() {
      return new Promise((resolve) => {
        const done = () => {
          farewellEl.removeEventListener("click", done);
          window.removeEventListener("keydown", onKey, true);
          resolve();
        };
        const onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); done(); } };
        farewellEl.addEventListener("click", done);
        window.addEventListener("keydown", onKey, true);
      });
    },

    /** Confetti burst over the stage (skipped for reduced motion). */
    confetti(colors) {
      if (!CONFIG.film.confetti) return;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = fx.clientWidth, h = fx.clientHeight;
      fx.width = w * dpr; fx.height = h * dpr;
      const ctx = fx.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const parts = Array.from({ length: 180 }, (_, i) => ({
        x: w / 2 + (Math.random() - 0.5) * w * 0.3,
        y: h * 0.42,
        vx: (Math.random() - 0.5) * 900,
        vy: -300 - Math.random() * 700,
        r: 3 + Math.random() * 4,
        a: Math.random() * Math.PI,
        va: (Math.random() - 0.5) * 12,
        c: colors[i % colors.length],
        rect: Math.random() < 0.6,
      }));
      const t0 = performance.now();
      let last = t0;
      const tick = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const life = (now - t0) / 3200;
        ctx.clearRect(0, 0, w, h);
        for (const q of parts) {
          q.vy += 900 * dt; q.vx *= 0.99;
          q.x += q.vx * dt; q.y += q.vy * dt; q.a += q.va * dt;
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - life * life);
          ctx.translate(q.x, q.y); ctx.rotate(q.a);
          ctx.fillStyle = q.c;
          if (q.rect) ctx.fillRect(-q.r, -q.r * 0.45, q.r * 2, q.r * 0.9);
          else { ctx.beginPath(); ctx.arc(0, 0, q.r * 0.6, 0, Math.PI * 2); ctx.fill(); }
          ctx.restore();
        }
        if (life < 1) requestAnimationFrame(tick); else ctx.clearRect(0, 0, w, h);
      };
      requestAnimationFrame(tick);
    },

    closeCard() {
      clearTimeout(swapTimer);
      intent.open = false;
      card.classList.remove("open");
    },
    /** Card stays put but steps back while the trunk runs between visits. */
    idle(on) { card.classList.toggle("idle", !!on); },
    get cardOpen() { return intent.open; },
    intent,

    /** Big centred title that fades in and out — chapter cards of the film. */
    /** Month titles run their full animation (≥ CHAPTER_MIN_MS); months the trunk
     *  races through meanwhile are skipped, the latest one follows. Big titles
     *  (opening, «Поздравляем!», «Настоящее») come in right away. */
    chapter(title, sub = "", { big = false, tone = "" } = {}) {
      clearTimeout(chapterTimer);
      const show = () => {
        chapterAt = performance.now();
        chapter.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}`;
        chapter.classList.toggle("big", big);
        chapter.dataset.tone = tone;
        chapter.classList.remove("on");
        void chapter.offsetWidth;
        chapter.classList.add("on");
      };
      const wait = big ? 0 : CHAPTER_MIN_MS - (performance.now() - chapterAt);
      if (wait > 0) chapterTimer = setTimeout(show, wait);
      else show();
    },

    tooltip(project, e, x, y) {
      if (!project) { tooltip.classList.remove("on"); return; }
      tooltip.innerHTML = `<span class="k" style="--c:${project.color}">${kindLabel(e)} · ${esc(project.name)}</span>
        <b>${esc(truncate(eventTitle(e), 80))}</b>
        <small>${miniAv(e.author)}${fmtDate(e.t)} · ${esc(e.author)} ${deltaHtml(e)}</small>`;
      const pad = 16;
      const w = tooltip.offsetWidth || 260, h = tooltip.offsetHeight || 80;
      const left = Math.min(window.innerWidth - w - pad, x + 14);
      const top = y + h + 20 > window.innerHeight ? y - h - 14 : y + 18;
      tooltip.style.transform = `translate(${Math.max(pad, left)}px, ${Math.max(pad, top)}px)`;
      tooltip.classList.add("on");
    },
  };
  return api;
}
