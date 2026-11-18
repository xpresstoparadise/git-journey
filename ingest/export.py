"""Write the dataset as JSON (for tools) and as a `<script>` file the UI loads
without any fetch/CORS dance: `window.GITLAB_META` + `window.GITLAB_RAW`."""
from __future__ import annotations

import json
from pathlib import Path


def write_dataset(out_dir: Path, meta: dict, projects: list[dict]) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "gitlab_raw.json"
    js_path = out_dir / "gitlab_raw.js"
    meta = {**meta, "count": len(projects)}
    json_path.write_text(json.dumps({**meta, "projects": projects}, ensure_ascii=False, indent=2), encoding="utf-8")
    js_path.write_text(
        "window.GITLAB_META = "
        + json.dumps(meta, ensure_ascii=False)
        + ";\nwindow.GITLAB_RAW = "
        + json.dumps(projects, ensure_ascii=False)
        + ";\n",
        encoding="utf-8",
    )
    return json_path, js_path
