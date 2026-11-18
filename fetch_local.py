"""Life Way from local clones — no GitLab, no token, just git.

    repos/    put your clones here (git clone …), as many as you like
    photos/   people's photos: «Имя Фамилия.jpg», «login.png» or «name@corp.example.webp»

    python fetch_local.py                  # repos/ → web/data, then open the UI
    python fetch_local.py D:/work/clones --period 2025-2026 --branch main
    python fetch_local.py --no-serve       # only build the data
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from ingest.authors import AuthorBook
from ingest.collect import finalize, observe_all
from ingest.config import load_settings
from ingest.export import write_dataset
from ingest.local import GitError, collect_all, git
from ingest.photos import collect_photos
from ingest.special import SpecialMarks


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("repos", nargs="?", help="folder with clones (default: repos/, LIFEWAY_REPOS)")
    ap.add_argument("--period", help="2026 or 2025-2026 (GITLAB_PERIOD)")
    ap.add_argument("--branch", help="main branch name (GITLAB_DEFAULT_BRANCH, default main)")
    ap.add_argument("--photos", help="folder with photos (default: photos/, LIFEWAY_PHOTOS)")
    ap.add_argument("--no-serve", action="store_true", help="only build web/data, don't start the UI")
    ap.add_argument("--lan", action="store_true", help="serve on the local network, not only this computer")
    ap.add_argument("--port", type=int, default=8766)
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        settings = load_settings({"GITLAB_PERIOD": args.period, "GITLAB_DEFAULT_BRANCH": args.branch,
                                  "LIFEWAY_REPOS": args.repos, "LIFEWAY_PHOTOS": args.photos})
        git(Path("."), "--version")
    except (ValueError, GitError) as e:
        print(e, file=sys.stderr)
        return 2

    root = settings.repos_dir
    if not root.is_dir():
        root.mkdir(parents=True, exist_ok=True)
        print(f"Папка {root} создана — положите в неё клоны репозиториев (git clone …) и запустите снова.")
        return 1

    marks = SpecialMarks(settings.finish_re, settings.goodbye_re)
    drafts = collect_all(root, settings.period, settings.default_branch, marks, settings.max_commits)
    if not drafts:
        print(f"Нет изменений за {settings.period} ни в одном репозитории из {root}.", file=sys.stderr)
        return 1

    book = AuthorBook.from_file(settings.authors_file)
    observe_all(book, drafts)
    result = sorted((finalize(d, book) for d in drafts), key=lambda p: (p["createdAt"] or "", p["name"]))
    known = {a for p in result for a in p["totals"]["authors"]} | {p["author"] for p in result}
    photos = collect_photos(settings.photos_dir, book, known, settings.out_dir)

    meta = {
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": f"local: {root.resolve().name}",
        "period": str(settings.period),
        "defaultBranch": settings.default_branch,
        "avatars": photos,
    }
    from serve import ensure_site  # binary: unpack the UI next to the executable first
    ensure_site()
    json_path, js_path = write_dataset(settings.out_dir, meta, result)
    print(f"Авторы ({len(known)}): {', '.join(sorted(known))}")
    missing = sorted(known - set(photos))
    if missing and settings.photos_dir.is_dir():
        print(f"Без фото: {', '.join(missing)}")
    print(f"Готово: {js_path} ({len(result)} репо)")

    if args.no_serve:
        return 0
    import serve  # noqa: PLC0415 — only when we actually serve
    serve.run("0.0.0.0" if args.lan else "127.0.0.1", args.port, browser=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
