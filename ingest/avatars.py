"""Author photos from GitLab, saved next to the dataset so the UI never has to
reach GitLab itself (auth, proxy, offline LAN, video recording all just work).

Sources, best first: `avatar_url` that the API returned with an MR author or a
repo owner, then `GET /avatar?email=` for commit authors (no admin needed).
Anything that fails simply falls back to initials in the UI.
"""
from __future__ import annotations

import hashlib
import sys
import urllib.parse
from pathlib import Path

from .authors import AuthorBook
from .gitlab import GitLabError

EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg"}
MAX_BYTES = 2_000_000


def no_default_gravatar(url: str) -> str:
    """Gravatar answers with a generic silhouette by default; ask for a 404 instead."""
    parts = urllib.parse.urlsplit(url)
    if "gravatar.com" not in parts.netloc:
        return url
    query = dict(urllib.parse.parse_qsl(parts.query))
    query["d"] = "404"
    query.setdefault("s", "128")
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))


def candidates(drafts, book: AuthorBook) -> dict[str, list[tuple[str, str]]]:
    """Resolved author name → [("url", …) | ("email", …)], best first, deduplicated."""
    out: dict[str, list[tuple[str, str]]] = {}

    def add(who, kind, value):
        if not value:
            return
        name = book.resolve(**who.ident)
        lst = out.setdefault(name, [])
        if (kind, value) not in lst:
            lst.append((kind, value))

    for d in drafts:
        owner = d.meta["_owner"]
        add(owner, "url", owner.avatar)
        for who in d.all_mrs:
            add(who, "url", who.avatar)
        for _, who in d.all_commits:
            add(who, "email", who.email)
    for lst in out.values():
        lst.sort(key=lambda c: c[0] != "url")  # API-given URLs first
    return out


def fetch_avatars(api, drafts, book: AuthorBook, data_dir: Path, previous: dict[str, str] | None = None) -> dict[str, str]:
    """Download one photo per author into data_dir/avatars; returns {name: "avatars/<file>"}."""
    target = data_dir / "avatars"
    result: dict[str, str] = {}
    for name, cands in sorted(candidates(drafts, book).items()):
        for kind, value in cands[:4]:
            try:
                url = value
                if kind == "email":
                    url = (api.get("/avatar", {"email": value, "size": 128}) or {}).get("avatar_url")
                if not url:
                    continue
                data, ctype = api.download(no_default_gravatar(url), max_bytes=MAX_BYTES)
            except (GitLabError, OSError, ValueError):
                continue
            ext = EXT.get((ctype or "").split(";")[0].strip().lower())
            if not ext or not data:
                continue
            target.mkdir(parents=True, exist_ok=True)
            file = f"{hashlib.sha1(name.encode('utf-8')).hexdigest()[:12]}{ext}"
            (target / file).write_bytes(data)
            result[name] = f"avatars/{file}"
            break
    for name, rel in (previous or {}).items():  # keep earlier photos for authors we could not refresh
        if name not in result and (data_dir / rel).exists():
            result[name] = rel
    missing = sorted(set(candidates(drafts, book)) - set(result))
    if missing:
        print(f"  ! без фото: {', '.join(missing)}", file=sys.stderr)
    return result
