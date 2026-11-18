"""Settings for the GitLab ingest: `.env` file → process env → defaults."""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

from .special import FINISH_RE, GOODBYE_RE

# Source checkout: the repo root. Standalone binary: the folder next to the executable
# (that's where people put repos/, photos/ and .env, and where web/ is unpacked).
FROZEN = bool(getattr(sys, "frozen", False))
REPO_ROOT = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent.parent

# `.env` at the repo root is the canonical place; `prototype/.env` is still
# honoured so an existing local setup keeps working after the refactor.
ENV_CANDIDATES = (REPO_ROOT / ".env", REPO_ROOT / "prototype" / ".env")

DEFAULT_URL = "https://gitlab.example.com"
DEFAULT_PERIOD = "2026"
DEFAULT_BRANCH = "main"


@dataclass(frozen=True)
class Period:
    first_year: int
    last_year: int

    @property
    def since(self) -> str:
        return f"{self.first_year}-01-01T00:00:00Z"

    @property
    def until(self) -> str:
        return f"{self.last_year}-12-31T23:59:59Z"

    def contains(self, day: str | None) -> bool:
        return bool(day) and str(self.first_year) <= day[:4] <= str(self.last_year)

    def __str__(self) -> str:
        if self.first_year == self.last_year:
            return str(self.first_year)
        return f"{self.first_year}-{self.last_year}"


def parse_period(value: str) -> Period:
    """`2026` or `2025-2026` (also `2025..2026`)."""
    text = value.strip().replace("..", "-")
    parts = [p for p in text.split("-") if p]
    try:
        years = [int(p) for p in parts]
    except ValueError as e:
        raise ValueError(f"Bad GITLAB_PERIOD {value!r}: expected 2026 or 2025-2026") from e
    if len(years) == 1:
        return Period(years[0], years[0])
    if len(years) == 2 and years[0] <= years[1]:
        return Period(years[0], years[1])
    raise ValueError(f"Bad GITLAB_PERIOD {value!r}: expected 2026 or 2025-2026")


@dataclass(frozen=True)
class Settings:
    url: str
    token: str
    period: Period
    default_branch: str
    max_commits: int
    max_mrs: int
    mr_stats: bool
    finish_re: str
    goodbye_re: str
    authors_file: Path
    out_dir: Path
    env_file: Path | None
    photos_dir: Path
    repos_dir: Path


def read_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def find_env_file() -> Path | None:
    return next((p for p in ENV_CANDIDATES if p.exists()), None)


def load_settings(overrides: dict[str, str | None] | None = None) -> Settings:
    env_file = find_env_file()
    file_env = read_env_file(env_file) if env_file else {}
    overrides = {k: v for k, v in (overrides or {}).items() if v not in (None, "")}

    def pick(key: str, default: str = "") -> str:
        return overrides.get(key) or file_env.get(key) or os.environ.get(key) or default

    return Settings(
        url=pick("GITLAB_URL", DEFAULT_URL).rstrip("/"),
        token=pick("GITLAB_TOKEN"),
        period=parse_period(pick("GITLAB_PERIOD", DEFAULT_PERIOD)),
        default_branch=pick("GITLAB_DEFAULT_BRANCH", DEFAULT_BRANCH),
        max_commits=int(pick("LIFEWAY_MAX_COMMITS", "80")),
        max_mrs=int(pick("LIFEWAY_MAX_MRS", "40")),
        mr_stats=pick("LIFEWAY_MR_STATS", "1").lower() not in ("0", "false", "no", "off"),
        finish_re=pick("LIFEWAY_FINISH_RE", FINISH_RE),
        goodbye_re=pick("LIFEWAY_GOODBYE_RE", GOODBYE_RE),
        authors_file=Path(pick("LIFEWAY_AUTHORS", str(REPO_ROOT / "web" / "data" / "authors.json"))),
        out_dir=Path(pick("LIFEWAY_OUT", str(REPO_ROOT / "web" / "data"))),
        env_file=env_file,
        photos_dir=Path(pick("LIFEWAY_PHOTOS", str(REPO_ROOT / "photos"))),
        repos_dir=Path(pick("LIFEWAY_REPOS", str(REPO_ROOT / "repos"))),
    )
