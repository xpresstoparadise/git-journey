"""Repository icons, saved next to the dataset like author photos (the UI never
reaches GitLab itself). Sources, strongest first:

1. your own file `photos/repos/<repo name>.png` (any of PHOTO_EXT) — always wins;
2. GitLab: the project's `avatar_url`;
3. local clones: a logo committed in the repo (`logo.svg`, `.gitlab/logo.png`, …).

No icon → the UI draws a tile with the repo's first letter in its colour.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from .avatars import EXT, MAX_BYTES
from .gitlab import GitLabError
from .photos import PHOTO_EXT

# Where projects usually keep a logo; first hit wins. Small and conventional on purpose.
LOGO_NAMES = ["logo", "icon", "avatar"]
LOGO_DIRS = ["", ".gitlab", ".github", "assets", "docs", "doc", "images", "img", "static", "public"]
LOGO_EXT = [".svg", ".png", ".webp", ".jpg", ".jpeg"]
FILE_EXT = {".svg": ".svg", ".png": ".png", ".webp": ".webp", ".jpg": ".jpg", ".jpeg": ".jpg", ".gif": ".gif"}


def store(data: bytes, ext: str, key: str, data_dir: Path) -> str:
    """Write an icon into data_dir/avatars; returns the path relative to data_dir."""
    target = data_dir / "avatars"
    target.mkdir(parents=True, exist_ok=True)
    file = f"repo-{hashlib.sha1(key.encode('utf-8')).hexdigest()[:12]}{ext}"
    (target / file).write_bytes(data)
    return f"avatars/{file}"


def copy_file(src: Path, key: str, data_dir: Path) -> str | None:
    ext = FILE_EXT.get(src.suffix.lower())
    if not ext or not src.is_file() or src.stat().st_size > MAX_BYTES:
        return None
    return store(src.read_bytes(), ext, key, data_dir)


def find_logo(repo: Path) -> Path | None:
    """A logo committed in a working copy, by convention (see LOGO_*)."""
    for d in LOGO_DIRS:
        for name in LOGO_NAMES:
            for ext in LOGO_EXT:
                p = repo / d / f"{name}{ext}"
                if p.is_file() and p.stat().st_size <= MAX_BYTES:
                    return p
    return None


def fetch_gitlab_icons(api, drafts, data_dir: Path) -> dict[str, str]:
    """Project id → "avatars/<file>" for projects whose GitLab avatar downloads."""
    out: dict[str, str] = {}
    for d in drafts:
        url = d.meta.get("_icon")
        if not url:
            continue
        try:
            data, ctype = api.download(url, max_bytes=MAX_BYTES)
        except (GitLabError, OSError, ValueError):
            continue
        ext = EXT.get((ctype or "").split(";")[0].strip().lower())
        if ext and data:
            out[d.meta["id"]] = store(data, ext, f"gitlab:{d.meta['id']}", data_dir)
    return out


def local_icons(drafts, data_dir: Path) -> dict[str, str]:
    """Project id → icon copied from a logo found in the clone."""
    out: dict[str, str] = {}
    for d in drafts:
        src = d.meta.get("_logo")
        if src and (rel := copy_file(Path(src), f"local:{d.meta['id']}", data_dir)):
            out[d.meta["id"]] = rel
    return out


def own_icons(photos_dir: Path, projects: list[dict], data_dir: Path) -> dict[str, str]:
    """Project id → icon from photos/repos/<name or path>.<ext>; these win over everything."""
    folder = photos_dir / "repos"
    if not folder.is_dir():
        return {}
    by_key: dict[str, str] = {}
    for p in projects:
        for key in (p.get("name"), p.get("path"), (p.get("path") or "").rsplit("/", 1)[-1]):
            if key:
                by_key.setdefault(key.lower(), p["id"])
    out: dict[str, str] = {}
    unmatched = []
    for f in sorted(folder.iterdir()):
        if f.suffix.lower() not in PHOTO_EXT or not f.is_file():
            continue
        pid = by_key.get(f.stem.lower())
        if pid is None:
            unmatched.append(f.name)
            continue
        if rel := copy_file(f, f"own:{pid}", data_dir):
            out[pid] = rel
    if unmatched:
        print(f"  ! иконки без репозитория (назовите файл как репо): {', '.join(unmatched)}", file=sys.stderr)
    return out


def apply_icons(projects: list[dict], data_dir: Path, *sources: dict[str, str]) -> int:
    """Set project["icon"]: later sources win; a cached icon stays if its file exists."""
    n = 0
    for p in projects:
        icon = p.get("icon") if p.get("icon") and (data_dir / p["icon"]).exists() else None
        for src in sources:
            icon = src.get(p["id"], icon)
        if icon:
            p["icon"] = icon
            n += 1
        else:
            p.pop("icon", None)
    return n
