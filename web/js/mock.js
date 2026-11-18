import { LANG } from "./i18n.js";

// Demo team (fictional people and repos). Shown when there is no export yet,
// or with ?demo. Deterministic: the same film every time.
//
// Covers what the real data has and more: MRs with their own commits spread
// over days and weeks, two MRs open at once, a squashed MR without line stats,
// a finished repo that merges back, a repo born mid-year — and the two special
// moments: «Life-Way: finish» (api-adapters) and «Life-Way: goodbye» (Сергей Дудин).

// The demo team speaks the interface language.
const EN = LANG === "en";
const L10N = (ru, en) => (EN ? en : ru);

const PEOPLE = EN
  ? ["Irina Savelyeva", "Pavel Orlov", "Maria Kim", "Nikita Volkov", "Olga Belova", "Sergey Dudin", "Kira Nazarova"]
  : ["Ирина Савельева", "Павел Орлов", "Мария Ким", "Никита Волков", "Ольга Белова", "Сергей Дудин", "Кира Назарова"];
const PHOTOS = ["irina", "pavel", "maria", "nikita", "olga", "sergey", "kira"];

export const MOCK_META = {
  source: null, period: "2026", defaultBranch: "main", fetchedAt: "2026-11-18T09:00:00Z",
  // Illustrated placeholders (web/img/demo) — how real GitLab photos will look.
  avatars: Object.fromEntries(PEOPLE.map((name, i) => [name, `img/demo/${PHOTOS[i]}.svg`])),
};

const VERBS = ["add", "fix", "refactor", "tune", "cover", "split", "drop", "speed up", "document", "harden"];
const THINGS = [
  "token refresh", "retry policy", "batch export", "XML validator", "report export", "auth session",
  "cache layer", "error pages", "search index", "PDF render", "audit log", "settings screen",
  "rate limiter", "import wizard", "metrics", "CI pipeline", "schema migration", "webhooks",
];
const MR_TITLES = [
  "Auth token rotation", "Paginated project sync", "Canary routing", "Design tokens", "Batch export",
  "Incremental sync cursor", "Audit trail", "Dark theme", "Docs profile v2", "Bulk import", "Search v2",
  "Retry with backoff", "Release notes generator", "Graceful shutdown", "Webhook listener",
];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const day = (t) => new Date(t).toISOString().slice(0, 10);
const D = (s) => Date.parse(`${s}T12:00:00Z`);
const DAY = 86_400_000;

function makeProject(r, { id, desc, owner, created, from, to, team, mainEvery, mrs, born = false }) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const sha = () => Math.floor(r() * 0xffffffff).toString(16).padStart(8, "0");
  const msg = () => `${pick(VERBS)} ${pick(THINGS)}`;
  const lines = () => {
    const add = Math.round(r() ** 2 * 900) + 3;
    return { additions: add, deletions: Math.round(add * r() * 0.6) };
  };
  const events = [];
  if (born) events.push({ type: "created", date: created, author: owner });
  // main-line commits
  for (let t = D(from); t <= D(to); t += DAY * (1 + Math.floor(r() * mainEvery))) {
    events.push({ type: "commit", date: day(t), sha: sha(), message: msg(), author: pick(team), ...lines() });
  }
  // MRs: [openDay, mergeDay, commits, squash?]
  for (const [i, m] of mrs.entries()) {
    const author = pick(team);
    const open = D(m.open), merge = D(m.merge);
    const commits = [];
    for (let k = 0; k < m.commits; k++) {
      const t = open + Math.round(((merge - open) * k) / Math.max(1, m.commits));
      commits.push({
        type: "commit", date: day(t), sha: sha(), message: msg(),
        author: r() < 0.75 ? author : pick(team),
        ...(m.squash ? { additions: null, deletions: null } : lines()),
      });
    }
    const add = commits.reduce((n, c) => n + (c.additions || 0), 0);
    const del = commits.reduce((n, c) => n + (c.deletions || 0), 0);
    events.push({
      type: "mr", date: m.merge, iid: i + 1, title: MR_TITLES[(i * 7 + id.length) % MR_TITLES.length], author, merged: true,
      commitCount: m.commits, commits,
      ...(m.squash ? {} : { additions: add, deletions: del, files: 1 + Math.floor(r() * 12) }),
    });
  }
  return { id, name: id, path: `demo/${id}`, author: owner, createdAt: created, description: desc, defaultBranch: "main", webUrl: "", events };
}

function build() {
  const r = rng(20261118);
  const P = PEOPLE;
  return [
    makeProject(r, {
      id: "core-platform", desc: L10N("Базовые сервисы платформы и общие контракты", "Core platform services and shared contracts"), owner: P[0], created: "2025-02-14",
      from: "2026-01-12", to: "2026-11-12", team: [P[0], P[1], P[3]], mainEvery: 21,
      mrs: [
        { open: "2026-01-20", merge: "2026-02-03", commits: 5 },
        { open: "2026-01-28", merge: "2026-02-10", commits: 3 },       // overlaps the first one
        { open: "2026-04-06", merge: "2026-04-21", commits: 6 },
        { open: "2026-09-01", merge: "2026-09-04", commits: 2, squash: true },
        { open: "2026-10-12", merge: "2026-11-05", commits: 7 },
      ],
    }),
    makeProject(r, {
      id: "ops-gateway", desc: L10N("Единая точка входа для внутренних операционных API", "A single gateway for internal operations APIs"), owner: P[1], created: "2026-02-02",
      from: "2026-02-03", to: "2026-07-20", team: [P[1], P[2]], mainEvery: 14, born: true,
      mrs: [
        { open: "2026-02-10", merge: "2026-02-24", commits: 4 },
        { open: "2026-05-04", merge: "2026-05-19", commits: 3 },
      ],
    }),
    makeProject(r, {
      id: "life-way-ingest", desc: L10N("Сбор истории GitLab: проекты, коммиты, merge requests", "Collects GitLab history: projects, commits, merge requests"), owner: P[4], created: "2026-03-09",
      from: "2026-03-10", to: "2026-11-16", team: [P[4], P[5], P[6]], mainEvery: 12, born: true,
      mrs: [
        { open: "2026-03-16", merge: "2026-04-02", commits: 6 },
        { open: "2026-03-23", merge: "2026-03-30", commits: 2 },
        { open: "2026-06-08", merge: "2026-06-26", commits: 5 },
        { open: "2026-08-17", merge: "2026-09-02", commits: 4 },
        { open: "2026-10-26", merge: "2026-11-13", commits: 6 },
      ],
    }),
    makeProject(r, {
      id: "api-adapters", desc: L10N("Адаптеры внешних API для внутренних сервисов", "Adapters from external APIs to internal services"), owner: P[3], created: "2025-03-21",
      from: "2026-02-16", to: "2026-05-06", team: [P[3], P[0]], mainEvery: 9,
      mrs: [{ open: "2026-03-02", merge: "2026-03-20", commits: 4 }],
    }),
    makeProject(r, {
      id: "portal-ui", desc: L10N("Фронтенд внутреннего портала команды", "Front end of the team's internal portal"), owner: P[2], created: "2026-05-12",
      from: "2026-05-13", to: "2026-11-17", team: [P[2], P[6], P[1]], mainEvery: 10, born: true,
      mrs: [
        { open: "2026-05-18", merge: "2026-06-03", commits: 5 },
        { open: "2026-07-06", merge: "2026-07-24", commits: 4 },
        { open: "2026-07-13", merge: "2026-08-07", commits: 6 },
        { open: "2026-10-05", merge: "2026-10-16", commits: 3, squash: true },
      ],
    }),
    makeProject(r, {
      id: "notify-bus", desc: L10N("Шина уведомлений для MR и пайплайнов", "Notification bus for MRs and pipelines"), owner: P[5], created: "2026-08-04",
      from: "2026-08-05", to: "2026-11-10", team: [P[6], P[2]], mainEvery: 8, born: true,
      mrs: [{ open: "2026-08-24", merge: "2026-09-11", commits: 5 }],
    }),
  ];
}

/** The team's own marks, as fetch_gitlab.py would export them. */
function addSpecialMoments(projects) {
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
  const leaver = PEOPLE[5]; // Сергей Дудин
  const farewellDay = "2026-09-25";
  // He leaves: nothing of his after the farewell commit.
  for (const p of projects) {
    p.events = p.events.filter((e) => !(e.author === leaver && e.date > farewellDay));
    for (const e of p.events) {
      if (e.commits) {
        e.commits = e.commits.filter((c) => !(c.author === leaver && c.date > farewellDay));
        e.commitCount = e.commits.length;
      }
    }
  }
  byId["life-way-ingest"].events.push({
    type: "commit", date: farewellDay, sha: "b1e55ed0", message: L10N("handover: README для новой команды", "handover: README for the new team"),
    author: leaver, additions: 212, deletions: 9, special: "goodbye", note: L10N("Спасибо, команда! Было круто.", "Thank you, team! It was a great ride."),
  });
  byId["api-adapters"].events.push({
    type: "commit", date: "2026-05-08", sha: "f1a1e2d0", message: "release 2.0",
    author: PEOPLE[3], additions: 48, deletions: 31, special: "finish", note: L10N("Передали в эксплуатацию", "Handed over to production"),
  });
  return projects;
}

export const MOCK_RAW = addSpecialMoments(build());
