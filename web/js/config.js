// Film settings from journey.json (delivered as data/config.js → window.LIFEWAY_CONFIG).
// Every key is optional; URL parameters still win over the file. Node-safe.

const DEFAULTS = {
  title: "",
  subtitle: "",
  language: "auto",
  film: {
    mode: "highlights",
    speed: 1,
    highlightStops: 26,
    cardMinSeconds: 3.5,
    farewellSeconds: 15,
    sparks: true,
    sparkler: true,
    grain: true,
    confetti: true,
    accent: "",
  },
  ranking: { commit: 1, mr: 3, newRepo: 2 },
  aliveDays: 90,
};

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (k.startsWith("_") || v == null) continue;
    out[k] = base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) && typeof v === "object" ? merge(base[k], v) : v;
  }
  return out;
}

const raw = typeof window !== "undefined" ? window.LIFEWAY_CONFIG : null;
export const CONFIG = merge(DEFAULTS, raw && typeof raw === "object" ? raw : {});
