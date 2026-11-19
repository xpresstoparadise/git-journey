"""Local-clones ingest against real git repos built on the fly — run: python -m unittest discover tests"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingest.authors import AuthorBook  # noqa: E402
from ingest.collect import finalize, observe_all  # noqa: E402
from ingest.config import parse_period  # noqa: E402
from ingest.local import collect_all, web_url  # noqa: E402
from ingest.photos import collect_photos  # noqa: E402
from ingest.special import SpecialMarks  # noqa: E402

HAS_GIT = shutil.which("git") is not None


def sh(cwd: Path, *args: str, date: str | None = None, who: tuple[str, str] = ("Anna Lee", "anna@team.dev")) -> None:
    env = {**os.environ}
    if date:
        env.update(GIT_AUTHOR_DATE=f"{date}T10:00:00", GIT_COMMITTER_DATE=f"{date}T10:00:00")
    subprocess.run(["git", "-c", f"user.name={who[0]}", "-c", f"user.email={who[1]}", *args],
                   cwd=cwd, env=env, check=True, capture_output=True)


def commit(repo: Path, date: str, msg: str, who=("Anna Lee", "anna@team.dev"), file: str = "a.txt") -> None:
    with open(repo / file, "a", encoding="utf-8") as fh:
        fh.write(f"{msg}\n")
    sh(repo, "add", "-A")
    sh(repo, "commit", "-q", "-m", msg, date=date, who=who)


@unittest.skipUnless(HAS_GIT, "git not installed")
class LocalIngestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repos = self.tmp / "repos"
        alpha = self.repos / "alpha"
        alpha.mkdir(parents=True)
        sh(alpha, "init", "-q", "-b", "main")
        commit(alpha, "2026-01-10", "init")
        sh(alpha, "checkout", "-q", "-b", "feature/search")
        commit(alpha, "2026-01-20", "search: index", who=("Bob Ray", "bob@team.dev"), file="s.txt")
        commit(alpha, "2026-01-22", "search: ranking", who=("Bob Ray", "bob@team.dev"), file="s.txt")
        sh(alpha, "checkout", "-q", "main")
        sh(alpha, "merge", "-q", "--no-ff", "feature/search", "-m", "Merge branch 'feature/search' into 'main'",
           "-m", "Full-text search", "-m", "See merge request team/alpha!7", date="2026-01-28")
        commit(alpha, "2026-03-02", "handover\n\nJourney: goodbye спасибо!", who=("bob", "bob@team.dev"))
        sh(alpha, "remote", "add", "origin", "git@gitlab.example.com:team/alpha.git")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_commits_mrs_marks_and_links(self):
        drafts = collect_all(self.repos, parse_period("2026"), "main", SpecialMarks())
        self.assertEqual(len(drafts), 1)
        book = AuthorBook()
        observe_all(book, drafts)
        p = finalize(drafts[0], book)
        types = [e["type"] for e in p["events"]]
        self.assertEqual(types, ["created", "commit", "mr", "commit"])
        mr = next(e for e in p["events"] if e["type"] == "mr")
        self.assertEqual((mr["iid"], mr["title"], mr["author"]), (7, "Full-text search", "Bob Ray"))
        self.assertEqual((mr["branch"], mr["target"]), ("feature/search", "main"))
        self.assertEqual([c["message"] for c in mr["commits"]], ["search: index", "search: ranking"])
        bye = p["events"][-1]
        self.assertEqual((bye["special"], bye["note"], bye["author"]), ("goodbye", "спасибо!", "Bob Ray"))
        self.assertEqual(p["totals"]["commits"], 4)
        self.assertEqual(p["webUrl"], "https://gitlab.example.com/team/alpha")
        self.assertEqual(web_url(self.repos / "alpha"), "https://gitlab.example.com/team/alpha")

    def test_photos_by_name_email_and_login(self):
        drafts = collect_all(self.repos, parse_period("2026"), "main", SpecialMarks())
        book = AuthorBook()
        observe_all(book, drafts)
        photos = self.tmp / "photos"
        photos.mkdir()
        (photos / "Anna Lee.png").write_bytes(b"png")
        (photos / "bob@team.dev.jpg").write_bytes(b"jpg")
        (photos / "nobody.png").write_bytes(b"png")
        out = collect_photos(photos, book, {"Anna Lee", "Bob Ray"}, self.tmp / "data")
        self.assertEqual(set(out), {"Anna Lee", "Bob Ray"})
        for rel in out.values():
            self.assertTrue((self.tmp / "data" / rel).exists())


if __name__ == "__main__":
    unittest.main()


class MergedBranchTest(unittest.TestCase):
    def test_branch_from_merge_messages(self):
        from ingest.local import merged_branch
        self.assertEqual(merged_branch("Merge branch 'feature/search' into 'main'\n\nSee merge request team/a!7"), "feature/search")
        self.assertEqual(merged_branch("Merge remote-tracking branch 'origin/fix/login'"), "fix/login")
        self.assertEqual(merged_branch("Merge pull request #12 from ada/feature-x\n\nFeature X"), "feature-x")
        self.assertEqual(merged_branch("Fix typo"), "")
