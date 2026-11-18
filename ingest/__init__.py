"""Life Way ingest: GitLab or local clones → the dataset the UI plays."""
import sys

# Windows consoles and CI pipes default to a legacy code page (cp1252/cp866) and
# crash on the Russian messages; speak UTF-8 and never die on an odd character.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
