"""Life Way from local clones — no GitLab needed, just `git`.

Every git repository directly inside the folder (or the folder itself) becomes a
project. What plain git history gives:

* commits with author, e-mail, date and lines (`git log --numstat`);
* merge requests from merge commits on the main line: GitLab writes
  «See merge request group/proj!12» into them (GitHub: «Merge pull request #12»),
  the MR's own commits are everything between the merge's two parents.
  Squash merges look like ordinary commits;
* repo birth from the root commit; Life-Way marks from full commit messages;
* links back to GitLab when `origin` points at it.

The result has the same shape as the GitLab ingest (Draft → finalize).
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from .collect import EVENT_ORDER, MAX_MR_COMMITS, Draft, Who, sample_evenly
from .config import Period
from .special import SpecialMarks

RS, FS = "\x1e", "\x1f"
LOG_FORMAT = f"{RS}%H{FS}%h{FS}%P{FS}%an{FS}%ae{FS}%cI{FS}%B"


class GitError(RuntimeError):
    pass


def git(repo: Path, *args: str) -> str:
    try:
        res = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace", check=False,
        )
    except FileNotFoundError as e:
        raise GitError("git is not installed or not in PATH") from e
    if res.returncode != 0:
        raise GitError(f"git {' '.join(args[:3])}… in {repo.name}: {res.stderr.strip()[:200]}")
    return res.stdout


def is_repo(path: Path) -> bool:
    return (path / ".git").exists() or ((path / "HEAD").is_file() and (path / "objects").is_dir())


def find_repos(root: Path) -> list[Path]:
    if is_repo(root):
        return [root]
    return sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".") and is_repo(p))


def resolve_branch(repo: Path, wanted: str) -> str:
    """The branch to read: wanted (local or origin/), else origin's HEAD, else HEAD."""
    for ref in (wanted, f"origin/{wanted}"):
        try:
            git(repo, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}")
            return ref
        except GitError:
            pass
    try:
        return git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").strip()
    except GitError:
        return "HEAD"


def web_url(repo: Path) -> str:
    """origin → https URL (git@host:group/p.git and http(s)://host/group/p.git both work)."""
    try:
        url = git(repo, "remote", "get-url", "origin").strip()
    except GitError:
        return ""
    m = re.match(r"^(?:ssh://)?git@([^:/]+)[:/](.+?)(?:\.git)?/?$", url)
    if m:
        return f"https://{m.group(1)}/{m.group(2)}"
    m = re.match(r"^(https?://)(?:[^@/]+@)?(.+?)(?:\.git)?/?$", url)
    return f"{m.group(1)}{m.group(2)}" if m else ""


def read_log(repo: Path, *rev: str, period: Period | None = None, extra: tuple[str, ...] = ()) -> list[dict]:
    """Commits with numstat lines, newest first."""
    args = ["log", f"--format={LOG_FORMAT}", "--numstat", "--no-color", *extra]
    if period:
        args += [f"--since={period.since}", f"--until={period.until}"]
    out = git(repo, *args, *rev, "--")
    commits = []
    for chunk in out.split(RS)[1:]:
        head, _, rest = chunk.partition(FS)
        parts = [head, *rest.split(FS)]
        if len(parts) < 7:
            continue
        full, short, parents, name, email, date, body_and_stats = parts[:7]
        # numstat lines follow the message body after a blank line
        lines = body_and_stats.rstrip("\n").split("\n")
        add = dele = 0
        msg_lines = []
        for ln in lines:
            m = re.match(r"^(\d+|-)\t(\d+|-)\t", ln)
            if m:
                add += int(m.group(1)) if m.group(1) != "-" else 0
                dele += int(m.group(2)) if m.group(2) != "-" else 0
            else:
                msg_lines.append(ln)
        message = "\n".join(msg_lines).strip()
        commits.append({
            "id": full, "short": short, "parents": parents.split(), "name": name, "email": email,
            "date": date[:10], "message": message, "additions": add, "deletions": dele,
        })
    return commits


MR_IID = [
    re.compile(r"See merge request \S*!(\d+)"),
    re.compile(r"Merge pull request #(\d+)"),
    re.compile(r"\(#(\d+)\)\s*$", re.M),
]
MR_BRANCH = re.compile(r"^Merge (?:branch|remote-tracking branch) '([^']+)'")


def mr_from_merge(c: dict, seq: int) -> tuple[int, str]:
    """(iid, title) from a merge commit message."""
    iid = next((int(m.group(1)) for rx in MR_IID if (m := rx.search(c["message"]))), seq)
    lines = [ln.strip() for ln in c["message"].split("\n")]
    body = [ln for ln in lines[1:] if ln and not re.match(r"^(See merge request|Closes|Fixes|Resolves|Co-authored-by|Signed-off-by|Life-?Way\s*:)", ln, re.I)]
    if body:
        return iid, body[0][:140]
    m = MR_BRANCH.match(lines[0]) or re.search(r"from \S+/(\S+)", lines[0])
    return iid, (m.group(1) if m else lines[0])[:140]


def collect_local(repo: Path, period: Period, branch: str, marks: SpecialMarks, max_commits: int = 80) -> Draft | None:
    ref = resolve_branch(repo, branch)
    def commit_event(c: dict) -> dict:
        return {
            "type": "commit", "date": c["date"], "sha": c["short"],
            "message": c["message"].split("\n")[0][:120],
            "additions": c["additions"], "deletions": c["deletions"],
            "_id": c["id"], **marks.detect(c["message"]),
        }

    all_commits = [(commit_event(c), Who(c["name"], c["email"]))
                   for c in read_log(repo, ref, period=period, extra=("--no-merges",))]
    all_commits.sort(key=lambda row: row[0]["date"])

    merges = read_log(repo, ref, period=period, extra=("--first-parent", "--merges"))
    mr_rows, on_mr = [], set()
    for seq, m in enumerate(reversed(merges), 1):
        if len(m["parents"]) < 2:
            continue
        p1, p2 = m["parents"][:2]
        branch_commits = [(commit_event(c), Who(c["name"], c["email"]))
                          for c in reversed(read_log(repo, f"{p1}..{p2}", extra=("--no-merges",)))]
        iid, title = mr_from_merge(m, seq)
        # The MR's author is whoever wrote most of its commits (the merger may be someone else).
        counts: dict[tuple, int] = {}
        for _, w in branch_commits:
            counts[(w.name, w.email)] = counts.get((w.name, w.email), 0) + 1
        who = Who(*max(counts, key=counts.get)) if counts else Who(m["name"], m["email"])
        event = {
            "type": "mr", "date": m["date"], "iid": iid, "title": title, "merged": True,
            **({"additions": sum(c["additions"] for c, _ in branch_commits),
                "deletions": sum(c["deletions"] for c, _ in branch_commits)} if branch_commits else {}),
            **marks.detect(m["message"]),
        }
        if branch_commits:
            event["commitCount"] = len(branch_commits)
            event["_commits"] = branch_commits[-MAX_MR_COMMITS:]
            on_mr.update(c["_id"] for c, _ in branch_commits)
        mr_rows.append((event, who))

    try:
        roots = git(repo, "rev-list", "--max-parents=0", ref).split()
        root = read_log(repo, roots[-1], extra=("-1",))[0] if roots else None
    except GitError:
        root = None
    created = root["date"] if root else None

    draft = Draft(meta={
        "id": f"local:{repo.name}",
        "name": repo.name,
        "path": repo.name,
        "createdAt": created,
        "description": "",
        "defaultBranch": ref.removeprefix("origin/"),
        "webUrl": web_url(repo),
        "lastActivityAt": (all_commits[-1][0]["date"] if all_commits else created) or "",
        "_owner": Who(root["name"], root["email"]) if root else Who(repo.name),
    })
    if root and period.contains(created):
        draft.events.append(({"type": "created", "date": created}, draft.meta["_owner"]))
    draft.all_commits = all_commits
    draft.all_mrs = [who for _, who in mr_rows]

    main_rows = [row for row in all_commits if row[0]["_id"] not in on_mr]
    shown = sample_evenly(main_rows, max_commits)
    ids = {row[0]["_id"] for row in shown}
    shown += [row for row in main_rows if row[0].get("special") and row[0]["_id"] not in ids]
    draft.events += shown + mr_rows
    if not any(e["type"] != "created" for e, _ in draft.events):
        return None
    draft.events.sort(key=lambda row: (row[0]["date"], EVENT_ORDER[row[0]["type"]]))
    return draft


def collect_all(root: Path, period: Period, branch: str, marks: SpecialMarks, max_commits: int = 80) -> list[Draft]:
    drafts = []
    repos = find_repos(root)
    print(f"Репозиториев в {root}: {len(repos)}")
    for i, repo in enumerate(repos, 1):
        print(f"[{i}/{len(repos)}] {repo.name}", flush=True)
        try:
            d = collect_local(repo, period, branch, marks, max_commits)
        except GitError as e:
            print(f"  ! {e}", file=sys.stderr)
            continue
        if not d:
            print("    -> нет изменений в периоде")
            continue
        print(f"    -> {len(d.all_commits)} коммитов, {len(d.all_mrs)} MR @ {d.meta['defaultBranch']}")
        drafts.append(d)
    return drafts
