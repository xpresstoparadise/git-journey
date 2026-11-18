"""Fetch team GitLab history into web/data/gitlab_raw.{js,json}.

    python fetch_gitlab.py                    # settings from .env
    python fetch_gitlab.py --period 2025-2026 --branch main
    python fetch_gitlab.py --full             # ignore the cache, refetch everything
    python fetch_gitlab.py --suggest-authors  # alias hints from the last export
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from ingest import suggest
from ingest.authors import AuthorBook
from ingest.avatars import fetch_avatars
from ingest.photos import collect_photos
from ingest.cache import load_previous, observe_cached, previous_avatars, reresolve, reusable
from ingest.collect import collect_project, finalize, is_candidate, observe_all
from ingest.config import load_settings
from ingest.export import write_dataset
from ingest.gitlab import GitLabClient, GitLabError, disable_env_proxies


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="GitLab base URL (GITLAB_URL)")
    ap.add_argument("--period", help="2026 or 2025-2026 (GITLAB_PERIOD)")
    ap.add_argument("--branch", help="fallback default branch (GITLAB_DEFAULT_BRANCH)")
    ap.add_argument("--full", action="store_true", help="refetch every project, ignore the previous export")
    ap.add_argument("--no-avatars", action="store_true", help="skip downloading author photos")
    ap.add_argument("--suggest-authors", action="store_true", help="print alias suggestions and exit")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        settings = load_settings(
            {"GITLAB_URL": args.url, "GITLAB_PERIOD": args.period, "GITLAB_DEFAULT_BRANCH": args.branch}
        )
    except ValueError as e:
        print(e, file=sys.stderr)
        return 2
    if args.suggest_authors:
        return suggest.main(settings.out_dir)
    if not settings.token:
        print("Missing GITLAB_TOKEN: put it into .env (see .env.example)", file=sys.stderr)
        return 1

    disable_env_proxies()
    api = GitLabClient(settings.url, settings.token)
    try:
        version = api.get("/version") or {}
    except (GitLabError, OSError) as e:
        print(f"GitLab unreachable at {settings.url}: {e}", file=sys.stderr)
        return 1
    print(f"GitLab {version.get('version', '?')} @ {settings.url}  period={settings.period}  branch={settings.default_branch}")
    if settings.env_file:
        print(f"Settings from {settings.env_file}")

    projects = api.get_all(
        "/projects",
        {"membership": "true", "simple": "false", "order_by": "last_activity_at", "sort": "desc"},
    )
    candidates = [p for p in projects if is_candidate(p, settings.period)]
    print(f"Membership projects: {len(projects)} · candidates for {settings.period}: {len(candidates)}")

    previous = {} if args.full else load_previous(settings.out_dir, str(settings.period), settings.url)
    drafts, cached = [], []
    for i, project in enumerate(candidates, 1):
        print(f"[{i}/{len(candidates)}] {project.get('path_with_namespace') or project.get('name')}", flush=True)
        hit = reusable(previous, project, settings.default_branch)
        if hit:
            print("    -> без изменений, из кэша")
            cached.append(hit)
            continue
        draft = collect_project(api, project, settings)
        if not draft:
            print("    -> skip (no events in period)")
            continue
        print(f"    -> {len(draft.all_commits)} commits, {len(draft.all_mrs)} MRs @ {draft.meta['defaultBranch']}")
        drafts.append(draft)

    book = AuthorBook.from_file(settings.authors_file)
    observe_all(book, drafts)
    observe_cached(book, cached)
    fresh = [finalize(d, book) for d in drafts] + [reresolve(p, book) for p in cached]
    result = sorted(fresh, key=lambda p: (p["createdAt"], p["name"]))
    print(f"Обновлено: {len(drafts)} · из кэша: {len(cached)}")

    avatars = previous_avatars(settings.out_dir)
    if not args.no_avatars:
        print("Фото авторов…", flush=True)
        avatars = fetch_avatars(api, drafts, book, settings.out_dir, avatars)
        print(f"    -> {len(avatars)} фото в {settings.out_dir / 'avatars'}")
    avatars = {book.resolve(name): rel for name, rel in avatars.items()}
    known = {a for p in result for a in p["totals"]["authors"]} | {p["author"] for p in result}
    avatars.update(collect_photos(settings.photos_dir, book, known, settings.out_dir))  # own photos win

    meta = {
        "avatars": avatars,
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": settings.url,
        "period": str(settings.period),
        "defaultBranch": settings.default_branch,
    }
    from serve import ensure_site  # binary: unpack the UI next to the executable first
    ensure_site()
    json_path, js_path = write_dataset(settings.out_dir, meta, result)
    authors = sorted({a for p in result for a in p["totals"]["authors"]})
    print(f"Authors ({len(authors)}): {', '.join(authors)}")
    print(f"Wrote {js_path} and {json_path} ({len(result)} projects)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
