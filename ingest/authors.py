"""One person, many spellings: `Lena_Frost`, `Lena Frost`, a GitLab
username and a commit e-mail all collapse into a single author.

Identities are merged when they share an e-mail (commits), a username (MRs) or a
normalised name, plus anything listed in the optional `authors.json`:

    {"Пётр Соколов": ["Petr Sokolov", "psokolov", "p.sokolov@corp.example"]}
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

_SEPARATORS = re.compile(r"[\s._\-]+")


def name_key(name: str) -> str:
    """Case-, separator- and word-order-insensitive key: 'Frost_Lena' == 'lena frost'."""
    words = [w for w in _SEPARATORS.split(name.casefold()) if w]
    return " ".join(sorted(words))


def _keys(name: str | None, email: str | None, username: str | None) -> list[str]:
    keys = []
    if name and name_key(name):
        keys.append("n:" + name_key(name))
    if email:
        keys.append("e:" + email.strip().casefold())
    if username:
        keys.append("u:" + username.strip().casefold())
    return keys


class AuthorBook:
    def __init__(self, aliases: dict[str, list[str]] | None = None) -> None:
        self._parent: dict[str, str] = {}
        self._seen_names: dict[str, Counter] = defaultdict(Counter)
        self._canonical: dict[str, str] = {}
        for canonical, alias_list in (aliases or {}).items():
            group: list[str] = []
            for alias in [canonical, *alias_list]:
                if "@" in alias:
                    group += _keys(None, alias, None)
                else:
                    group += _keys(alias, None, alias)
            for key in group:
                self._canonical[key] = canonical
            self._union_all(group)

    @classmethod
    def from_file(cls, path: Path) -> "AuthorBook":
        if not path.exists():
            return cls()
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls({str(k): [str(a) for a in v] for k, v in data.items() if not str(k).startswith("_")})

    # --- union-find -------------------------------------------------------
    def _find(self, key: str) -> str:
        self._parent.setdefault(key, key)
        while self._parent[key] != key:
            self._parent[key] = self._parent[self._parent[key]]
            key = self._parent[key]
        return key

    def _union_all(self, keys: list[str]) -> None:
        roots = [self._find(k) for k in keys]
        for root in roots[1:]:
            self._parent[root] = roots[0]

    # --- public -----------------------------------------------------------
    def observe(self, name: str | None, email: str | None = None, username: str | None = None) -> None:
        keys = _keys(name, email, username)
        if not keys:
            return
        self._union_all(keys)
        if name and name.strip():
            self._seen_names[keys[0]][name.strip()] += 1

    def resolve(self, name: str | None, email: str | None = None, username: str | None = None) -> str:
        keys = _keys(name, email, username)
        if not keys:
            return "unknown"
        root = self._find(keys[0])
        members = [k for k in list(self._parent) if self._find(k) == root]
        for key in members:
            if key in self._canonical:
                return self._canonical[key]
        names: Counter = Counter()
        for key in members:
            names.update(self._seen_names.get(key, {}))
        if not names:
            return (name or username or email or "unknown").strip()
        # full names ("Имя Фамилия") beat logins ("lena_frost"), then the most used spelling
        return max(names.items(), key=lambda kv: (" " in kv[0].strip(), kv[1], len(kv[0])))[0]
