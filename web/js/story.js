// Which visits the camera stops at. Pure.
//
// «Главное»: every repo's birth and every finished repo's merge back — the plot —
// then the strongest of the rest (MRs, big diffs) up to `max`.
// One person's way: every visit where they changed something.
// Special moments (Journey: finish / goodbye) are always stops.
// Everything else lights up in the background as the trunk flies past.

export function visitScore(v) {
  let lines = 0, mrs = 0;
  for (const n of v.nodes) {
    if (n.kind === "mr") mrs++;
    else lines += (n.event.additions || 0) + (n.event.deletions || 0);
  }
  return mrs * 12 + Math.log10(1 + lines) * 6 + v.nodes.length;
}

/**
 * Does this special moment belong in the film? Everyone's film: always.
 * One person's film: only *their* goodbye, and a finish only of a repo they worked in.
 */
export function specialPlays(node, person = null) {
  const e = node.event;
  if (!e.special) return false;
  if (!person) return true;
  if (e.special === "goodbye") return e.author === person;
  return node.lane.nodes.some((n) => n.event.author === person);
}

export const hasSpecial = (v, person = null) => v.nodes.some((n) => specialPlays(n, person));

export function keyVisits(visits, { max = 30, person = null } = {}) {
  const keep = new Set();
  if (person) {
    for (const v of visits) {
      if (hasSpecial(v, person) || v.nodes.some((n) => n.event.author === person)) keep.add(v.index);
    }
    return keep;
  }
  for (const v of visits) {
    if (v.first || (v.last && !v.lane.alive) || hasSpecial(v)) keep.add(v.index);
  }
  const rest = visits
    .filter((v) => !keep.has(v.index))
    .map((v) => ({ v, s: visitScore(v) }))
    .sort((a, b) => b.s - a.s);
  for (const { v } of rest) {
    if (keep.size >= max) break;
    keep.add(v.index);
  }
  return keep;
}
