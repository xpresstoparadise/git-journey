// Small shared helpers. No DOM here — this module is imported by node tests too.

export const DAY_MS = 86_400_000;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** "2026-03-16" → local midnight timestamp (no TZ drift). */
export function parseDay(s) {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

export function toDay(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Monday 00:00 of the week containing t. */
export function weekStart(t) {
  const d = new Date(t);
  const shift = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - shift).getTime();
}

const fmtShort = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const fmtLong = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });
const fmtMonth = new Intl.DateTimeFormat("ru-RU", { month: "short" });
const fmtMonthLong = new Intl.DateTimeFormat("ru-RU", { month: "long" });

const clean = (s) => s.replace(/\.$/, "").replace(" г", "");
export const fmtDay = (t) => clean(fmtShort.format(t));
export const fmtDate = (t) => clean(fmtLong.format(t));
export const fmtMonthShort = (t) => clean(fmtMonth.format(t));
export const fmtMonthName = (t) => fmtMonthLong.format(t);

export const fmtInt = (n) => Math.round(n || 0).toLocaleString("ru-RU");
export function fmtCompact(n) {
  const v = Math.abs(n || 0);
  if (v >= 1e6) return `${(n / 1e6).toFixed(1).replace(".0", "")}M`;
  if (v >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (v >= 1e3) return `${(n / 1e3).toFixed(1).replace(".0", "")}k`;
  return String(Math.round(n || 0));
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function truncate(s, max) {
  const t = String(s ?? "").trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Russian plural: plural(5, ["коммит", "коммита", "коммитов"]). */
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export function initials(name) {
  const parts = String(name).trim().split(/[\s_.]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
