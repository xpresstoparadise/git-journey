"""Generate a big fictional team to test the film under load (many repos, wide world).

    python tools/make_stress_data.py OUT_DIR [--repos 40] [--people 25] [--seed 7]

Writes OUT_DIR/gitlab_raw.js in the same shape as fetch_gitlab.py. Everyone and
everything in it is made up.
"""
from __future__ import annotations

import argparse
import json
import random
from datetime import date, timedelta
from pathlib import Path

FIRST = ["Anna", "Boris", "Clara", "Denis", "Eva", "Fedor", "Gleb", "Hanna", "Igor", "Julia", "Kirill",
         "Lena", "Max", "Nina", "Oleg", "Polina", "Roman", "Sofia", "Timur", "Ulyana", "Vlad", "Yana", "Zahar"]
LAST = ["Ivanova", "Petrov", "Sokolova", "Kuznetsov", "Popova", "Lebedev", "Kozlova", "Novikov", "Morozova",
        "Volkov", "Alekseeva", "Pavlov", "Semenova", "Golubev", "Vinogradova", "Bogdanov", "Vorobieva"]
WORDS = ["api", "core", "portal", "billing", "search", "auth", "reports", "gateway", "sync", "docs", "ml",
         "infra", "mobile", "admin", "notify", "export", "import", "audit", "cache", "pipeline"]
VERBS = ["add", "fix", "refactor", "tune", "cover", "split", "drop", "document", "harden", "speed up"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out")
    ap.add_argument("--repos", type=int, default=40)
    ap.add_argument("--people", type=int, default=25)
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    r = random.Random(a.seed)
    people = [f"{r.choice(FIRST)} {r.choice(LAST)}" for _ in range(a.people)]
    start, end = date(a.year, 1, 1), date(a.year, 11, 18)
    span = (end - start).days

    def day(d: date) -> str:
        return d.isoformat()

    def sha() -> str:
        return f"{r.getrandbits(32):08x}"

    projects = []
    for i in range(a.repos):
        name = f"{r.choice(WORDS)}-{r.choice(WORDS)}-{i}"
        team = r.sample(people, k=r.randint(1, 5))
        born = start + timedelta(days=r.randint(0, span - 20))
        stop = min(end, born + timedelta(days=r.randint(20, span)))
        events = [{"type": "created", "date": day(born), "author": team[0]}] if r.random() < 0.6 else []
        d = born
        iid = 0
        while d <= stop:
            if r.random() < 0.12:  # an MR with its own commits
                iid += 1
                merge = min(stop, d + timedelta(days=r.randint(2, 20)))
                k = r.randint(1, 8)
                author = r.choice(team)
                commits = [{"type": "commit", "date": day(d + timedelta(days=(merge - d).days * j // k)), "sha": sha(),
                            "message": f"{r.choice(VERBS)} {r.choice(WORDS)}", "author": author,
                            "additions": r.randint(1, 600), "deletions": r.randint(0, 200)} for j in range(k)]
                events.append({"type": "mr", "date": day(merge), "iid": iid, "title": f"{r.choice(VERBS).title()} {r.choice(WORDS)}",
                               "author": author, "merged": True, "commitCount": k, "commits": commits})
            else:
                events.append({"type": "commit", "date": day(d), "sha": sha(), "message": f"{r.choice(VERBS)} {r.choice(WORDS)}",
                               "author": r.choice(team), "additions": r.randint(1, 400), "deletions": r.randint(0, 150)})
            d += timedelta(days=r.randint(1, 9))
        projects.append({"id": f"stress-{i}", "name": name, "path": f"team/{name}", "author": team[0],
                         "createdAt": day(born), "description": f"Fictional repo #{i}", "defaultBranch": "main",
                         "webUrl": "", "events": events})
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    meta = {"fetchedAt": f"{end.isoformat()}T09:00:00Z", "source": "stress-test", "period": str(a.year), "defaultBranch": "main"}
    (out / "gitlab_raw.js").write_text(
        f"window.GITLAB_META = {json.dumps(meta)};\nwindow.GITLAB_RAW = {json.dumps(projects, ensure_ascii=False)};\n", encoding="utf-8")
    n = sum(len(p["events"]) + sum(len(e.get("commits", [])) for e in p["events"]) for p in projects)
    print(f"{len(projects)} repos, {n} events → {out / 'gitlab_raw.js'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
