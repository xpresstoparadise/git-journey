"""Git Journey — one entry point (also the standalone binary).

    git-journey                       local clones from ./repos, photos from ./photos → browser
    git-journey local [DIR] [opts]    same, with options (see: git-journey local --help)
    git-journey gitlab [opts]         fetch from GitLab (.env: GITLAB_URL, GITLAB_TOKEN)
    git-journey serve [--lan]         just open the last built film
    git-journey suggest-authors       hints for authors.json
    git-journey --version
"""
from __future__ import annotations

import sys

__version__ = "1.1.2"


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    cmd, rest = (argv[0], argv[1:]) if argv and not argv[0].startswith("-") else ("local", argv)
    if cmd in ("-V", "--version") or "--version" in argv[:1]:
        print(f"git-journey {__version__}")
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
