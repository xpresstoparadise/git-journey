// Layout invariants — run: node --test tests/
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import { authorSummary, loadDataset, periodBounds, periodOptions, sliceProjects, withBranchCommits } from "../web/js/data.js";
import { GEOMETRY, buildLayout } from "../web/js/layout.js";
import { MOCK_META, MOCK_RAW } from "../web/js/mock.js";

function realData() {
  const file = new URL("../web/data/gitlab_raw.js", import.meta.url);
  if (!fs.existsSync(file)) return null;
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx);
  return ctx.window.GITLAB_RAW?.length ? { raw: ctx.window.GITLAB_RAW, meta: ctx.window.GITLAB_META } : null;
}

const datasets = [["mock", loadDataset(MOCK_RAW, MOCK_META)]];
const real = realData();
if (real) datasets.push(["gitlab export", loadDataset(real.raw, real.meta)]);

for (const [name, ds] of datasets) {
  const period = ds.period ?? String(ds.years.at(-1));
  const bounds = periodBounds(ds, period);
  const projects = sliceProjects(ds, bounds);
  const L = buildLayout(projects, bounds);

  test(`${name}: every event becomes exactly one node`, () => {
    const events = projects.reduce((n, p) => n + withBranchCommits(p.events).length, 0);
    const nodes = L.lanes.reduce((n, l) => n + l.nodes.length, 0);
    assert.equal(nodes, events);
    assert.equal(L.visits.reduce((n, v) => n + v.nodes.length, 0), events);
  });

  test(`${name}: nodes inside a lane never overlap`, () => {
    for (const lane of L.lanes) {
      for (let i = 1; i < lane.nodes.length; i++) {
        assert.ok(lane.nodes[i].h - lane.nodes[i - 1].h >= GEOMETRY.NODE_GAP - 0.01, `${lane.project.name} #${i}`);
      }
    }
  });

  test(`${name}: lanes sharing a slot never overlap in time`, () => {
    const bySlot = new Map();
    for (const lane of L.lanes) {
      const hi = lane.alive ? Infinity : lane.mergeH;
      for (const other of bySlot.get(lane.slot) || []) {
        assert.ok(lane.forkH >= other.hi || other.lo >= hi, `${lane.project.name} vs ${other.name}`);
      }
      bySlot.set(lane.slot, [...(bySlot.get(lane.slot) || []), { lo: lane.forkH, hi, name: lane.project.name }]);
    }
  });

  test(`${name}: time runs upward and visits are chronological`, () => {
    for (let i = 1; i < L.rows.length; i++) assert.ok(L.rows[i].h0 >= L.rows[i - 1].h1);
    for (let i = 1; i < L.visits.length; i++) {
      assert.ok(L.visits[i].row.t0 >= L.visits[i - 1].row.t0);
    }
    assert.ok(L.yAt(bounds[0]) > L.yAt(bounds[1]), "later dates are higher on screen");
    assert.ok(Math.abs(L.tAt(L.hAt(bounds[0] + 40 * 86400000)) - (bounds[0] + 40 * 86400000)) < 86400000);
  });

  test(`${name}: everything fits inside the world`, () => {
    for (const lane of L.lanes) {
      assert.ok(lane.x > 0 && lane.x < L.width);
      for (const n of lane.nodes) assert.ok(n.y > 0 && n.y < L.height);
    }
  });

  test(`${name}: leaderboard is sorted and positive`, () => {
    const authors = authorSummary(projects, { dataset: ds, period });
    assert.ok(authors.length > 0);
    for (let i = 1; i < authors.length; i++) assert.ok(authors[i - 1].score >= authors[i].score);
  });
}

test("merge commits are dropped and author spellings merge", () => {
  const ds = loadDataset([{
    id: 1, name: "x", createdAt: "2026-01-01", author: "A",
    events: [
      { type: "commit", date: "2026-01-02", message: "init", author: "Lena_Frost", additions: 1, deletions: 0 },
      { type: "commit", date: "2026-01-03", message: "Merge branch 'f' into 'main'", author: "Lena Frost" },
      { type: "commit", date: "2026-01-04", message: "more", author: "Lena Frost", additions: 1, deletions: 0 },
    ],
  }], { period: "2026" });
  assert.equal(ds.projects[0].events.length, 2);
  assert.deepEqual([...new Set(ds.projects[0].events.map((e) => e.author))], ["Lena Frost"]);
  assert.deepEqual(periodOptions(ds).map((o) => o.value), ["2026"]);
});

test("highlights keep every birth and merge, and stay within budget", async () => {
  const { keyVisits } = await import("../web/js/story.js");
  for (const [, ds] of datasets) {
    const period = ds.period ?? String(ds.years.at(-1));
    const bounds = periodBounds(ds, period);
    const L = buildLayout(sliceProjects(ds, bounds), bounds);
    const keep = keyVisits(L.visits, { max: 30 });
    for (const v of L.visits) {
      if (v.first || (v.last && !v.lane.alive)) assert.ok(keep.has(v.index));
    }
    const mandatory = L.visits.filter((v) => v.first || (v.last && !v.lane.alive)).length;
    assert.ok(keep.size <= Math.max(30, mandatory));
  }
});

test("MRs measured as 0/0 by old exports read as unknown", () => {
  const ds = loadDataset([{ id: 1, name: "x", createdAt: "2026-01-01", author: "A", events: [
    { type: "mr", date: "2026-01-02", iid: 1, title: "t", author: "A", additions: 0, deletions: 0 },
    { type: "mr", date: "2026-01-03", iid: 2, title: "t", author: "A", additions: 4, deletions: 1, files: 2 },
  ] }], {});
  assert.equal(ds.projects[0].events[0].additions, null);
  assert.equal(ds.projects[0].events[1].additions, 4);
});

test("MR branches: commits ride the branch between fork and merge", () => {
  const ds = loadDataset(MOCK_RAW, MOCK_META);
  const bounds = periodBounds(ds, "2026");
  const L = buildLayout(sliceProjects(ds, bounds), bounds);
  let withCommits = 0, parallel = 0;
  for (const lane of L.lanes) {
    for (const b of lane.branches) {
      assert.ok(b.h0 < b.h1 && b.h1 <= b.hTop && b.hTop < b.h3, `${lane.project.name} !${b.event.iid} order`);
      assert.equal(b.node.kind, "mr");
      for (const c of b.commits) {
        assert.ok(c.h >= b.h1 && c.h <= b.hTop, "commit on its branch");
        assert.equal(c.x, b.x);
      }
      assert.equal(b.commits.length, b.event.commits.length);
      if (b.commits.length) withCommits++;
      assert.notEqual(b.x, lane.x);
      if (b.track > 0) parallel++;
    }
  }
  assert.ok(withCommits >= 10, "demo has MRs with commits");
  assert.ok(parallel >= 2, "overlapping MRs get their own track");
});

test("special moments: always stops, finish closes the repo, person mode follows one author", async () => {
  const { keyVisits, hasSpecial } = await import("../web/js/story.js");
  const ds = loadDataset(MOCK_RAW, MOCK_META);
  const bounds = periodBounds(ds, "2026");
  const projects = sliceProjects(ds, bounds);
  const L = buildLayout(projects, bounds);
  const special = L.visits.filter((v) => hasSpecial(v));
  assert.equal(special.length, 2, "one finish + one goodbye in the demo");
  const keep = keyVisits(L.visits, { max: 5 });
  for (const v of special) assert.ok(keep.has(v.index));
  const finished = projects.find((p) => p.id === "api-adapters");
  assert.equal(finished.alive, false);
  assert.equal(finished.finish.special, "finish");
  const person = "Сергей Дудин";
  const mine = keyVisits(L.visits, { person });
  for (const v of L.visits) {
    const his = v.nodes.some((n) => n.event.author === person);
    assert.equal(mine.has(v.index), his || hasSpecial(v, person));
  }
  // Someone else's film: Сергей's goodbye is not a scene there.
  const { specialPlays } = await import("../web/js/story.js");
  const bye = L.lanes.flatMap((l) => l.nodes).find((n) => n.event.special === "goodbye");
  assert.equal(specialPlays(bye, person), true);
  assert.equal(specialPlays(bye, "Ольга Белова"), false);
  assert.equal(specialPlays(bye, null), true);
  const fin = L.lanes.flatMap((l) => l.nodes).find((n) => n.event.special === "finish");
  assert.equal(specialPlays(fin, "Ольга Белова"), false, "she never worked in api-adapters");
  assert.equal(specialPlays(fin, "Никита Волков"), true);
});

test("several marks: only the latest goodbye per person and finish per repo play", async () => {
  const { keyVisits, hasSpecial } = await import("../web/js/story.js");
  const c = (date, author, special, note = "") => ({ type: "commit", date, message: "x", author, additions: 1, deletions: 0, special, note });
  const ds = loadDataset([
    { id: "a", name: "a", createdAt: "2026-01-01", author: "Ann", events: [
      c("2026-02-01", "Bob", "goodbye", "рано"),
      c("2026-03-01", "Ann", "finish", "первый"),
      c("2026-04-01", "Ann", "finish", "второй"),
    ] },
    { id: "b", name: "b", createdAt: "2026-01-01", author: "Bob", events: [
      c("2026-05-01", "bob", "goodbye", "по-настоящему"), // same person, other spelling
      c("2026-05-02", "Cid", null),
    ] },
  ], { period: "2026" });
  const specials = ds.projects.flatMap((p) => p.events).filter((e) => e.special);
  assert.deepEqual(specials.map((e) => [e.special, e.note]).sort(), [["finish", "второй"], ["goodbye", "по-настоящему"]]);
  const L = buildLayout(sliceProjects(ds, periodBounds(ds, "2026")), periodBounds(ds, "2026"));
  assert.equal(L.visits.filter((v) => hasSpecial(v)).length, 2);
  assert.ok(keyVisits(L.visits, { max: 1 }).size >= 2);
});

test("finale twinkle weight grows with the size of the change", async () => {
  const { changeSize, changeWeights } = await import("../web/js/scene.js");
  const ds = loadDataset(MOCK_RAW, MOCK_META);
  const bounds = periodBounds(ds, "2026");
  const L = buildLayout(sliceProjects(ds, bounds), bounds);
  const w = changeWeights(L);
  const nodes = L.lanes.flatMap((l) => l.nodes).sort((a, b) => changeSize(a.event) - changeSize(b.event));
  for (let i = 1; i < nodes.length; i++) assert.ok(w(nodes[i].event) >= w(nodes[i - 1].event));
  assert.equal(Math.max(...nodes.map((n) => w(n.event))), 1);
  assert.ok(w(nodes[0].event) < 0.3, "tiny changes barely twinkle");
});

// ---- camera framing: a lane far from the trunk must still land on screen ----
import { flightPlan, visitFrame } from "../web/js/framing.js";

function wideTeam(n = 44) {
  const day = (d) => new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
  return Array.from({ length: n }, (_, i) => ({
    id: `wide-${i}`, name: `fictional-repo-${i}`, path: `team/fictional-repo-${i}`, author: "Ada Example",
    createdAt: day(i * 6), defaultBranch: "main", webUrl: "",
    events: Array.from({ length: 12 }, (_, k) => ({
      type: "commit", date: day(i * 6 + k * 9), sha: `${i}x${k}`, message: `change ${k}`,
      author: k % 2 ? "Ada Example" : "Bob Sample", additions: 10 + k, deletions: k,
    })),
  }));
}

test("framing: every visit's lane and nodes are on screen, even far from the trunk", () => {
  const ds = loadDataset(wideTeam(), { period: "2026" });
  const bounds = periodBounds(ds, "2026");
  const L = buildLayout(sliceProjects(ds, bounds), bounds);
  const far = Math.max(...L.lanes.map((l) => Math.abs(l.x - L.trunkX)));
  assert.ok(far > 2500, `test needs a wide world (farthest lane ${far}px)`);
  for (const [safe, minZ] of [[{ width: 1600, height: 760 }, 0.85], [{ width: 420, height: 640 }, 0.5]]) {
    for (const v of L.visits) {
      const { box, z } = visitFrame(v, safe, { minZ, maxZ: 1.15 });
      const cx = (box.x0 + box.x1) / 2, half = safe.width / 2 / z;
      for (const x of [v.lane.x, ...v.nodes.map((n) => n.x)]) {
        assert.ok(x >= cx - half && x <= cx + half, `${v.lane.project.name}: x=${x} outside [${cx - half}, ${cx + half}] on ${safe.width}px`);
      }
    }
  }
});

test("framing: long flights pull back and slow down, short ones stay as they are", () => {
  assert.deepEqual(flightPlan(300, 1600, { z: 1.15, minZ: 0.47 }), { z: 1.15, slow: 1 });
  const far = flightPlan(4200, 1600, { z: 1.15, minZ: 0.47 });
  assert.ok(far.z < 1.15 && far.z >= 0.47 && far.slow > 1 && far.slow <= 1.9);
});
