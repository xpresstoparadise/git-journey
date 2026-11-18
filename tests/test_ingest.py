"""Ingest tests against a fake GitLab — run: python -m unittest discover tests"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingest.authors import AuthorBook, name_key  # noqa: E402
from ingest.collect import collect_project, finalize, is_candidate, observe_all, sample_evenly  # noqa: E402
from ingest.config import Settings, parse_period  # noqa: E402
from ingest.export import write_dataset  # noqa: E402
from ingest.gitlab import GitLabError  # noqa: E402
from ingest.special import FINISH_RE, GOODBYE_RE, SpecialMarks  # noqa: E402
from ingest.settings_file import load_file  # noqa: E402


def commit(sha, day, title, name, email, add=10, dele=2, parents=1):
    return {
        "id": sha * 5, "short_id": sha, "title": title, "committed_date": f"{day}T10:00:00Z",
        "author_name": name, "author_email": email, "stats": {"additions": add, "deletions": dele},
        "parent_ids": [f"p{i}" for i in range(parents)],
    }


class FakeGitLab:
    def __init__(self, commits=None, mrs=None, fail_branch=None):
        self.commits = commits or []
        self.mrs = mrs or []
        self.fail_branch = fail_branch
        self.mr_commit_list = []
        self.calls = []

    def get(self, path, params=None):
        if path == "/avatar":
            return {"avatar_url": f"http://gitlab/uploads/{params['email']}.png"}
        return {"version": "16.0"}

    def download(self, url, max_bytes=2_000_000):
        self.calls.append(("download", {"url": url}))
        if "missing" in url:
            raise GitLabError(404, url, "")
        return b"\x89PNG fake", "image/png"

    def get_all(self, path, params=None, max_pages=20):
        self.calls.append((path, dict(params or {})))
        if path.endswith("/repository/commits"):
            if params.get("ref_name") == self.fail_branch:
                raise GitLabError(404, path, "branch not found")
            return self.commits
        if path.endswith("/merge_requests"):
            return self.mrs
        if "/merge_requests/" in path and path.endswith("/commits"):
            return list(reversed(self.mr_commit_list))  # API: newest first
        if path.endswith("/diffs"):
            return [{"diff": "@@ -1 +1,2 @@\n-old\n+new\n+more\n"}, {"diff": "+++ b/x\n+one\n"}]
        return []


def settings(**kw):
    base = dict(
        url="http://gitlab", token="t", period=parse_period("2026"), default_branch="main",
        max_commits=80, max_mrs=40, mr_stats=False, finish_re=FINISH_RE, goodbye_re=GOODBYE_RE, authors_file=Path("/nonexistent"), out_dir=Path("."), env_file=None, photos_dir=Path("/nonexistent"), repos_dir=Path("/nonexistent"), file=load_file(Path("/nonexistent")),
    )
    return Settings(**{**base, **kw})


PROJECT = {
    "id": 7, "path": "tool", "path_with_namespace": "team/tool", "created_at": "2026-02-01T09:00:00Z",
    "default_branch": "main", "web_url": "http://gitlab/team/tool", "description": "",
    "namespace": {"kind": "user", "name": "Lena Frost", "path": "lena_frost"},
}


class PeriodTest(unittest.TestCase):
    def test_single_and_range(self):
        self.assertEqual(str(parse_period("2026")), "2026")
        p = parse_period("2025..2026")
        self.assertEqual((p.first_year, p.last_year), (2025, 2026))
        self.assertTrue(p.contains("2025-06-01") and not p.contains("2024-12-31"))
        with self.assertRaises(ValueError):
            parse_period("next year")


class AuthorBookTest(unittest.TestCase):
    def test_spellings_collapse_and_full_name_wins(self):
        book = AuthorBook()
        book.observe("Lena_Frost", "lf@corp")
        book.observe("Lena_Frost", "lf@corp")
        book.observe("Lena Frost")
        self.assertEqual(book.resolve("lena_frost", "lf@corp"), "Lena Frost")
        self.assertEqual(name_key("Frost Lena"), name_key("lena.frost"))

    def test_shared_email_and_alias_file(self):
        book = AuthorBook({"Пётр Соколов": ["psokolov"]})
        book.observe("Petr Sokolov", "v@corp")
        book.observe("psokolov.dev", "v@corp")
        book.observe("Psokolov", None, "psokolov")
        self.assertEqual(book.resolve("psokolov.dev", "v@corp"), "Petr Sokolov")
        self.assertEqual(book.resolve("Psokolov", None, "psokolov"), "Пётр Соколов")


class CollectTest(unittest.TestCase):
    def test_project_events_totals_and_merge_commits(self):
        api = FakeGitLab(
            commits=[
                commit("aaa", "2026-02-02", "init", "Lena_Frost", "lf@corp", 100, 0),
                commit("bbb", "2026-03-01", "Merge branch 'x' into 'main'", "Lena Frost", "lf@corp", 999, 999, parents=2),
                commit("ccc", "2026-03-05", "feature", "Elena", "dn@corp", 20, 5),
                commit("old", "2025-12-30", "last year", "Elena", "dn@corp"),
            ],
            mrs=[
                {"iid": 3, "title": "Feature X", "merged_at": "2026-03-01T12:00:00Z", "author": {"name": "Елена Морозова", "username": "dn"}},
                {"iid": 1, "title": "old", "merged_at": "2025-11-01T12:00:00Z", "author": {"name": "Elena", "username": "dn"}},
            ],
        )
        draft = collect_project(api, PROJECT, settings())
        book = AuthorBook({"Елена Морозова": ["Elena"]})
        observe_all(book, [draft])
        p = finalize(draft, book)

        types = [e["type"] for e in p["events"]]
        self.assertEqual(types, ["created", "commit", "mr", "commit"])
        self.assertNotIn("bbb", [e.get("sha") for e in p["events"]], "merge commit must be dropped")
        self.assertEqual(p["totals"]["commits"], 2)
        self.assertEqual(p["totals"]["additions"], 120)
        self.assertEqual(p["totals"]["mrs"], 1)
        self.assertEqual(p["author"], "Lena Frost")
        self.assertEqual(set(p["totals"]["authors"]), {"Lena Frost", "Елена Морозова"})
        self.assertEqual(p["totals"]["authors"]["Елена Морозова"], {"commits": 1, "mrs": 1, "additions": 20, "deletions": 5})
        commit_call = next(params for path, params in api.calls if path.endswith("/repository/commits"))
        self.assertEqual(commit_call["ref_name"], "main")

    def test_falls_back_to_default_branch(self):
        api = FakeGitLab(commits=[commit("aaa", "2026-04-01", "x", "A", "a@x")], fail_branch="develop")
        draft = collect_project(api, {**PROJECT, "default_branch": "develop"}, settings())
        self.assertEqual(draft.meta["defaultBranch"], "main")
        self.assertEqual(len(draft.all_commits), 1)

    def test_sampling_keeps_ends_and_totals_stay_full(self):
        commits = [commit(f"c{i:03d}", f"2026-05-{1 + i % 28:02d}", f"c{i}", "A", "a@x", 1, 0) for i in range(200)]
        draft = collect_project(FakeGitLab(commits=commits), PROJECT, settings(max_commits=10))
        p = finalize(draft, AuthorBook())
        self.assertEqual(sum(e["type"] == "commit" for e in p["events"]), 10)
        self.assertEqual(p["totals"]["commits"], 200)
        s = sample_evenly(list(range(100)), 5)
        self.assertEqual((s[0], s[-1], len(s)), (0, 99, 5))

    def test_inactive_project_is_skipped(self):
        draft = collect_project(FakeGitLab(), {**PROJECT, "created_at": "2024-01-01T00:00:00Z"}, settings())
        self.assertIsNone(draft)

    def test_candidates(self):
        period = parse_period("2026")
        self.assertTrue(is_candidate({"created_at": "2024-01-01", "last_activity_at": "2026-03-01"}, period))
        self.assertFalse(is_candidate({"created_at": "2024-01-01", "last_activity_at": "2025-03-01"}, period))
        self.assertFalse(is_candidate({"created_at": "2027-01-01", "last_activity_at": "2027-03-01"}, period))


class NewFeaturesTest(unittest.TestCase):
    MR = {"iid": 3, "title": "X", "merged_at": "2026-03-01T12:00:00Z", "author": {"name": "Ann Lee", "username": "ann", "avatar_url": "http://gitlab/u/ann.png"}}

    def test_mr_diff_stats(self):
        draft = collect_project(FakeGitLab(mrs=[self.MR]), PROJECT, settings(mr_stats=True))
        mr = next(e for e, _ in draft.events if e["type"] == "mr")
        self.assertEqual((mr["additions"], mr["deletions"], mr["files"]), (3, 1, 2))

    def test_cache_reuse_and_reresolve(self):
        from ingest.cache import load_previous, reresolve, reusable
        with tempfile.TemporaryDirectory() as tmp:
            prev = {"id": "7", "lastActivityAt": "2026-05-01T00:00:00Z", "defaultBranch": "main", "author": "Elena Morozova",
                    "events": [{"type": "commit", "author": "Elena Morozova"}],
                    "totals": {"authors": {"Elena Morozova": {"commits": 2, "mrs": 0, "additions": 5, "deletions": 1}}}}
            write_dataset(Path(tmp), {"period": "2026", "source": "http://gitlab"}, [prev])
            cache = load_previous(Path(tmp), "2026", "http://gitlab")
            self.assertTrue(reusable(cache, {"id": 7, "last_activity_at": "2026-05-01T00:00:00Z", "default_branch": "main"}, "main"))
            self.assertIsNone(reusable(cache, {"id": 7, "last_activity_at": "2026-06-01T00:00:00Z", "default_branch": "main"}, "main"))
            self.assertEqual(load_previous(Path(tmp), "2025", "http://gitlab"), {})
            book = AuthorBook({"Елена Морозова": ["Elena Morozova"]})
            again = reresolve(prev, book)
            self.assertEqual(again["events"][0]["author"], "Елена Морозова")
            self.assertEqual(again["totals"]["authors"]["Елена Морозова"]["commits"], 2)

    def test_suggest_by_transliteration(self):
        from collections import Counter
        from ingest.suggest import suggest
        aliases, loners = suggest(Counter({"Елена Морозова": 5, "Elena Morozova": 1, "Пётр Соколов": 3, "Petr Sokolov": 9, "psokolov": 2}))
        self.assertEqual(aliases["Елена Морозова"], ["Elena Morozova"])
        self.assertEqual(aliases["Пётр Соколов"], ["Petr Sokolov"])
        self.assertEqual(loners, ["psokolov"])

    def test_avatars(self):
        from ingest.avatars import fetch_avatars, no_default_gravatar
        api = FakeGitLab(commits=[commit("aaa", "2026-04-01", "x", "Bob Ray", "bob@corp"),
                                  commit("bbb", "2026-04-02", "y", "Ghost", "missing@corp")], mrs=[self.MR])
        draft = collect_project(api, PROJECT, settings())
        book = AuthorBook()
        observe_all(book, [draft])
        with tempfile.TemporaryDirectory() as tmp:
            got = fetch_avatars(api, [draft], book, Path(tmp))
            self.assertIn("Ann Lee", got)
            self.assertIn("Bob Ray", got)
            self.assertNotIn("Ghost", got)
            self.assertTrue((Path(tmp) / got["Ann Lee"]).read_bytes().startswith(b"\x89PNG"))
        self.assertIn("d=404", no_default_gravatar("https://www.gravatar.com/avatar/abc?s=80&d=identicon"))


class MrCommitsTest(unittest.TestCase):
    def test_mr_commits_move_to_branch(self):
        main = [
            commit("aaa", "2026-03-01", "on main", "A", "a@x", 5, 1),
            commit("bbb", "2026-03-02", "mr work 1", "B", "b@x", 7, 0),
            commit("ccc", "2026-03-03", "mr work 2", "B", "b@x", 3, 2),
        ]
        api = FakeGitLab(commits=main, mrs=[{"iid": 9, "title": "Feature", "merged_at": "2026-03-04T10:00:00Z", "author": {"name": "B", "username": "b"}}])
        api.mr_commit_list = [main[1], main[2], {"id": "zzzzzzzzzz", "short_id": "zzz", "title": "squashed away", "committed_date": "2026-03-02T00:00:00Z", "author_name": "C", "author_email": "c@x", "parent_ids": ["p"]}]
        draft = collect_project(api, PROJECT, settings())
        book = AuthorBook()
        observe_all(book, [draft])
        p = finalize(draft, book)
        main_shas = [e["sha"] for e in p["events"] if e["type"] == "commit"]
        self.assertEqual(main_shas, ["aaa"], "MR commits leave the main line")
        mr = next(e for e in p["events"] if e["type"] == "mr")
        self.assertEqual([c["sha"] for c in mr["commits"]], ["bbb", "ccc", "zzz"])
        self.assertEqual(mr["commits"][0]["additions"], 7)
        self.assertIsNone(mr["commits"][2]["additions"])
        self.assertEqual(mr["commitCount"], 3)
        self.assertEqual(p["totals"]["commits"], 3, "totals still count every main commit")
        self.assertFalse(any(k.startswith("_") for e in p["events"] for k in e))


class SpecialTest(unittest.TestCase):
    def test_marks(self):
        m = SpecialMarks()
        self.assertEqual(m.detect("release 2.0\n\nJourney: finish Передали в эксплуатацию"), {"special": "finish", "note": "Передали в эксплуатацию"})
        self.assertEqual(m.detect("docs #journey-goodbye"), {"special": "goodbye"})
        self.assertEqual(m.detect("lifeway: farewell — спасибо!"), {"special": "goodbye", "note": "спасибо!"})
        self.assertEqual(m.detect("fix lifeway parser"), {})
        self.assertEqual(m.detect("ship it\n\nJourney: finish v2"), {"special": "finish", "note": "v2"})
        self.assertEqual(m.detect("bye #journey-goodbye"), {"special": "goodbye"})
        self.assertEqual(SpecialMarks(r"(?i)\[done\]", r"(?i)\[bye\]").detect("x [bye] пока"), {"special": "goodbye", "note": "пока"})

    def test_special_survives_sampling(self):
        commits = [commit(f"c{i:03d}", f"2026-05-{1 + i % 28:02d}", f"c{i}", "A", "a@x") for i in range(100)]
        commits[57]["message"] = "last one\n\nJourney: goodbye всем спасибо"
        draft = collect_project(FakeGitLab(commits=commits), PROJECT, settings(max_commits=5))
        p = finalize(draft, AuthorBook())
        bye = [e for e in p["events"] if e.get("special") == "goodbye"]
        self.assertEqual(len(bye), 1)
        self.assertEqual(bye[0]["note"], "всем спасибо")


class ExportTest(unittest.TestCase):
    def test_js_and_json_agree(self):
        with tempfile.TemporaryDirectory() as tmp:
            json_path, js_path = write_dataset(Path(tmp), {"period": "2026"}, [{"id": "1", "name": "x"}])
            data = json.loads(json_path.read_text(encoding="utf-8"))
            js = js_path.read_text(encoding="utf-8")
            self.assertEqual(data["count"], 1)
            self.assertIn("window.GITLAB_META = ", js)
            self.assertIn('window.GITLAB_RAW = [{"id": "1", "name": "x"}];', js)


if __name__ == "__main__":
    unittest.main()
