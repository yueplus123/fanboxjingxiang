"""Fanbox public API client (stdlib only)."""

from __future__ import annotations

import json
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

BASE_URL = "https://api.fanbox.cc"
TIMEOUT_SEC = 30
MAX_RETRIES = 4
RETRY_BASE_DELAY = 0.6
MAX_CONCURRENT = 6

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.fanbox.cc",
    "Referer": "https://www.fanbox.cc/",
    "Connection": "close",
}

_semaphore = threading.Semaphore(MAX_CONCURRENT)


class FanboxError(Exception):
    """Base Fanbox client error."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class FanboxHttpError(FanboxError):
    """HTTP-level error from Fanbox."""


class FanboxNetworkError(FanboxError):
    """Network / SSL / timeout error."""


def _is_retryable_http(status: int) -> bool:
    return status == 429 or status >= 500


def _is_retryable_exc(exc: BaseException) -> bool:
    if isinstance(exc, urllib.error.HTTPError):
        return _is_retryable_http(exc.code)
    if isinstance(exc, urllib.error.URLError):
        reason = exc.reason
        if isinstance(reason, ssl.SSLError):
            return True
        if isinstance(reason, (TimeoutError, ConnectionResetError, BrokenPipeError, OSError)):
            msg = str(reason).lower()
            if any(k in msg for k in ("ssl", "eof", "reset", "timed out", "timeout", "connection")):
                return True
        msg = str(exc).lower()
        return any(k in msg for k in ("ssl", "eof", "reset", "timed out", "timeout"))
    if isinstance(exc, (TimeoutError, ConnectionResetError, ssl.SSLError, OSError)):
        msg = str(exc).lower()
        return any(k in msg for k in ("ssl", "eof", "reset", "timed out", "timeout", "connection"))
    return False


def _request_json(path: str, params: dict[str, str] | None = None) -> Any:
    query = urllib.parse.urlencode(params or {})
    url = f"{BASE_URL}{path}"
    if query:
        url = f"{url}?{query}"

    last_exc: BaseException | None = None
    for attempt in range(MAX_RETRIES):
        try:
            with _semaphore:
                req = urllib.request.Request(url, headers=_HEADERS, method="GET")
                with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
                    raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            if isinstance(data, dict) and data.get("error"):
                raise FanboxHttpError(str(data["error"]), status=401)
            return data
        except FanboxHttpError:
            raise
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if _is_retryable_http(exc.code) and attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BASE_DELAY * (attempt + 1))
                continue
            raise FanboxHttpError(
                f"请求 Fanbox 失败 (HTTP {exc.code})，请检查创作者 ID",
                status=exc.code,
            ) from exc
        except (urllib.error.URLError, TimeoutError, ssl.SSLError, OSError) as exc:
            last_exc = exc
            if _is_retryable_exc(exc) and attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_BASE_DELAY * (attempt + 1))
                continue
            raise FanboxNetworkError("连接 Fanbox 时网络中断，请稍后重试") from exc

    raise FanboxNetworkError(f"网络错误: {last_exc}")


def _extract_list(body: Any, *keys: str) -> list[dict[str, Any]]:
    """Fanbox 曾返回 body 为数组；现多为 { posts: [...] } / { plans: [...] }。"""
    if isinstance(body, list):
        return [item for item in body if isinstance(item, dict)]
    if isinstance(body, dict):
        for key in keys:
            items = body.get(key)
            if isinstance(items, list):
                return [item for item in items if isinstance(item, dict)]
    return []


def list_creator_plans(creator_id: str) -> list[dict[str, Any]]:
    data = _request_json("/plan.listCreator", {"creatorId": creator_id})
    body = data.get("body") if isinstance(data, dict) else None
    return _extract_list(body, "plans", "supportingPlans")


def list_creator_posts_page(
    creator_id: str,
    *,
    first_id: str | None = None,
    first_published_datetime: str | None = None,
) -> list[dict[str, Any]]:
    params: dict[str, str] = {
        "creatorId": creator_id,
        "sort": "newest",
        "limit": "100",
    }
    if first_id and first_published_datetime:
        params["firstId"] = first_id
        params["firstPublishedDatetime"] = first_published_datetime

    data = _request_json("/post.listCreator", params)
    body = data.get("body") if isinstance(data, dict) else None
    return _extract_list(body, "posts", "items")
