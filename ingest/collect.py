"""Turn GitLab projects into Git Journey projects: birth, commits and merged MRs on
the default branch inside the period, plus full (unsampled) contribution totals.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from dataclasses import dataclass, field

from .authors import AuthorBook
from .config import Period, Settings
from .gitlab import GitLabApi, GitLabError
from .special import SpecialMarks

EVENT_ORDER = {"created": 0, "commit": 1, "mr": 2}
MAX_MR_COMMITS = 30  # drawn on one MR branch; the MR keeps the full count


def day(iso: str | None) -> str | None:
    return iso[:10] if iso else None


def warn(msg: str) -> None:
    print(f"  ! {msg}", file=sys.stderr)


def is_merge_commit(commit: dict) -> bool:
    # Merge commits duplicate the MR they come from and double-count diff stats.
    return len(commit.get("parent_ids") or []) > 1


def sample_evenly(items: list, limit: int) -> list:
    """Keep `limit` items spread over the whole list, always keeping first and last."""
    if limit <= 0 or len(items) <= limit:
        return list(items)
    if limit == 1:
        return [items[-1]]
    step = (len(items) - 1) / (limit - 1)
    return [items[round(i * step)] for i in range(limit)]


@dataclass
class Who:
    name: str | None
    email: str | None = None
    username: str | None = None
    avatar: str | None = None  # GitLab avatar_url when the API gave one

    @property
    def ident(self) -> dict:
        return {"name": self.name, "email": self.email, "username": self.username}


@dataclass
class Draft:
    """Project with author identities still unresolved."""

    meta: dict
    events: list[tuple[dict, Who]] = field(default_factory=list)
    all_commits: list[tuple[dict, Who]] = field(default_factory=list)
    all_mrs: list[Who] = field(default_factory=list)


def project_owner(project: dict) -> Who:
    owner = project.get("owner") or {}
    if owner.get("name") or owner.get("username"):
        return Who(owner.get("name"), None, owner.get("username"), owner.get("avatar_url"))
    ns = project.get("namespace") or {}
    if ns.get("kind") == "user":
        return Who(ns.get("name"), None, ns.get("path"), ns.get("avatar_url"))
    return Who(ns.get("name") or ns.get("path") or "team")


def fetch_commits(api: GitLabApi, pid: int, branch: str, period: Period) -> list[dict]:
    return api.get_all(
        f"/projects/{pid}/repository/commits",
        {"ref_name": branch, "since": period.since, "until": period.until, "with_stats": "true"},
        max_pages=10,
    )


def collect_project(api: GitLabApi, project: dict, settings: Settings) -> Draft | None:
    period = settings.period
    pid = project["id"]
    path = project.get("path_with_namespace") or project.get("path") or str(pid)
    branch = (project.get("default_branch") or settings.default_branch or "main").strip()
    owner = project_owner(project)
    marks = SpecialMarks(settings.finish_re, settings.goodbye_re)

    try:
        commits = fetch_commits(api, pid, branch, period)
    except GitLabError as e:
        warn(f"commits {path}@{branch}: {e}")
        commits = []
        if branch != settings.default_branch:
            try:
                commits = fetch_commits(api, pid, settings.default_branch, period)
                branch = settings.default_branch
            except GitLabError as e2:
                warn(f"commits {path}@{settings.default_branch}: {e2}")

    try:
        mrs = api.get_all(
            f"/projects/{pid}/merge_requests",
            {
                "state": "merged",
                "target_branch": branch,
                "updated_after": period.since,
                "order_by": "updated_at",
                "sort": "asc",
            },
            max_pages=5,
        )
    except GitLabError as e:
        warn(f"mrs {path}: {e}")
        mrs = []

    draft = Draft(
        meta={
            "id": str(pid),
            "name": project.get("path") or project.get("name") or path,
            "path": path,
            "createdAt": day(project.get("created_at")),
            "description": (project.get("description") or "").strip() or path,
            "defaultBranch": branch,
            "webUrl": project.get("web_url") or "",
            "lastActivityAt": project.get("last_activity_at") or "",
            "_owner": owner,
        }
    )

    created = day(project.get("created_at"))
    if period.contains(created):
        draft.events.append(({"type": "created", "date": created}, owner))

    commit_rows = []
    for c in commits:
        d = day(c.get("committed_date") or c.get("created_at"))
        if not period.contains(d) or is_merge_commit(c):
            continue
        stats = c.get("stats") or {}
        event = {
            "type": "commit",
            "date": d,
            "sha": c.get("short_id") or (c.get("id") or "")[:8],
            "message": (c.get("title") or c.get("message") or "").split("\n")[0][:120],
            "additions": int(stats.get("additions") or 0),
            "deletions": int(stats.get("deletions") or 0),
        }
        event["_id"] = c.get("id") or ""
        event.update(marks.detect(c.get("message"), c.get("title")))
        commit_rows.append((event, Who(c.get("author_name"), c.get("author_email"))))
    commit_rows.sort(key=lambda row: row[0]["date"])
    draft.all_commits = commit_rows

    mr_rows = []
    for mr in mrs:
        d = day(mr.get("merged_at") or mr.get("updated_at"))
        if not period.contains(d):
            continue
        author = mr.get("author") or {}
        event = {
            "type": "mr",
            "date": d,
            "iid": mr.get("iid"),
            "title": (mr.get("title") or "")[:140],
            "branch": (mr.get("source_branch") or "")[:80],   # the MR's own branch
            "target": mr.get("target_branch") or branch,       # where it was merged
            "merged": True,
            "_squash": mr.get("squash_commit_sha") or "",
            **marks.detect(mr.get("title"), mr.get("description")),
        }
        mr_rows.append((event, Who(author.get("name"), None, author.get("username"), author.get("avatar_url"))))
    mr_rows.sort(key=lambda row: row[0]["date"])
    draft.all_mrs = [who for _, who in mr_rows]

    shown_mrs = sample_evenly(mr_rows, settings.max_mrs)
    by_sha = {}
    for event, who in commit_rows:
        by_sha[event["_id"]] = (event, who)
        by_sha[event["sha"]] = (event, who)
    on_mr: set[str] = set()  # main-line commits that belong to a drawn MR branch
    for event, _ in shown_mrs:
        if settings.mr_stats:
            event.update(mr_diff_stats(api, pid, event["iid"]))
        branch = mr_commits(api, pid, event["iid"], by_sha)
        if branch:
            event["commitCount"] = len(branch)
            event["_commits"] = branch[-settings.file["ingest"]["maxMrCommits"]:]
            on_mr.update(c["_id"] for c, _ in branch)
        if event["_squash"]:
            on_mr.add(event["_squash"])

    main_rows = [row for row in commit_rows if row[0]["_id"] not in on_mr]
    shown = sample_evenly(main_rows, settings.max_commits)
    # Special moments (finish / goodbye) are the plot — never sampled away.
    shown_ids = {row[0]["_id"] for row in shown}
    shown += [row for row in main_rows if row[0].get("special") and row[0]["_id"] not in shown_ids]
    draft.events += shown
    draft.events += shown_mrs
    if not draft.events:
        return None
    draft.events.sort(key=lambda row: (row[0]["date"], EVENT_ORDER[row[0]["type"]]))
    return draft


def mr_commits(api: GitLabApi, pid: int, iid: int | None, by_sha: dict) -> list[tuple[dict, Who]]:
    """The MR's own commits, oldest first. Stats come from the main-branch list
    when the commit landed there (merge); squashed ones have no stats."""
    if iid is None:
        return []
    try:
        raw = api.get_all(f"/projects/{pid}/merge_requests/{iid}/commits", {}, max_pages=3)
    except GitLabError as e:
        warn(f"mr !{iid} commits: {e}")
        return []
    out = []
    for c in reversed(raw):  # API returns newest first
        if is_merge_commit(c):
            continue
        known = by_sha.get(c.get("id") or "") or by_sha.get(c.get("short_id") or "")
        if known:
            out.append(({**known[0]}, known[1]))
            continue
        out.append((
            {
                "type": "commit",
                "date": day(c.get("committed_date") or c.get("created_at")),
                "sha": c.get("short_id") or (c.get("id") or "")[:8],
                "message": (c.get("title") or c.get("message") or "").split("\n")[0][:120],
                "additions": None,
                "deletions": None,
                "_id": c.get("id") or "",
            },
            Who(c.get("author_name"), c.get("author_email")),
        ))
    return out


def count_diff_lines(diffs: list[dict]) -> dict:
    add = dele = 0
    for d in diffs:
        for line in (d.get("diff") or "").splitlines():
            if line.startswith("+") and not line.startswith("+++"):
                add += 1
            elif line.startswith("-") and not line.startswith("---"):
                dele += 1
    return {"additions": add, "deletions": dele, "files": len(diffs)}


def mr_diff_stats(api: GitLabApi, pid: int, iid: int | None) -> dict:
    """+/- lines and files of one MR. Display only: those lines are already
    counted through the commits that the MR brought into main."""
    if iid is None:
        return {}
    try:
        return count_diff_lines(api.get_all(f"/projects/{pid}/merge_requests/{iid}/diffs", {"per_page": 50}, max_pages=10))
    except GitLabError as e:
        if e.status != 404:
            warn(f"mr !{iid} diffs: {e}")
            return {}
    try:  # GitLab < 15.7 has no /diffs
        data = api.get(f"/projects/{pid}/merge_requests/{iid}/changes") or {}
        return count_diff_lines(data.get("changes") or [])
    except GitLabError as e:
        warn(f"mr !{iid} changes: {e}")
        return {}


def observe_all(book: AuthorBook, drafts: list[Draft]) -> None:
    for d in drafts:
        book.observe(**d.meta["_owner"].ident)
        for _, who in d.all_commits:
            book.observe(**who.ident)
        for who in d.all_mrs:
            book.observe(**who.ident)
        for event, _ in d.events:
            for _, who in event.get("_commits", []):
                book.observe(**who.ident)


def finalize(draft: Draft, book: AuthorBook) -> dict:
    """Resolve authors and attach full totals (the event list itself may be sampled)."""
    resolve = lambda who: book.resolve(**who.ident)  # noqa: E731
    meta = dict(draft.meta)
    owner = meta.pop("_owner")
    def public(event: dict, who) -> dict:
        out = {k: v for k, v in event.items() if not k.startswith("_")}
        out["author"] = resolve(who)
        if event.get("_commits"):
            out["commits"] = [public(c, w) for c, w in event["_commits"]]
        return out

    events = [public(event, who) for event, who in draft.events]

    per_author: dict[str, dict[str, int]] = defaultdict(lambda: {"commits": 0, "mrs": 0, "additions": 0, "deletions": 0})
    for event, who in draft.all_commits:
        row = per_author[resolve(who)]
        row["commits"] += 1
        row["additions"] += event["additions"]
        row["deletions"] += event["deletions"]
    for who in draft.all_mrs:
        per_author[resolve(who)]["mrs"] += 1

    return {
        **meta,
        "author": resolve(owner),
        "createdAt": meta["createdAt"] or events[0]["date"],
        "totals": {
            "commits": len(draft.all_commits),
            "mrs": len(draft.all_mrs),
            "additions": sum(e["additions"] for e, _ in draft.all_commits),
            "deletions": sum(e["deletions"] for e, _ in draft.all_commits),
            "authors": dict(sorted(per_author.items())),
        },
        "events": events,
    }


def is_candidate(project: dict, period: Period) -> bool:
    """Born before the period ends and active after it starts."""
    created = (project.get("created_at") or "")[:4]
    active = (project.get("last_activity_at") or "")[:4]
    return bool(created) and created <= str(period.last_year) and (active or created) >= str(period.first_year)
