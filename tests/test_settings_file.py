"""journey.json: defaults, filters, bot removal, the page's config.js."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingest.settings_file import drop_authors, load_file, wants_project, write_ui_config  # noqa: E402


class SettingsFileTest(unittest.TestCase):
    def test_defaults_and_partial_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "journey.json"
            p.write_text(json.dumps({"title": "Team", "_comment": "x", "film": {"speed": 2}, "ranking": {"mr": 5}}), encoding="utf-8")
            cfg = load_file(p)
        self.assertEqual(cfg["title"], "Team")
        self.assertEqual(cfg["film"]["speed"], 2)
        self.assertEqual(cfg["film"]["mode"], "highlights")  # untouched default
        self.assertEqual(cfg["ranking"], {"commit": 1, "mr": 5, "newRepo": 2})
        self.assertNotIn("_comment", cfg)
        self.assertEqual(load_file(Path("/nonexistent"))["ingest"]["aliveDays"], 90)

    def test_broken_file_falls_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "journey.json"
            p.write_text("{ not json", encoding="utf-8")
            self.assertEqual(load_file(p)["film"]["highlightStops"], 26)

    def test_project_filters(self):
        cfg = load_file(Path("/nonexistent"))
        cfg["ingest"]["include"] = ["team/*"]
        cfg["ingest"]["exclude"] = ["*/sandbox*"]
        self.assertTrue(wants_project("team/core", cfg))
        self.assertTrue(wants_project("Team/Core", cfg))  # case-insensitive
        self.assertFalse(wants_project("other/core", cfg))
        self.assertFalse(wants_project("team/sandbox-1", cfg))

    def test_drop_bots_everywhere(self):
        project = {
            "events": [
                {"type": "commit", "author": "Anna"},
                {"type": "commit", "author": "renovate[bot]"},
                {"type": "mr", "author": "Anna", "commits": [{"author": "Anna"}, {"author": "renovate[bot]"}]},
            ],
            "totals": {"commits": 3, "mrs": 1, "additions": 30, "deletions": 3, "authors": {
                "Anna": {"commits": 2, "mrs": 1, "additions": 20, "deletions": 2},
                "renovate[bot]": {"commits": 1, "mrs": 0, "additions": 10, "deletions": 1},
            }},
        }
        out = drop_authors(project, ["renovate*"])
        self.assertEqual([e["author"] for e in out["events"]], ["Anna", "Anna"])
        self.assertEqual([c["author"] for c in out["events"][1]["commits"]], ["Anna"])
        self.assertEqual(set(out["totals"]["authors"]), {"Anna"})
        self.assertEqual((out["totals"]["commits"], out["totals"]["additions"]), (2, 20))

    def test_page_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = load_file(Path("/nonexistent"))
            cfg["title"] = "Команда"
            path = write_ui_config(cfg, Path(tmp))
            text = path.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("window.LIFEWAY_CONFIG = "))
        data = json.loads(text[len("window.LIFEWAY_CONFIG = "):].rstrip(";\n"))
        self.assertEqual(data["title"], "Команда")
        self.assertEqual(data["aliveDays"], 90)
        self.assertNotIn("ingest", data)


if __name__ == "__main__":
    unittest.main()
