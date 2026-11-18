# Git Journey

**English** · [Русский](README.ru.md)

Your team's repositories, told as a film. A trunk grows upward through time, repositories
branch off it, the camera stops at every step the team took, and a star runs the whole
way — it kindles, burns like a sparkler, and goes out at the end. The finale is a map of
the year and what everyone put into it.

https://github.com/user-attachments/assets/762dc143-a4be-41a5-a7ce-23cd09ee2511

> Video: open `/?demo`, press **Record** → 16:9 or Telegram 9:16 — you get an MP4 of the demo team.

## Why

Code history usually lives in tables: commits, charts, “+1234 −56”. The most important
part gets lost there — every dot is somebody's morning, a decision, a night before a
release. This film tells the same story as a journey.

**The trunk is the team's shared time.** It grows bottom-up, from the start of the period
to *now*. Everything that happens in the repositories happens against it.

**Repositories are roads leaving the trunk.** A repository branches off at its first change
and then runs alongside. Living projects keep running in parallel all the way to *now*:
their story isn't over. Finished ones flow back into the trunk: their road is walked, and
what was built became part of the whole.

**A merge request is a small road inside a big one.** A branch steps aside, its commits
travel along it, and it merges back. That's what any piece of work looks like: step away,
make it, bring it back.

**The star is us, walking the road.** The running dot is the team — or one person, if you
pick them. At the start it glows modestly and drops a rare spark: everything is just
beginning. Month by month — projects, people, experience — it kindles: more sparks, a
longer tail. Near *now* it burns like a sparkler, in every direction. And then it goes out.

**Going out is not disappearing.** When the star fades, the map remains, and the whole
of it twinkles: every dot shines brighter the more was put into it. The road is walked,
the trace stays — that's the point.

**Congratulations!** A project brought to its end is not a line vanishing
from a list but a celebration: confetti, the names of everyone who built it, and the branch
solemnly flows back into the trunk.

**Good bye.** People leave — to other teams, to other lives. Their road isn't erased: it
stays on the map, lit up from end to end. The farewell takes its time: a portrait, the
person's own words and fifteen seconds of quiet. Someone who walked this road with the
team deserves more than a line in a log. People leave their farewell themselves — with
their last commit.

**The finale is gratitude, not a contest.** The ranking at the end isn't about who is
better, but about who put how much into the common thing. And anyone's own road is one
click away.

## Quick start

### Standalone binary (no Python)

Download the file for your OS from the Releases page and put it into an empty folder:

```
git-journey.exe      ← double-click
repos/                ← your clones go here (created on first run)
photos/               ← people's photos (optional)
```

Put clones (`git clone …`) into `repos/` and run the program: it builds the data and opens
the browser. Requires `git`.

```bash
git-journey                                  # repos/ → film in the browser
git-journey local D:/clones --period 2025-2026
git-journey gitlab                           # from GitLab, settings in .env
git-journey serve --lan                      # show the last built film on the network
```

### From source: local clones

```bash
python fetch_local.py                 # repos/ → web/data → browser (http://127.0.0.1:8766/)
python fetch_local.py --lan           # same, reachable on the local network
start-local.cmd / start-local.sh      # same, by double-click
```

What plain git history gives:

* commits with authors, dates and lines changed;
* **merge requests from merge commits**: GitLab writes “See merge request group/proj!12”
  into them, GitHub “Merge pull request #12”; the MR's own commits are everything between
  the merge's two parents. Squash merges show up as ordinary commits;
* repository birth from the root commit; `Journey:` marks from full commit messages;
* links to commits when the clone's `origin` points at GitLab/GitHub.

### From source: GitLab

```bash
cp .env.example .env              # GITLAB_URL, GITLAB_TOKEN, GITLAB_PERIOD
python fetch_gitlab.py            # → web/data/gitlab_raw.js (+ .json)
python serve.py                   # http://127.0.0.1:8766/  (LAN: http://<ip>:8766/)
```

Python 3.10+, standard library only. The ingest talks to GitLab **directly**: the system
HTTP proxy is ignored (`ProxyHandler({})`, `NO_PROXY=*`). Without data the UI shows a demo;
`?demo` always shows the demo team.

`python fetch_gitlab.py --period 2025-2026 --branch main` overrides `.env`. A repeated run
is **incremental**: repositories whose `last_activity_at` didn't move are taken from the
previous export without API calls (`--full` refetches everything). An open page checks for
a fresh export every 5 minutes and offers to reload. Scheduled refresh: `tools/refresh.cmd`
(Windows, the `schtasks` line is inside) or `tools/refresh.sh` (cron).

For every MR the export fetches its commits (`/merge_requests/:iid/commits`) — in the film
they travel along the MR's branch, not along the main line.

## Configuration — `journey.json`

One optional file next to the program (or in the repo root) for everything that isn't a
secret; copy `journey.example.json`. Every key is optional, missing ones use defaults, and
URL parameters (`?speed=2&mode=full&lang=en`) still win.

| Section | Keys |
|---|---|
| top level | `title`, `subtitle`, `language` (`auto` / `en` / `ru`) |
| `film` | `mode` (`highlights` / `full`), `speed`, `highlightStops`, `cardMinSeconds`, `farewellSeconds`, `sparks`, `sparkler`, `grain`, `confetti`, `accent` |
| `ranking` | points per `commit`, `mr`, `newRepo` |
| `ingest` | `groups` (GitLab groups instead of “all my projects”), `include` / `exclude` (path patterns), `excludeAuthors` (bots), `aliveDays`, `maxMrCommits` |

Film settings reach the page on every `serve` / fetch, no re-export needed. Secrets
(`GITLAB_TOKEN`) stay in `.env`.

## Language

The interface speaks English and Russian: browser language by default, `language` in
`journey.json`, `?lang=en|ru`, or the EN/RU button in the top bar (remembered). The demo
team switches language too.

## Photos

Two sources, they work together:

* **the `photos/` folder** — a file named after the person (any spelling the author
  merging knows), their commit e-mail or login: `Irina Savelieva.jpg`,
  `isavelieva@corp.example.png`, `isavelieva.webp`. jpg/png/webp/gif/svg, up to 5 MB.
  **Photos from the folder win over GitLab avatars**;
* **GitLab** — `fetch_gitlab.py` downloads avatars: `avatar_url` of MR authors and repo
  owners, and `GET /api/v4/avatar?email=…` for commit authors (`--no-avatars` skips it).

Everything ends up in `web/data/avatars/`, so the browser never needs GitLab (LAN, video
recording). No photo — initials.

## Controls

| Key / gesture | Action |
|---|---|
| Space | pause / continue |
| M | **Highlights** (~1.5 min) ↔ **Full** (every visit) |
| click on the bottom timeline | jump to that week |
| P | cinema mode: fullscreen, letterbox, subtitles |
| **Record** button | choose a format → the film from the start → a video file |
| 1 · 2 · 3 | speed 1× · 2× · 4× |
| F / End | straight to the finale |
| R | from the start |
| wheel, drag | look around (pauses the film) |
| click on a dot | event card with a link to GitLab |
| click on an author in the finale | light up their road on the map |

URL parameters: `?period=2026&speed=2&mode=full&person=Name`, `?demo` — the demo team.

## Recording video

**Record** → format:

| Format | For | What is recorded |
|---|---|---|
| Screen 16:9 | presentations, YouTube | the whole film in the current mode and speed, up to 1920×1080 |
| Telegram 9:16 | vertical video, stories | highlights at 1.5×, up to 1080×1920 |
| Square 1:1 | posts, chats | highlights at 1.5×, up to 1080×1080 |

The browser asks to capture the tab — pick this tab. For 9:16 and 1:1 the stage itself
becomes a vertical/square column for the recording: the card turns into a compact strip at
the bottom, captions become subtitles, and the file contains exactly the stage. Recording
stops by itself after the finale; earlier — `Esc` or the button again.

* **MP4 (H.264)** in Chrome/Edge 126+: Telegram and phones play it inline.
* Otherwise **WebM** — Telegram accepts it as a file.
* Resolution = the stage's pixels on screen: a taller monitor gives a sharper vertical video.

## Special moments: “Congratulations!” and “Good bye”

The team marks its last commit (or MR) with a line in the commit message or MR
description — the film stops and plays a scene:

```
Journey: finish  Handed over to production    → “Congratulations!”, confetti, the project's crew;
                                                  the repo closes and flows into the trunk
Journey: goodbye Thank you, team!              → “Good bye, <author>”, portrait, totals, their road on the map
```

The text after the mark is the scene's caption (optional). Short forms: `#journey-finish`,
`#journey-goodbye`. Your own patterns: `LIFEWAY_FINISH_RE` / `LIFEWAY_GOODBYE_RE` in `.env`
(Python regular expressions). Marked commits are never sampled away. See it: `/?demo`.

If there are several marks, the scene plays **once — for the latest one**:

* `goodbye` — the person's latest marked commit/MR across all repositories (author spellings
  merged, see `authors.json`);
* `finish` — the latest marked commit/MR within the project.

Earlier marks show as ordinary commits, so a mistaken or premature mark can be “overridden”
simply by adding a later one.

## One person's road

The **Person** list in the top bar, or `?person=Name`: stops only where they
changed something, everything else dimmed. Only their own goodbye plays, and “Congratulations!”
only for projects they worked on. The finale opens their card: lines of code, commits, MRs,
repositories and their share of the team's work.

## Authors: one person, one name

Spellings are merged automatically: same commit e-mail, same login, `Lena_Frost` =
`Lena Frost`. What can't be merged that way (a Latin and a Cyrillic spelling of the same name) goes into
`web/data/authors.json` — format in `web/data/authors.example.json`. The UI reads it live,
no re-export needed.

`python fetch_gitlab.py --suggest-authors` (or `git-journey suggest-authors`) suggests
pairs by transliteration and lists logins without a full name.

## How it's built

Notes for coding agents (layout invariants, i18n, privacy rules): [AGENTS.md](AGENTS.md).

```
lifeway.py             single entry point (and the binary): local | gitlab | serve | suggest-authors
fetch_local.py         CLI: local clones → web/data
fetch_gitlab.py        CLI: GitLab → web/data/gitlab_raw.{js,json}
ingest/
  config.py            .env → Settings (period, branch, limits, folders)
  gitlab.py            REST v4 client without proxy, pagination
  collect.py           GitLab: births, commits, MRs and their commits, per-author totals
  local.py             git log: commits, MRs from merge commits, links from origin
  authors.py           merging author spellings (union-find)
  avatars.py           photos from GitLab → web/data/avatars/
  photos.py            photos from the photos/ folder (win over GitLab)
  cache.py             incremental refresh: unchanged repos from the previous export
  suggest.py           hints for authors.json
  special.py           Journey: finish / goodbye marks
  settings_file.py     journey.json: defaults, filters, bots, the page's config.js
  export.py            JSON and <script> for the UI
serve.py               static web/ (no-store, correct MIME for .js)
web/
  index.html, css/, fonts/   (fonts bundled, OFL)
  js/data.js           normalisation, periods, stats, ranking               (pure)
  js/layout.js         geometry: time axis, lane and MR slots, nodes         (pure)
  js/story.js          which visits are key, which scenes play              (pure)
  js/scene.js          SVG: lanes, nodes, the star with its tail and sparks
  js/camera.js         camera: safe area, crane moves, pan/zoom
  js/player.js         virtual clock: pause, speed, cancel
  js/cinema.js         the script: highlights / full, seeking, special scenes
  js/present.js        cinema mode, recording: tab capture → stage crop → MP4/WebM
  js/hud.js            card, titles, timeline, tooltip, farewell
  js/i18n.js           English / Russian strings                            (pure)
  js/config.js         film settings from journey.json                      (pure)
  js/main.js           wiring, controls, keyboard
tests/                 python -m unittest discover tests · node --test tests/
.github/workflows/     tests + Windows/Linux/macOS binaries (tag v* → release)
```

Layout invariants (checked by the tests):

* **The time axis is warped.** A week is one height band for all lanes. Inside a lane,
  dots keep a fixed minimum gap, so labels never overlap while parallel repositories stay
  in sync in time.
* **Lane slots are permanent.** A lane keeps its slot for life; a slot is reused only after
  its previous owner has merged back, so lanes never drift or stick together. Labels always
  sit on the outer side of a lane.
* **The camera frames into the safe area** — the window minus open panels. The card sits on
  the side opposite the lane and can never cover it.

## Building the binary

GitHub Actions (`.github/workflows/build.yml`) runs the tests on every push and builds
PyInstaller binaries for Windows, Linux and macOS (as build artifacts). A `v*` tag
(`git tag v1.0.0 && git push --tags`) creates a release with the binaries attached.
The macOS binary is not signed: on first launch, right-click → Open.
