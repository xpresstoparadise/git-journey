"""lifeway.json — one optional file for everything that isn't a secret.

    {
      "title": "Our team", "subtitle": "2026", "language": "auto",
      "film":    {"mode": "highlights", "speed": 1, "highlightStops": 26, ...},
      "ranking": {"commit": 1, "mr": 3, "newRepo": 2},
      "ingest":  {"groups": ["team"], "include": ["team/*"], "exclude": ["*/sandbox*"],
                  "excludeAuthors": ["renovate*", "*bot*"], "aliveDays": 90, "maxMrCommits": 30}
    }

Missing keys fall back to defaults. The ingest part is read by the fetchers; the rest
is handed to the page as web/data/config.js (written on every fetch and every
`serve`), so film settings change without re-fetching. Secrets stay in .env.
"""
from __future__ import annotations

import fnmatch
import json
import sys
from pathlib import Path

DEFAULTS: dict = {
    "title": "",          # empty: the page's own title
    "subtitle": "",
    "language": "auto",   # auto | en | ru
    "film": {
        "mode": "highlights",     # highlights | full
        "speed": 1,               # 1 | 2 | 4 (any number works from the URL too)
        "highlightStops": 26,
        "cardMinSeconds": 3.5,
        "farewellSeconds": 15,
        "sparks": True,
        "sparkler": True,
        "grain": True,
        "confetti": True,
        "accent": "",             # e.g. "#3dd6c6"; empty: theme default
    },
    "ranking": {"commit": 1, "mr": 3, "newRepo": 2},
    "ingest": {
        "groups": [],             # GitLab groups (with subgroups) instead of «all my projects»
        "include": [],            # path patterns: "team/*", "*/core-*"
        "exclude": [],
        "excludeAuthors": [],     # name / e-mail / login patterns: "renovate*", "*[bot]*"
        "aliveDays": 90,
        "maxMrCommits": 30,
    },
}


def _merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in (over or {}).items():
        if k.startswith("_"):
            continue  # "_comment" keys
        out[k] = _merge(base[k], v) if isinstance(base.get(k), dict) and isinstance(v, dict) else v
    return out


def load_file(path: Path) -> dict:
    if not path.exists():
        return _merge(DEFAULTS, {})
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as e:
        print(f"! {path.name}: {e} — using defaults", file=sys.stderr)
        data = {}
    return _merge(DEFAULTS, data if isinstance(data, dict) else {})


def ui_part(cfg: dict) -> dict:
    """What the page needs (no ingest-only keys)."""
    return {
        "title": cfg["title"], "subtitle": cfg["subtitle"], "language": cfg["language"],
        "film": cfg["film"], "ranking": cfg["ranking"], "aliveDays": cfg["ingest"]["aliveDays"],
    }


def write_ui_config(cfg: dict, data_dir: Path) -> Path:
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / "config.js"
    path.write_text("window.LIFEWAY_CONFIG = " + json.dumps(ui_part(cfg), ensure_ascii=False) + ";\n", encoding="utf-8")
    return path


def _match(value: str, patterns: list[str]) -> bool:
    v = (value or "").casefold()
    return any(fnmatch.fnmatchcase(v, p.casefold()) for p in patterns)


def wants_project(path: str, cfg: dict) -> bool:
    inc, exc = cfg["ingest"]["include"], cfg["ingest"]["exclude"]
    if inc and not _match(path, inc):
        return False
    return not _match(path, exc)


def drop_authors(project: dict, patterns: list[str]) -> dict:
    """Remove bots and other excluded authors from a finished project (events, MR
    branches and totals). Matches the resolved name, case-insensitive."""
    if not patterns:
        return project
    bad = lambda name: _match(name, patterns)  # noqa: E731
    events = []
    for e in project["events"]:
        if bad(e.get("author", "")):
            continue
        if e.get("commits"):
            e = {**e, "commits": [c for c in e["commits"] if not bad(c.get("author", ""))]}
        events.append(e)
    totals = dict(project.get("totals") or {})
    authors = {a: r for a, r in (totals.get("authors") or {}).items() if not bad(a)}
    if authors != totals.get("authors"):
        totals["authors"] = authors
        for k_src, k_dst in (("commits", "commits"), ("mrs", "mrs"), ("additions", "additions"), ("deletions", "deletions")):
            totals[k_dst] = sum(r.get(k_src, 0) for r in authors.values())
    return {**project, "events": events, "totals": totals}
