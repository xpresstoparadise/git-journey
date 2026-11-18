"""Special moments marked by the team itself in a commit message or MR description:

    Journey: finish                     → the film plays «Поздравляем! Проект завершён»
    Journey: goodbye Спасибо всем!      → «Good bye, <author>» with that note

`Journey: finish` / `Journey: goodbye` work the same. Short hashtags too:
#journey-finish, #journey-goodbye, …. Both patterns can be
replaced in .env (LIFEWAY_FINISH_RE / LIFEWAY_GOODBYE_RE, Python regex; the text
after the match on the same line becomes the note).
"""
from __future__ import annotations

import re

FINISH_RE = r"(?im)(?:^\s*(?:life-?way|journey)\s*:\s*(?:finish|done|closed?)\b|#(?:lifeway|journey)[-_]?(?:finish|done)\b)"
GOODBYE_RE = r"(?im)(?:^\s*(?:life-?way|journey)\s*:\s*(?:goodbye|good-?bye|farewell|bye)\b|#(?:lifeway|journey)[-_]?(?:goodbye|bye|farewell)\b)"


class SpecialMarks:
    def __init__(self, finish_re: str = FINISH_RE, goodbye_re: str = GOODBYE_RE) -> None:
        self.rules = [("finish", re.compile(finish_re)), ("goodbye", re.compile(goodbye_re))]

    def detect(self, *texts: str | None) -> dict:
        """{"special": kind, "note": text} or {} — first match wins, finish before goodbye."""
        for kind, rx in self.rules:
            for text in texts:
                if not text:
                    continue
                m = rx.search(text)
                if m:
                    rest = text[m.end():].split("\n", 1)[0]
                    note = rest.strip(" \t:—-–").strip()[:140]
                    return {"special": kind, **({"note": note} if note else {})}
        return {}
