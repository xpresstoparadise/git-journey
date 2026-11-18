# AGENTS.md

Guidance for coding agents working on this repository. Humans: see README.md.

## What this is

A team's git history played as a film: a trunk grows through time, repositories branch off
and merge back, merge requests are small branches with their own commits, a star runs the
way and fades at "now", the finale is a twinkling map plus a contribution ranking. Data comes
from GitLab (REST v4) or from local clones (`git log`). The UI is a static page — no build
step, no framework, no npm dependencies.

## Commands

```bash
python -m unittest discover tests     # Python: ingest, local git, settings, photos (needs git)
node --test tests/                    # JS: layout invariants, story, data (node 18+)
python serve.py --no-browser          # UI at http://127.0.0.1:8766/   (?demo = demo team)
python fetch_local.py repos/ --no-serve   # build web/data from local clones
python lifeway.py --help              # the single entry point (also the binary)
python tools/export_public.py ../git-journey    # clean public copy (see Privacy)
```

Run both test suites before every commit. Both must stay green.

## Map

- `lifeway.py` — entry point: `local | gitlab | serve | suggest-authors`; PyInstaller builds it.
- `fetch_local.py`, `fetch_gitlab.py` — CLIs producing `web/data/gitlab_raw.{js,json}`.
- `ingest/` — Python, **standard library only**, 3.10+.
  `config.py` (.env + journey.json → Settings), `collect.py` (GitLab), `local.py` (git),
  `authors.py` (one person = one name), `special.py` (Journey marks), `settings_file.py`
  (journey.json), `photos.py` / `avatars.py`, `cache.py`, `export.py`.
- `web/js/` — ES modules. **Pure** (no DOM, imported by node tests): `data.js`, `layout.js`,
  `story.js`, `util.js`, `i18n.js`, `config.js`, `mock.js`. DOM: `scene.js` (SVG), `camera.js`,
  `player.js` (virtual clock), `cinema.js` (the script), `hud.js`, `present.js`, `main.js`.
- `.github/workflows/build.yml` — tests, then binaries for Windows/Linux/macOS; tag `v*` → release.

## Rules that are easy to break

- **Layout invariants** (tests/layout.test.mjs): one weekly height band for all lanes; nodes of
  a lane keep `NODE_GAP`; a lane keeps its slot for life; MR commits sit between fork and merge.
  Change `layout.js` only with the tests passing.
- **Strings**: every visible UI string goes through `t("key")` / `w(n, "word")` from `i18n.js`
  and needs both `en` and `ru` entries. Static HTML uses `data-i18n*` attributes.
- **Settings**: a new option goes into `ingest/settings_file.py` DEFAULTS, `web/js/config.js`
  DEFAULTS (if the page uses it), `journey.example.json` and both READMEs. Secrets stay in `.env`.
- **Time**: `player.wait/tween` run on the film clock (scaled by speed, paused with Space).
  Anything a viewer must be able to read (cards, farewell) is held in *real* time:
  `player.wait(ms * player.speed)` or `performance.now()` throttles in `hud.js`.
- **Narrow stage** (phone, 9:16 recording): layout reacts to the stage via container queries,
  not the window. Test 9:16 by adding `data-frame="9:16"` and classes `present recording` to `<body>`.
- **No CDNs, no network at runtime**: fonts are in `web/fonts`, photos in `web/data/avatars`.

## Privacy (important)

This repository may contain a real team's data. Never commit, copy into tests/docs, or export:
`web/data/gitlab_raw.*`, `web/data/authors.json`, `web/data/avatars/`, `web/data/config.js`,
`journey.json`, `.env`, anything in `repos/` or `photos/`. Tests, docs and the demo team use
**fictional** people and repositories only. The public copy is produced by
`tools/export_public.py`, which refuses to export if it finds internal names or hosts — add
new internal identifiers to its `FORBIDDEN` pattern rather than working around it.

## Verifying UI changes

Unit tests don't see pixels. For visual changes run the server and look at `/?demo` in a
browser (headless Chromium/Playwright works: pause with Space, then screenshot). Check the
wide layout, a narrow/9:16 stage, the finale (`F`), and both languages (`?lang=en|ru`).
