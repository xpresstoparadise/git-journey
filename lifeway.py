"""Git Life Way — one entry point (also the standalone binary).

    git-life-way                       local clones from ./repos, photos from ./photos → browser
    git-life-way local [DIR] [opts]    same, with options (see: git-life-way local --help)
    git-life-way gitlab [opts]         fetch from GitLab (.env: GITLAB_URL, GITLAB_TOKEN)
    git-life-way serve [--lan]         just open the last built film
    git-life-way suggest-authors       hints for authors.json
    git-life-way --version
"""
from __future__ import annotations

import sys

__version__ = "1.0.0"


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    cmd, rest = (argv[0], argv[1:]) if argv and not argv[0].startswith("-") else ("local", argv)
    if cmd in ("-V", "--version") or "--version" in argv[:1]:
        print(f"git-life-way {__version__}")
        return 0
    if cmd in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    if cmd == "local":
        import fetch_local
        return fetch_local.main(rest)
    if cmd == "gitlab":
        import fetch_gitlab
        return fetch_gitlab.main(rest)
    if cmd == "suggest-authors":
        import fetch_gitlab
        return fetch_gitlab.main(["--suggest-authors", *rest])
    if cmd == "serve":
        import serve
        serve.main(rest)
        return 0
    print(f"unknown command: {cmd}\n{__doc__}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    code = main()
    # Double-clicked binary on Windows: keep the window open to read an error.
    if code and getattr(sys, "frozen", False) and sys.platform == "win32" and sys.stdin and sys.stdin.isatty():
        input("\nНажмите Enter, чтобы закрыть…")
    raise SystemExit(code)
