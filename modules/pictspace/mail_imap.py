"""通过 IMAP 读取 QQ 邮箱，提取 pictSPACE 注文完了 / 支付完成 / 下载链接。"""

from __future__ import annotations

import email
import imaplib
import re
import time
from dataclasses import dataclass
from email.header import decode_header
from email.utils import parsedate_to_datetime
from html import unescape

URL_RE = re.compile(
    r"https?://(?:www\.)?pictspace\.net/[^\s\"'<>）】\]>]+",
    re.I,
)
ORDER_DETAIL_URL_RE = re.compile(
    r"https?://(?:www\.)?pictspace\.net/orders/detail/[A-Za-z0-9+/=_-]+",
    re.I,
)
PRIORITY_RE = re.compile(
    r"(complete|confirm|finish|temp|order|check|pay|決済|完了)",
    re.I,
)
ORDER_DETAIL_RE = re.compile(
    r"(detail|download|dl|order|check_order|取引|注文)",
    re.I,
)
PAYMENT_DONE_HINT = re.compile(
    r"(決済完了|決済しました|お支払い完了|支払い完了|payment\s*complete|ご入金|ダウンロード)",
    re.I,
)
TEMP_ORDER_HINT = re.compile(r"(仮注文|注文完了URL|仮注文完了)", re.I)


@dataclass
class MailConfig:
    email_addr: str
    auth_code: str
    host: str = "imap.qq.com"
    port: int = 993


def _decode_mime(value: str | None) -> str:
    if not value:
        return ""
    parts = []
    for chunk, enc in decode_header(value):
        if isinstance(chunk, bytes):
            parts.append(chunk.decode(enc or "utf-8", errors="replace"))
        else:
            parts.append(chunk)
    return "".join(parts)


def _walk_text(msg: email.message.Message) -> str:
    chunks: list[str] = []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype in ("text/plain", "text/html"):
                try:
                    payload = part.get_payload(decode=True) or b""
                    charset = part.get_content_charset() or "utf-8"
                    chunks.append(payload.decode(charset, errors="replace"))
                except Exception:
                    continue
    else:
        try:
            payload = msg.get_payload(decode=True) or b""
            charset = msg.get_content_charset() or "utf-8"
            chunks.append(payload.decode(charset, errors="replace"))
        except Exception:
            pass
    return "\n".join(chunks)


def extract_pictspace_urls(text: str) -> list[str]:
    text = unescape(text or "")
    found: list[str] = []
    seen: set[str] = set()

    # 优先完整抓取订单详情 URL（含 base64 段）
    for m in ORDER_DETAIL_URL_RE.finditer(text):
        u = m.group(0).rstrip(".,;:，。；：)）]>」』\"'")
        if u not in seen:
            seen.add(u)
            found.append(u)

    for m in URL_RE.finditer(text):
        u = m.group(0).rstrip(".,;:，。；：)）]>」』\"'")
        if u not in seen:
            seen.add(u)
            found.append(u)

    def score(u: str) -> int:
        s = 0
        if "/orders/detail/" in u.lower():
            s += 20
        if PRIORITY_RE.search(u):
            s += 10
        if "/orders/" in u:
            s += 5
        if "download" in u.lower() or u.lower().endswith(".zip"):
            s -= 20
        return s

    found.sort(key=score, reverse=True)
    return found


def test_imap(cfg: MailConfig) -> str:
    M = imaplib.IMAP4_SSL(cfg.host, cfg.port)
    try:
        M.login(cfg.email_addr, cfg.auth_code)
        M.select("INBOX", readonly=True)
        return "IMAP 登录成功"
    finally:
        try:
            M.logout()
        except Exception:
            pass


def poll_completion_url(
    cfg: MailConfig,
    *,
    after_ts: float,
    exclude_urls: set[str] | None = None,
    timeout_sec: int = 180,
    interval_sec: float = 4.0,
    log=None,
    should_cancel=None,
) -> str | None:
    exclude_urls = exclude_urls or set()
    deadline = time.time() + timeout_sec
    seen_uids: set[bytes] = set()

    if log:
        log(f"开始读取邮箱 {cfg.email_addr}（最多等待 {timeout_sec}s）…")

    while time.time() < deadline:
        if should_cancel and should_cancel():
            return None
        try:
            url = _fetch_once(cfg, after_ts, exclude_urls, seen_uids, log)
            if url:
                return url
        except Exception as e:
            if log:
                log(f"  读信暂时失败: {e}")
        time.sleep(interval_sec)

    if log:
        log("读取邮件超时，未拿到新的完了链接。")
    return None


def _fetch_once(
    cfg: MailConfig,
    after_ts: float,
    exclude_urls: set[str],
    seen_uids: set[bytes],
    log,
) -> str | None:
    M = imaplib.IMAP4_SSL(cfg.host, cfg.port)
    try:
        M.login(cfg.email_addr, cfg.auth_code)
        typ, _ = M.select("INBOX", readonly=True)
        if typ != "OK":
            raise RuntimeError("无法打开收件箱")

        candidates: list[bytes] = []
        for criteria in ("(UNSEEN)", "(ALL)"):
            typ, data = M.search(None, criteria)
            if typ == "OK" and data and data[0]:
                ids = data[0].split()
                candidates = ids[-30:]
                if criteria == "(UNSEEN)" and candidates:
                    break

        for uid in reversed(candidates):
            if uid in seen_uids:
                continue
            typ, data = M.fetch(uid, "(RFC822)")
            if typ != "OK" or not data or not data[0]:
                continue
            raw = data[0][1]
            msg = email.message_from_bytes(raw)
            seen_uids.add(uid)

            subject = _decode_mime(msg.get("Subject"))
            from_ = _decode_mime(msg.get("From"))
            date_hdr = msg.get("Date")
            try:
                msg_ts = parsedate_to_datetime(date_hdr).timestamp() if date_hdr else 0
            except Exception:
                msg_ts = 0

            if msg_ts and msg_ts < after_ts - 30:
                continue

            blob = subject + "\n" + from_ + "\n" + _walk_text(msg)
            low = blob.lower()
            if (
                "pictspace" not in low
                and "pict space" not in low
                and "仮注文" not in blob
                and "注文" not in subject
            ):
                if "pictspace.net" not in low:
                    continue

            urls = extract_pictspace_urls(blob)
            for u in urls:
                if u in exclude_urls:
                    continue
                if log:
                    log(f"  读取到邮件「{subject[:40]}」→ {u}")
                return u
        return None
    finally:
        try:
            M.logout()
        except Exception:
            pass


def list_recent_pictspace_mails(
    cfg: MailConfig,
    *,
    after_ts: float = 0,
    limit: int = 50,
) -> list[dict]:
    """列出最近 pictSPACE 相关邮件。"""
    from datetime import datetime, timezone

    M = imaplib.IMAP4_SSL(cfg.host, cfg.port)
    out: list[dict] = []
    try:
        M.login(cfg.email_addr, cfg.auth_code)
        typ, _ = M.select("INBOX", readonly=True)
        if typ != "OK":
            raise RuntimeError("无法打开收件箱")

        # 优先按日期缩小范围，避免漏掉新邮件 / 扫到过旧邮件
        if after_ts:
            day = datetime.fromtimestamp(max(0, after_ts - 86400), tz=timezone.utc)
            since = day.strftime("%d-%b-%Y")
            typ, data = M.search(None, f'(SINCE {since})')
            if typ != "OK" or not data or not data[0]:
                typ, data = M.search(None, "(ALL)")
        else:
            typ, data = M.search(None, "(ALL)")

        if typ != "OK" or not data or not data[0]:
            return []
        ids = data[0].split()[-limit:]
        for uid in reversed(ids):
            typ, raws = M.fetch(uid, "(RFC822)")
            if typ != "OK" or not raws or not raws[0]:
                continue
            msg = email.message_from_bytes(raws[0][1])
            subject = _decode_mime(msg.get("Subject"))
            from_ = _decode_mime(msg.get("From"))
            date_hdr = msg.get("Date")
            try:
                msg_ts = parsedate_to_datetime(date_hdr).timestamp() if date_hdr else 0
            except Exception:
                msg_ts = 0
            # 无日期的邮件放行；有日期则必须在 after 之后（允许 10 分钟偏差）
            if after_ts and msg_ts and msg_ts < after_ts - 600:
                continue
            body = _walk_text(msg)
            blob = f"{subject}\n{from_}\n{body}"
            low = blob.lower()
            if "pictspace" not in low and "pictspace.net" not in low:
                continue
            urls = extract_pictspace_urls(blob)
            kind = "other"
            if TEMP_ORDER_HINT.search(blob) and not PAYMENT_DONE_HINT.search(blob):
                kind = "temp_order"
            elif PAYMENT_DONE_HINT.search(blob) or ("決済" in subject):
                kind = "payment_done"
            elif any("/orders/detail/" in (u or "").lower() for u in urls):
                kind = "payment_done"
            elif any(ORDER_DETAIL_RE.search(u) for u in urls) and "仮注文" not in subject:
                kind = "payment_done"
            out.append(
                {
                    "uid": uid.decode(errors="ignore"),
                    "subject": subject,
                    "from": from_,
                    "ts": msg_ts,
                    "kind": kind,
                    "urls": urls,
                    "text": blob[:4000],
                }
            )
        return out
    finally:
        try:
            M.logout()
        except Exception:
            pass


def pick_order_urls(urls: list[str]) -> list[str]:
    """只保留邮件中的订单详情页链接（/orders/detail/…），不要下载/zip/其它。"""
    out: list[str] = []
    seen: set[str] = set()
    for u in urls or []:
        u = (u or "").strip().rstrip(".,;:，。；：)）]>」』\"'")
        if not re.search(r"pictspace\.net/orders/detail/", u, re.I):
            continue
        base = u.split("?", 1)[0].split("#", 1)[0]
        if base in seen:
            continue
        seen.add(base)
        out.append(base)
    return out


def scrape_order_downloads(order_url: str) -> list[dict]:
    """兼容旧调用：不再抓取下载文件，仅返回订单页本身。"""
    return [{"title": "订单链接", "url": order_url}]


def extract_shop_from_subject(subject: str) -> str:
    """从支付完成邮件标题提取店铺名。"""
    subject = subject or ""
    patterns = [
        r"\[pictSPACE\]\s*(.+?)単品の頒布物",
        r"\[pictSPACE\]\s*(.+?)の頒布物を決済",
        r"\[pictSPACE\]\s*(.+?)の頒布物",
    ]
    for pat in patterns:
        m = re.search(pat, subject, re.I)
        if m:
            return m.group(1).strip()
    return ""


def _name_related(a: str, b: str) -> bool:
    """店铺 ID / 显示名是否相关（支持 largenothing3000 vs nothing3000）。"""
    a = (a or "").strip().lower()
    b = (b or "").strip().lower()
    if not a or not b:
        return False
    if a == b:
        return True
    if a in b or b in a:
        return True
    # 去掉常见前缀后再比
    for prefix in ("large", "official", "the"):
        if a.startswith(prefix) and a[len(prefix) :] == b:
            return True
        if b.startswith(prefix) and b[len(prefix) :] == a:
            return True
    return False


def match_shop_for_mail(
    text: str,
    payment_links: list[dict],
    subject: str = "",
) -> dict | None:
    """用店铺名 / 商品标题 / 邮件标题把邮件对应到本批第几店。"""
    blob = f"{subject}\n{text}"
    blob_l = blob.lower()
    subj_shop = extract_shop_from_subject(subject)

    best = None
    best_score = 0
    for row in payment_links:
        score = 0
        shop = (row.get("shop") or "").strip()
        shop_name = (row.get("shop_name") or "").strip()
        shop_l = shop.lower()
        name_l = shop_name.lower()

        if shop_l and shop_l in blob_l:
            score += 10
        if name_l and name_l in blob_l:
            score += 8
        if subj_shop and _name_related(subj_shop, shop):
            score += 16
        if subj_shop and _name_related(subj_shop, shop_name):
            score += 16

        if shop_name:
            for part in re.split(r"[\s\-_/|｜]+", shop_name):
                if len(part) >= 2 and part.lower() in blob_l:
                    score += 6
                    break

        for it in row.get("items") or []:
            title = (it.get("title") or "").strip()
            if len(title) >= 4 and title.lower() in blob_l:
                score += 10
            # 取标题里较短日文/英文片段
            for piece in re.split(r"[/｜|\s]+", title):
                piece = piece.strip()
                if len(piece) >= 4 and piece.lower() in blob_l:
                    score += 5
                    break

        if score > best_score:
            best_score = score
            best = row
    if best_score >= 6:
        return best
    return None
