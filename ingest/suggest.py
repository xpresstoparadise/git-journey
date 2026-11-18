"""Suggest author aliases: spellings that become the same name after Russian→Latin
transliteration ('Елена Морозова' ~ 'Elena Morozova'). Prints, never writes:
the person decides who is who.

    python fetch_gitlab.py --suggest-authors
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from .authors import name_key

_RU = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def _fold(word: str) -> str:
    """Transliterate and squash spelling variants: iy/ij/y endings, kh/h, double letters."""
    w = "".join(_RU.get(ch, ch) for ch in word.casefold())
    w = re.sub(r"(iy|ij|yi|ii|y)$", "i", w)
    w = w.replace("kh", "h").replace("ks", "x").replace("yu", "u").replace("ya", "a")
    w = re.sub(r"(.)\1+", r"\1", w)
    return w


def fold_key(name: str) -> str:
    return " ".join(sorted(_fold(w) for w in name_key(name).split()))


def load_names(data_dir: Path) -> Counter:
    js = data_dir / "gitlab_raw.js"
    jf = data_dir / "gitlab_raw.json"
    if jf.exists():
        projects = json.loads(jf.read_text(encoding="utf-8")).get("projects", [])
    elif js.exists():
        m = re.search(r"window\.GITLAB_RAW = (.*);\s*$", js.read_text(encoding="utf-8"), re.S)
        projects = json.loads(m.group(1)) if m else []
    else:
        projects = []
    names: Counter = Counter()
    for p in projects:
        for e in p.get("events", []):
            if e.get("author"):
                names[e["author"]] += 1
    return names


def suggest(names: Counter) -> tuple[dict[str, list[str]], list[str]]:
    groups: dict[str, list[str]] = {}
    for name in names:
        groups.setdefault(fold_key(name), []).append(name)
    aliases = {}
    for spellings in groups.values():
        if len(spellings) < 2:
            continue
        # Canonical: Cyrillic full name if any, else the most used full name.
        ranked = sorted(spellings, key=lambda n: (bool(re.search("[а-яё]", n, re.I)), " " in n, names[n]), reverse=True)
        aliases[ranked[0]] = ranked[1:]
    merged = {a for v in aliases.values() for a in v} | set(aliases)
    loners = sorted(n for n in names if n not in merged and " " not in n.strip())
    return aliases, loners


def main(data_dir: Path) -> int:
    names = load_names(data_dir)
    if not names:
        print(f"No exported data in {data_dir}")
        return 1
    aliases, loners = suggest(names)
    print("Похожие написания (проверьте и сохраните в web/data/authors.json):")
    print(json.dumps(aliases, ensure_ascii=False, indent=2))
    if loners:
        print("\nЛогины без полного имени — допишите вручную, если знаете, чьи они:")
        for n in loners:
            print(f"  {n}  ({names[n]} событий)")
    return 0
