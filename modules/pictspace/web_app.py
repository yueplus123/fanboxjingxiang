"""pictSPACE 批量购买本地网页。

启动: python web_app.py
浏览器打开: http://127.0.0.1:8765
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Windows：未设置时用 %LOCALAPPDATA%\ms-playwright。Linux 不改，走 Playwright 默认缓存。
if sys.platform == "win32" and not os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(
        Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"
    )

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from core import BatchJob, GuestProfile, analyze, groups_to_json, normalize_urls
from mail_imap import MailConfig, test_imap

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
CONFIG_PATH = ROOT / "config.local.json"

app = FastAPI(title="pictSPACE 批量购买")
app.mount("/static", StaticFiles(directory=STATIC), name="static")

_job = BatchJob()
_job.load_persisted_state()
_last_groups: dict | None = None


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "email": "",
        "imap_host": "imap.qq.com",
        "imap_port": 993,
        "imap_auth_code": "",
    }


def save_config(data: dict) -> None:
    cur = load_config()
    cur.update({k: v for k, v in data.items() if v is not None})
    CONFIG_PATH.write_text(
        json.dumps(cur, ensure_ascii=False, indent=2), encoding="utf-8"
    )


class AnalyzeBody(BaseModel):
    text: str = Field(..., description="商品链接，每行一个")


class GuestBody(BaseModel):
    email: str = ""
    auto_temp_order: bool = True
    imap_auth_code: str = ""


class StartBody(BaseModel):
    text: str
    headed: bool | None = None
    guest: GuestBody | None = None


class EmailLinkBody(BaseModel):
    url: str


class ImapBody(BaseModel):
    email: str = ""
    imap_auth_code: str


@app.get("/")
def index():
    return FileResponse(
        STATIC / "index.html",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@app.get("/api/config")
def api_config():
    cfg = load_config()
    code = cfg.get("imap_auth_code") or ""
    return {
        "email": cfg.get("email") or "",
        "imap_host": cfg.get("imap_host") or "imap.qq.com",
        "has_auth_code": bool(code),
        "imap_auth_code_masked": ("*" * min(8, len(code)) + code[-4:]) if len(code) >= 4 else ("*" * len(code)),
    }


@app.post("/api/imap/save")
def api_imap_save(body: ImapBody):
    save_config({"email": body.email, "imap_auth_code": body.imap_auth_code.strip()})
    return {"ok": True}


@app.post("/api/imap/test")
def api_imap_test(body: ImapBody):
    cfg = load_config()
    code = body.imap_auth_code.strip() or (cfg.get("imap_auth_code") or "")
    if not code:
        raise HTTPException(400, "请填写 QQ 邮箱 IMAP 授权码")
    try:
        msg = test_imap(
            MailConfig(
                email_addr=body.email or cfg.get("email") or "",
                auth_code=code,
                host=cfg.get("imap_host") or "imap.qq.com",
                port=int(cfg.get("imap_port") or 993),
            )
        )
        save_config({"email": body.email, "imap_auth_code": code})
        return {"ok": True, "message": msg}
    except Exception as e:
        raise HTTPException(400, f"IMAP 登录失败: {e}") from e


@app.post("/api/analyze")
def api_analyze(body: AnalyzeBody):
    urls = normalize_urls(body.text)
    if not urls:
        raise HTTPException(400, "没有有效的 pictSPACE 商品链接")

    groups, errors = analyze(urls)
    payload = groups_to_json(groups)
    return {
        "url_count": len(urls),
        "shop_count": len(payload),
        "item_count": sum(g["count"] for g in payload),
        "groups": payload,
        "errors": errors,
    }


@app.post("/api/start")
def api_start(body: StartBody):
    global _last_groups
    if _job._thread and _job._thread.is_alive():
        raise HTTPException(409, "已有任务在运行，请先完成或取消")

    urls = normalize_urls(body.text)
    if not urls:
        raise HTTPException(400, "没有有效的 pictSPACE 商品链接")

    groups, errors = analyze(urls)
    if not groups:
        raise HTTPException(400, "解析失败，没有可购买商品")

    guest_data = body.guest.model_dump() if body.guest else {}
    profile = GuestProfile.from_dict(guest_data)
    cfg = load_config()
    auth = (guest_data.get("imap_auth_code") or "").strip() or (cfg.get("imap_auth_code") or "")
    if auth:
        save_config({"email": profile.email, "imap_auth_code": auth})

    # Linux 无图形界面：强制无头；Windows 才允许有界面
    if sys.platform == "win32":
        headed = True if body.headed is None else bool(body.headed)
    else:
        headed = False
    _last_groups = groups
    _job.start(groups, headed=headed, profile=profile, imap_auth_code=auth)
    return {
        "ok": True,
        "shop_count": len(groups),
        "guest_mode": profile.enabled(),
        "imap_enabled": bool(auth),
        "errors": errors,
        "groups": groups_to_json(groups),
    }


@app.get("/api/status")
def api_status():
    return _job.snapshot()


@app.post("/api/continue")
def api_continue():
    snap = _job.snapshot()
    if snap["status"] not in {"waiting_payment", "waiting_email"}:
        raise HTTPException(400, f"当前状态不可继续: {snap['status']}")
    _job.continue_payment()
    return {"ok": True}


@app.post("/api/email-link")
def api_email_link(body: EmailLinkBody):
    snap = _job.snapshot()
    if snap["status"] != "waiting_email":
        raise HTTPException(400, "当前不在等待邮件链接状态")
    try:
        _job.submit_email_link(body.url)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True}


@app.post("/api/cancel")
def api_cancel():
    _job.cancel()
    return {"ok": True}


@app.post("/api/downloads/scan")
def api_downloads_scan():
    cfg = load_config()
    if not _job.imap_auth_code:
        _job.imap_auth_code = (cfg.get("imap_auth_code") or "").strip()
    if not _job.profile.email:
        _job.profile.email = cfg.get("email") or ""
    try:
        rows = _job.scan_download_mails()
    except Exception as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True, "count": len(rows), "download_links": rows}


def main() -> None:
    import uvicorn

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    # 默认只监听本机：这个页面没有登录保护，还保存着邮箱授权码。要对外访问请显式设置 PICTSPACE_HOST，并放在带登录的反向代理后面。
    host = os.environ.get("PICTSPACE_HOST", "127.0.0.1")
    port = int(os.environ.get("PICTSPACE_PORT", "8765"))
    print("pictSPACE 批量购买网页已启动")
    print(f"请在浏览器打开: http://{host}:{port}")
    print("QQ 邮箱需在设置里开启 IMAP，并生成「授权码」（不是 QQ 密码）填到网页。")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
