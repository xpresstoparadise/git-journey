"""Minimal GitLab REST v4 client that always talks to GitLab directly.

Corporate GitLab is usually reachable only *around* the system HTTP proxy, so
the opener ignores HTTP(S)_PROXY entirely (`ProxyHandler({})`).
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Protocol

USER_AGENT = "git-journey/0.2"
PROXY_VARS = ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy")


class GitLabError(RuntimeError):
    def __init__(self, status: int, url: str, body: str) -> None:
        super().__init__(f"HTTP {status} {url}: {body[:300]}")
        self.status = status


class GitLabApi(Protocol):
    """What the collector needs — lets tests pass a fake."""

    def get(self, path: str, params: dict | None = None) -> Any: ...

    def get_all(self, path: str, params: dict | None = None, max_pages: int = 20) -> list: ...

    def download(self, url: str, max_bytes: int = 2_000_000) -> tuple[bytes, str]: ...


def disable_env_proxies() -> None:
    """Child libraries must not pick up the system proxy either."""
    for key in PROXY_VARS:
        os.environ.pop(key, None)
    os.environ["NO_PROXY"] = "*"
    os.environ["no_proxy"] = "*"


def direct_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
    )


class GitLabClient:
    def __init__(self, base_url: str, token: str, timeout: float = 60) -> None:
        self.base = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.opener = direct_opener()

    def _request(self, path: str, params: dict | None) -> tuple[Any, dict[str, str]]:
        url = f"{self.base}/api/v4{path}"
        query = urllib.parse.urlencode(params or {}, doseq=True)
        if query:
            url = f"{url}?{query}"
        req = urllib.request.Request(
            url,
            headers={"PRIVATE-TOKEN": self.token, "Accept": "application/json", "User-Agent": USER_AGENT},
        )
        try:
            with self.opener.open(req, timeout=self.timeout) as resp:
                headers = {k.lower(): v for k, v in resp.headers.items()}
                body = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            raise GitLabError(e.code, url, e.read().decode("utf-8", errors="replace")) from e
        return (json.loads(body) if body else None), headers

    def get(self, path: str, params: dict | None = None) -> Any:
        return self._request(path, params)[0]

    def download(self, url: str, max_bytes: int = 2_000_000) -> tuple[bytes, str]:
        """Fetch a file (avatar). The token goes only to our own GitLab host."""
        if url.startswith("/"):
            url = self.base + url
        headers = {"User-Agent": USER_AGENT}
        if urllib.parse.urlsplit(url).netloc == urllib.parse.urlsplit(self.base).netloc:
            headers["PRIVATE-TOKEN"] = self.token
        try:
            with self.opener.open(urllib.request.Request(url, headers=headers), timeout=20) as resp:
                data = resp.read(max_bytes + 1)
                ctype = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            raise GitLabError(e.code, url, "") from e
        if len(data) > max_bytes:
            raise ValueError(f"too large: {url}")
        return data, ctype

    def get_all(self, path: str, params: dict | None = None, max_pages: int = 20) -> list:
        params = {"per_page": 100, **(params or {})}
        out: list = []
        page = 1
        for _ in range(max_pages):
            data, headers = self._request(path, {**params, "page": page})
            if not isinstance(data, list):
                return [data] if data else out
            out.extend(data)
            next_page = headers.get("x-next-page") or ""
            if not data or len(data) < int(params["per_page"]) or not next_page:
                break
            page = int(next_page)
        return out
