"""Incremental refresh: a project whose `last_activity_at` has not moved since the
previous export is reused as is — no API calls. Changed projects are refetched
in full, so totals stay exact (no merge arithmetic on partial history)."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from .authors import AuthorBook

# Bump when an export gains data that old exports lack (2: MR commits, avatars,
# special marks). An older cache is never reused — otherwise projects without new
# activity kept the old shape forever (MRs that never open into commits).
DATA_FORMAT = 2


def load_previous(out_dir: Path, period: str, url: str) -> dict[str, dict]:
    path = out_dir / "gitlab_raw.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if str(data.get("period")) != str(period) or data.get("source") != url:
        return {}  # different scope — nothing is reusable
    if data.get("format") != DATA_FORMAT:
        print(f"Кэш {path.name} в старом формате — выгружаю всё заново")
        return {}
    return {str(p["id"]): p for p in data.get("projects", []) if p.get("lastActivityAt")}


def reusable(previous: dict[str, dict], project: dict, default_branch: str) -> dict | None:
    prev = previous.get(str(project.get("id")))
    if not prev or not project.get("last_activity_at"):
        return None
    branch = (project.get("default_branch") or default_branch or "main").strip()
    if prev["lastActivityAt"] != project["last_activity_at"] or prev.get("defaultBranch") != branch:
        return None
    return prev


def observe_cached(book: AuthorBook, projects: list[dict]) -> None:
    for p in projects:
        book.observe(p.get("author"))
        for e in p.get("events", []):
            book.observe(e.get("author"))
        for name in (p.get("totals") or {}).get("authors", {}):
            book.observe(name)


def reresolve(project: dict, book: AuthorBook) -> dict:
    """Apply today's author aliases to a project exported earlier."""
    totals = dict(project.get("totals") or {})
    merged: dict[str, dict[str, int]] = defaultdict(lambda: {"commits": 0, "mrs": 0, "additions": 0, "deletions": 0})
    for name, row in (totals.get("authors") or {}).items():
        acc = merged[book.resolve(name)]
        for k in acc:
            acc[k] += int(row.get(k) or 0)
    totals["authors"] = dict(sorted(merged.items()))
    return {
        **project,
        "author": book.resolve(project.get("author")),
        "events": [{**e, "author": book.resolve(e.get("author"))} for e in project.get("events", [])],
        "totals": totals,
    }


def previous_avatars(out_dir: Path) -> dict[str, str]:
    path = out_dir / "gitlab_raw.json"
    try:
        return dict(json.loads(path.read_text(encoding="utf-8")).get("avatars") or {})
    except (OSError, ValueError):
        return {}
