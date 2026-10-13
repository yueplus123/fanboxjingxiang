"""Fanbox author post statistics — HTTP server."""

from __future__ import annotations

import json
import os
import threading
import time
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from zoneinfo import ZoneInfo

from count_plans import analyze_creator, normalize_creator_id, to_api_response
from fanbox_client import FanboxError, FanboxHttpError, FanboxNetworkError

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
INDEX_FILE = STATIC_DIR / "index.html"
STATS_FILE = ROOT / "usage_stats.json"
TZ = ZoneInfo("Asia/Shanghai")

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8766"))
CACHE_TTL_SEC = int(os.environ.get("CACHE_TTL_SEC", "600"))

_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()

_stats_lock = threading.Lock()
_stats: dict = {
    "total_calls": 0,
    "today_date": "",
    "today_calls": 0,
    "last_call_at": None,
}


def _today_str() -> str:
    return datetime.now(TZ).date().isoformat()


def _load_stats() -> None:
    global _stats
    if not STATS_FILE.is_file():
        _stats["today_date"] = _today_str()
        return
    try:
        data = json.loads(STATS_FILE.read_text(encoding="utf-8"))
        _stats = {
            "total_calls": int(data.get("total_calls", 0)),
            "today_date": str(data.get("today_date") or _today_str()),
            "today_calls": int(data.get("today_calls", 0)),
            "last_call_at": data.get("last_call_at"),
        }
        if _stats["today_date"] != _today_str():
            _stats["today_date"] = _today_str()
            _stats["today_calls"] = 0
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        _stats = {
            "total_calls": 0,
            "today_date": _today_str(),
            "today_calls": 0,
            "last_call_at": None,
        }


def _save_stats_unlocked() -> None:
    tmp = STATS_FILE.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(_stats, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    tmp.replace(STATS_FILE)


def record_call() -> None:
    now = datetime.now(TZ)
    today = now.date().isoformat()
    with _stats_lock:
        if _stats["today_date"] != today:
            _stats["today_date"] = today
            _stats["today_calls"] = 0
        _stats["total_calls"] += 1
        _stats["today_calls"] += 1
        _stats["last_call_at"] = now.strftime("%Y-%m-%d %H:%M:%S")
        try:
            _save_stats_unlocked()
        except OSError as exc:
            print(f"failed to save usage stats: {exc}")


def get_usage_stats() -> dict:
    with _stats_lock:
        today = _today_str()
        if _stats["today_date"] != today:
            _stats["today_date"] = today
            _stats["today_calls"] = 0
        return {
            "total_calls": _stats["total_calls"],
            "today_calls": _stats["today_calls"],
            "last_call_at": _stats["last_call_at"],
        }


def get_analysis(creator_id: str) -> tuple[dict, bool, int | None]:
    now = time.time()
    with _cache_lock:
        entry = _cache.get(creator_id)
        if entry is not None:
            ts, raw = entry
            age = int(now - ts)
            if age < CACHE_TTL_SEC:
                return raw, True, age

    raw = analyze_creator(creator_id)
    with _cache_lock:
        _cache[creator_id] = (time.time(), raw)
    return raw, False, None


class Handler(BaseHTTPRequestHandler):
    server_version = "FanboxAnalyze/1.0"

    def log_message(self, fmt: str, *args) -> None:
        if self.path.startswith("/api/"):
            sys_log = f"{self.address_string()} - {fmt % args}"
            print(sys_log)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, content: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _send_error_json(self, status: int, message: str) -> None:
        self._send_json(status, {"error": message})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ("/", "/index.html"):
            if not INDEX_FILE.is_file():
                self._send_error_json(500, "index.html not found")
                return
            self._send_html(INDEX_FILE.read_bytes())
            return

        if path == "/api/stats":
            self._send_json(200, get_usage_stats())
            return

        if path == "/api/analyze":
            self._handle_analyze(parse_qs(parsed.query))
            return

        self._send_error_json(404, "Not found")

    def _handle_analyze(self, query: dict[str, list[str]]) -> None:
        raw_creator = (query.get("creator") or [""])[0]
        creator_id = normalize_creator_id(unquote(raw_creator))
        if not creator_id:
            self._send_error_json(400, "请提供有效的创作者 ID 或链接")
            return

        record_call()
        try:
            data, cached, cache_age = get_analysis(creator_id)
            response = to_api_response(
                data,
                cached=cached,
                cache_age_sec=cache_age if cached else None,
            )
            self._send_json(200, response)
        except FanboxHttpError as exc:
            self._send_error_json(502, str(exc))
        except FanboxNetworkError as exc:
            self._send_error_json(502, str(exc))
        except FanboxError as exc:
            self._send_error_json(502, str(exc))
        except Exception as exc:
            print(f"analyze error for {creator_id}: {exc}")
            traceback.print_exc()
            self._send_error_json(500, str(exc))


def main() -> None:
    if not STATIC_DIR.is_dir():
        STATIC_DIR.mkdir(parents=True, exist_ok=True)
    _load_stats()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Fanbox Analyze listening on http://{HOST}:{PORT}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
