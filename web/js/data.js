// Dataset: normalise what fetch_gitlab.py exported, slice it by period and
// aggregate per-author contribution. Pure functions — no DOM.

import { DAY_MS, parseDay, toDay } from "./util.js";

/** Lane colours: distinct hues tuned for a near-black background. */
export const PALETTE = [
  // No blues here: blue belongs to MR branches.
  "#3dd6c6", "#f0a05a", "#ef7f9f", "#e8c96a", "#b5d98a", "#d49cff",
  "#ff8a65", "#6fe0a0", "#f2b8a0", "#ffa3d1", "#d7d2a0", "#9fe870",
];

/** A lane counts as "living" if it changed this close to the end of the period. */
export const ALIVE_DAYS = 90;

const TYPE_ORDER = { created: 0, commit: 1, mr: 2 };

// Same conventions as ingest/special.py — for exports where only the title survived.
const SPECIAL = [
  ["finish", /(?:^\s*life-?way\s*:\s*(?:finish|done|closed?)\b|#lifeway[-_]?(?:finish|done)\b)/im],
  ["goodbye", /(?:^\s*life-?way\s*:\s*(?:goodbye|good-?bye|farewell|bye)\b|#lifeway[-_]?(?:goodbye|bye|farewell)\b)/im],
];

/** {special, note} from an event: what ingest found, else a mark in its message/title. */
export function specialOf(e) {
  if (e.special === "finish" || e.special === "goodbye") return { special: e.special, note: e.note || "" };
  for (const [kind, rx] of SPECIAL) {
    const text = e.message || e.title || "";
    const m = text.match(rx);
    if (m) {
      const note = text.slice(m.index + m[0].length).split("\n")[0].replace(/^[\s:—–-]+/, "").trim();
      return { special: kind, note };
    }
  }
  return null;
}
const MERGE_COMMIT = /^Merge (branch|remote-tracking branch|pull request|tag) /i;

/** 'Frost_Lena' and 'lena frost' are the same key (mirrors ingest/authors.py). */
export function nameKey(name) {
  return String(name || "")
    .toLocaleLowerCase("ru")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/**
 * Build a resolver raw-name → display-name. Spellings with the same key merge;
 * `aliases` ({canonical: [alias, ...]}, see data/authors.example.json) merge the rest.
 */
export function authorResolver(rawNames, aliases = {}) {
  const canonicalByKey = new Map();
  for (const [canonical, list] of Object.entries(aliases || {})) {
    if (canonical.startsWith("_")) continue;
    for (const alias of [canonical, ...(Array.isArray(list) ? list : [])]) {
      canonicalByKey.set(nameKey(alias), canonical);
    }
  }
  const groupOf = (name) => canonicalByKey.get(nameKey(name)) ?? `key:${nameKey(name)}`;
  const counts = new Map(); // group → Map(spelling → n)
  for (const raw of rawNames) {
    const name = String(raw || "").trim();
    if (!name) continue;
    const g = groupOf(name);
    if (!counts.has(g)) counts.set(g, new Map());
    const m = counts.get(g);
    m.set(name, (m.get(name) || 0) + 1);
  }
  const display = new Map();
  for (const [g, spellings] of counts) {
    if (!g.startsWith("key:")) { display.set(g, g); continue; }
    const best = [...spellings].sort((a, b) =>
      Number(b[0].includes(" ")) - Number(a[0].includes(" ")) || b[1] - a[1] || b[0].length - a[0].length
    )[0];
    display.set(g, best ? best[0] : "unknown");
  }
  return (raw) => {
    const name = String(raw || "").trim();
    if (!name) return "unknown";
    const g = groupOf(name);
    return display.get(g) ?? (g.startsWith("key:") ? name : g);
  };
}

/**
 * Normalise raw projects: drop merge commits (the MR stands for them), sort events,
 * give everything stable ids and a lane colour, resolve author spellings.
 */
export function loadDataset(rawProjects, meta = {}, aliases = {}) {
  const raw = Array.isArray(rawProjects) ? rawProjects : [];
  const names = [];
  for (const p of raw) {
    names.push(p.author);
    for (const e of p.events || []) {
      names.push(e.author);
      for (const c of e.commits || []) names.push(c.author);
    }
    for (const a of Object.keys(p.totals?.authors || {})) names.push(a);
  }
  const who = authorResolver(names, aliases);

  const projects = raw
    .map((p) => {
      const id = String(p.id ?? p.path ?? p.name);
      const events = (p.events || [])
        .filter((e) => e && e.date && TYPE_ORDER[e.type] != null)
        .filter((e) => !(e.type === "commit" && MERGE_COMMIT.test(e.message || "")))
        .map((e) => {
          // Old exports wrote 0/0 for MRs they never measured — that is "unknown", not "empty".
          const unmeasured = e.type === "mr" && e.files == null && !e.additions && !e.deletions;
          const sp = specialOf(e);
          return {
            ...e,
            special: sp?.special ?? null,
            note: sp?.note ?? "",
            t: parseDay(e.date),
            author: who(e.author || p.author),
            additions: unmeasured ? null : e.additions ?? null,
            deletions: unmeasured ? null : e.deletions ?? null,
            files: e.files ?? null,
          };
        })
        .sort((a, b) => a.t - b.t || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
      events.forEach((e, i) => {
        e.id = `${id}:${i}`;
        // An MR's own commits ride on its branch, oldest first, never after the merge.
        e.commits = e.type === "mr" && Array.isArray(e.commits)
          ? e.commits
            .filter((c) => c && c.date)
            .map((c, k) => ({
              ...c,
              type: "commit",
              id: `${e.id}:c${k}`,
              t: Math.min(parseDay(c.date), e.t),
              author: who(c.author || e.author),
              additions: c.additions ?? null,
              deletions: c.deletions ?? null,
              mr: e,
              ...(specialOf(c) || { special: null, note: "" }),
            }))
            .sort((a, b) => a.t - b.t)
          : [];
      });

      let totals = null;
      if (p.totals) {
        const authors = {};
        for (const [name, row] of Object.entries(p.totals.authors || {})) {
          const key = who(name);
          const acc = authors[key] || (authors[key] = { commits: 0, mrs: 0, additions: 0, deletions: 0 });
          for (const k of Object.keys(acc)) acc[k] += row[k] || 0;
        }
        totals = { ...p.totals, authors };
      }
      return {
        id,
        name: p.name || p.path || id,
        path: p.path || p.name || id,
        author: who(p.author),
        createdAt: p.createdAt ? parseDay(p.createdAt) : events[0]?.t ?? 0,
        description: (p.description || "").trim(),
        defaultBranch: p.defaultBranch || meta.defaultBranch || "main",
        webUrl: p.webUrl || "",
        totals,
        events,
      };
    })
    .filter((p) => p.events.length)
    .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));

  projects.forEach((p, i) => { p.color = PALETTE[i % PALETTE.length]; });
  keepLastSpecials(projects);

  const years = [...new Set(projects.flatMap((p) => p.events.map((e) => new Date(e.t).getFullYear())))].sort();
  const fetchedAt = meta.fetchedAt ? new Date(meta.fetchedAt).getTime() : null;
  // Photos saved by fetch_gitlab.py: {author: "avatars/<file>"} relative to data/.
  const avatars = new Map();
  for (const [name, rel] of Object.entries(meta.avatars || {})) {
    if (typeof rel !== "string") continue;
    if (/^avatars\/[\w.-]+$/.test(rel)) avatars.set(who(name), `data/${rel}`);
    else if (/^img\/demo\/[\w.-]+\.svg$/.test(rel)) avatars.set(who(name), rel); // demo placeholders
  }
  return {
    projects,
    avatars,
    years,
    fetchedAt,
    source: meta.source || null,
    period: meta.period != null ? String(meta.period) : null,
  };
}

/** Period options for the selector: each year with data, plus "all" when there is more than one. */
export function periodOptions(dataset) {
  const opts = dataset.years.map((y) => ({ value: String(y), label: String(y) }));
  if (opts.length > 1) opts.push({ value: "all", label: "Весь срок" });
  return opts;
}

/** [from, to]: to is clamped to the fetch moment, so "настоящее" is the real now. */
export function periodBounds(dataset, period) {
  let from, to;
  if (period === "all" || !/^\d{4}$/.test(String(period))) {
    const y0 = dataset.years[0] ?? new Date().getFullYear();
    const y1 = dataset.years[dataset.years.length - 1] ?? y0;
    from = new Date(y0, 0, 1).getTime();
    to = new Date(y1, 11, 31).getTime();
  } else {
    const y = Number(period);
    from = new Date(y, 0, 1).getTime();
    to = new Date(y, 11, 31).getTime();
  }
  const lastEvent = Math.max(from, ...dataset.projects.flatMap((p) => p.events.map((e) => e.t)));
  const now = dataset.fetchedAt ?? lastEvent;
  const nowDay = parseDay(toDay(now));
  return [from, Math.max(Math.min(to, Math.max(nowDay, lastEvent)), from + DAY_MS)];
}

/** Projects with at least one event in [from, to]; `alive` = still changing near the end. */
export function sliceProjects(dataset, [from, to]) {
  return dataset.projects
    .map((p) => {
      const events = p.events.filter((e) => e.t >= from && e.t <= to);
      if (!events.length) return null;
      const last = events[events.length - 1].t;
      // A «Life-Way: finish» mark closes the repo no matter how recent it is.
      const finish = withBranchCommits(events).find((e) => e.special === "finish") || null;
      return { ...p, events, finish, alive: !finish && (to - last) / DAY_MS <= ALIVE_DAYS };
    })
    .filter(Boolean);
}

/** Did the ingest's full totals cover exactly this slice? (sampled events undercount) */
function totalsCover(dataset, period) {
  if (!dataset.period) return false;
  return period === "all" || dataset.period === String(period);
}

export function projectStats(project, { useTotals = true } = {}) {
  if (useTotals && project.totals) {
    const t = project.totals;
    return { commits: t.commits || 0, mrs: t.mrs || 0, add: t.additions || 0, del: t.deletions || 0, exact: true };
  }
  // Lines come from commits only: an MR's diff is the same lines its commits brought.
  const s = { commits: 0, mrs: 0, add: 0, del: 0, exact: false };
  for (const e of withBranchCommits(project.events)) {
    if (e.type === "mr") { s.mrs++; continue; }
    if (e.type !== "commit") continue;
    s.commits++;
    s.add += e.additions || 0;
    s.del += e.deletions || 0;
  }
  return s;
}

/**
 * One scene per story: a person says goodbye once — at their *latest* goodbye mark
 * (across all repos); a repo is finished once — at its latest finish mark.
 * Earlier marks become ordinary commits/MRs.
 */
export function keepLastSpecials(projects) {
  const last = new Map(); // "goodbye:<author>" | "finish:<project id>" → event
  for (const p of projects) {
    for (const e of withBranchCommits(p.events)) {
      if (!e.special) continue;
      const key = e.special === "goodbye" ? `goodbye:${e.author}` : `finish:${p.id}`;
      const prev = last.get(key);
      if (!prev || e.t >= prev.e.t) { // same day: the later one in history order wins
        if (prev) { prev.e.special = null; prev.e.note = ""; }
        last.set(key, { e });
      } else {
        e.special = null;
        e.note = "";
      }
    }
  }
  return projects;
}

/** Main-line events plus the commits drawn on MR branches. */
export function withBranchCommits(events) {
  return events.flatMap((e) => (e.commits?.length ? [...e.commits, e] : [e]));
}

/** id → event for everything drawable (main line and MR branches). */
export function eventIndex(projects) {
  const map = new Map();
  for (const p of projects) for (const e of withBranchCommits(p.events)) map.set(e.id, { project: p, event: e });
  return map;
}

export const SCORE = { commit: 1, mr: 3, created: 2 };

/** Leaderboard: commits, MRs, repos born, lines. Uses full ingest totals when they apply. */
export function authorSummary(projects, { dataset = null, period = null } = {}) {
  const useTotals = !!dataset && totalsCover(dataset, period) && projects.every((p) => p.totals);
  const map = new Map();
  const row = (name) => {
    if (!map.has(name)) {
      map.set(name, { name, commits: 0, mrs: 0, created: 0, add: 0, del: 0, projects: new Set() });
    }
    return map.get(name);
  };
  for (const p of projects) {
    for (const e of p.events) {
      if (e.type === "created") { const a = row(e.author); a.created++; a.projects.add(p.id); }
    }
    if (useTotals) {
      for (const [name, t] of Object.entries(p.totals.authors || {})) {
        const a = row(name);
        a.commits += t.commits || 0;
        a.mrs += t.mrs || 0;
        a.add += t.additions || 0;
        a.del += t.deletions || 0;
        if ((t.commits || 0) + (t.mrs || 0) > 0) a.projects.add(p.id);
      }
    } else {
      for (const e of withBranchCommits(p.events)) {
        if (e.type === "created") continue;
        const a = row(e.author);
        a.projects.add(p.id);
        if (e.type === "mr") { a.mrs++; continue; }
        a.commits++;
        a.add += e.additions || 0;
        a.del += e.deletions || 0;
      }
    }
  }
  return [...map.values()]
    .map((a) => ({
      ...a,
      projects: a.projects.size,
      score: a.commits * SCORE.commit + a.mrs * SCORE.mr + a.created * SCORE.created,
    }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score || b.commits - a.commits || a.name.localeCompare(b.name, "ru"));
}
