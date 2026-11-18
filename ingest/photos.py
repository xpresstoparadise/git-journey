"""People's own photos from a folder: `photos/Ирина Савельева.jpg`,
`photos/isaveleva@corp.example.png`, `photos/isaveleva.webp` — named by full name (any
spelling the author book knows), commit e-mail or login. They win over GitLab
avatars, so anyone can fix or add their picture without touching GitLab.
"""
from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from .authors import AuthorBook

PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}
MAX_BYTES = 5_000_000


def photo_owner(stem: str, book: AuthorBook, known: set[str]) -> str | None:
    """Which known author a file name points to (None if nobody)."""
    tries = [{"email": stem}] if "@" in stem else [{"name": stem}, {"name": None, "username": stem}]
    for t in tries:
        who = book.resolve(name=t.get("name"), email=t.get("email"), username=t.get("username"))
        if who in known:
            return who
    return None


def collect_photos(photos_dir: Path, book: AuthorBook, known: set[str], data_dir: Path) -> dict[str, str]:
    """Copy matching photos into data_dir/avatars; returns {author: "avatars/<file>"}."""
    if not photos_dir.is_dir():
        return {}
    target = data_dir / "avatars"
    result: dict[str, str] = {}
    unmatched = []
    for f in sorted(photos_dir.iterdir()):
        if f.suffix.lower() not in PHOTO_EXT or not f.is_file() or f.stat().st_size > MAX_BYTES:
            continue
        who = photo_owner(f.stem, book, known)
        if not who:
            unmatched.append(f.name)
            continue
        target.mkdir(parents=True, exist_ok=True)
        name = f"p-{hashlib.sha1(who.encode('utf-8')).hexdigest()[:12]}{f.suffix.lower()}"
        shutil.copyfile(f, target / name)
        result[who] = f"avatars/{name}"
    if result:
        print(f"Фото из {photos_dir}: {len(result)}")
    if unmatched:
        print(f"  ! не нашёл, чьи это фото (назовите файл именем, e-mail или логином): {', '.join(unmatched)}")
    return result
