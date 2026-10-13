"""pictSPACE 批量购买 — 共享核心逻辑（CLI / Web 共用）。"""

from __future__ import annotations

import os
import re
import sys
import json
import threading
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

BASE = "https://pictspace.net"
ITEM_RE = re.compile(r"/items/detail/(\d+)", re.I)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


@dataclass
class Item:
    item_id: str
    url: str
    title: str
    shop: str
    shop_name: str
    price: str
    kind: str

    def to_dict(self) -> dict:
        return asdict(self)


def parse_item_id(url: str) -> str | None:
    m = ITEM_RE.search(url)
    return m.group(1) if m else None


def normalize_urls(raw: str | list[str]) -> list[str]:
    if isinstance(raw, str):
        lines = raw.splitlines()
    else:
        lines = raw
    urls: list[str] = []
    seen: set[str] = set()
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        line = line.split("#", 1)[0].strip()
        if "pictspace.net" not in line:
            continue
        iid = parse_item_id(line)
        if not iid or iid in seen:
            continue
        seen.add(iid)
        urls.append(line)
    return urls


def _text(el) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)) if el else ""


def fetch_item(client: httpx.Client, url: str) -> Item:
    item_id = parse_item_id(url)
    assert item_id
    detail = f"{BASE}/items/detail/{item_id}"
    r = client.get(detail, follow_redirects=True)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")

    shop = ""
    for a in soup.select("a.nav-link, a[href]"):
        href = a.get("href") or ""
        text = _text(a)
        if text == "店舗TOP" and href.startswith("/") and not href.startswith("//"):
            shop = href.strip("/").split("/")[0]
            break
    if not shop:
        m = re.search(r'fromurl=/([^"\'&?/]+)', r.text)
        if m and m.group(1) not in {"items", "orders", "users", "statics"}:
            shop = m.group(1)
    if not shop:
        m = re.search(r'href="/(?!items|orders|users|statics|assets)([A-Za-z0-9_\-]+)"', r.text)
        if m:
            shop = m.group(1)

    form_title = _text(soup.select_one("form[name=frm] h1"))
    shop_name = ""
    for candidate in soup.select("h1, .fs-2, .fw-bold"):
        t = _text(candidate)
        if " - " in t and t != form_title:
            shop_name = t
            break
    if not shop_name:
        shop_name = shop

    title = form_title or _text(soup.select_one("h1")) or f"item-{item_id}"

    price = ""
    for h in soup.select("h1, .fs-1, .price"):
        t = _text(h)
        if "円" in t and len(t) < 40:
            price = t
            break
    if not price:
        m = re.search(r"(\d[\d,]*)\s*円", soup.get_text(" ", strip=True))
        price = f"{m.group(1)}円" if m else "?"

    kind = "unknown"
    badges = " ".join(_text(b) for b in soup.select(".badge"))
    body = soup.get_text()
    if "ダウンロード" in badges or "ダウンロード" in body:
        kind = "ダウンロード"
    if "配送" in badges:
        kind = "配送"

    if not shop:
        raise RuntimeError(f"无法解析店铺: {detail}")

    return Item(
        item_id=item_id,
        url=detail,
        title=title,
        shop=shop,
        shop_name=shop_name,
        price=price,
        kind=kind,
    )


def analyze(
    urls: list[str],
    on_progress=None,
) -> tuple[dict[str, list[Item]], list[dict]]:
    """返回 (groups, errors)。on_progress(i, total, message)。"""
    groups: dict[str, list[Item]] = defaultdict(list)
    errors: list[dict] = []
    total = len(urls)
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.8"},
        timeout=30.0,
        follow_redirects=True,
    ) as client:
        for i, url in enumerate(urls, 1):
            if on_progress:
                on_progress(i, total, f"解析 {url}")
            try:
                item = fetch_item(client, url)
            except Exception as e:
                errors.append({"url": url, "error": str(e)})
                continue
            groups[item.shop].append(item)
            if on_progress:
                on_progress(i, total, f"{item.shop}: {item.title}")
            time.sleep(0.35)
    return dict(groups), errors


def groups_to_json(groups: dict[str, list[Item]]) -> list[dict]:
    out = []
    for idx, (shop, items) in enumerate(groups.items(), 1):
        out.append(
            {
                "index": idx,
                "shop": shop,
                "shop_name": items[0].shop_name if items else shop,
                "count": len(items),
                "cart_url": f"{BASE}/orders/cart_check/{shop}",
                "items": [it.to_dict() for it in items],
            }
        )
    return out


def _ensure_browsers_path() -> None:
    if not os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
        local = os.environ.get("LOCALAPPDATA") or ""
        if local:
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(Path(local) / "ms-playwright")


def _pass_age_gate(page) -> None:
    btn = page.get_by_role("button", name=re.compile(r"18歳以上"))
    try:
        if btn.count() and btn.first.is_visible(timeout=1500):
            btn.first.click()
            page.wait_for_timeout(500)
    except Exception:
        pass


def _ensure_cart_js(page) -> None:
    page.evaluate("() => { window.checkNum = function(){ return true; }; }")


def add_item_to_cart(page, item: Item) -> None:
    page.goto(item.url, wait_until="domcontentloaded")
    _pass_age_gate(page)
    _ensure_cart_js(page)
    add_btn = page.get_by_role("button", name=re.compile(r"カートに入れる"))
    add_btn.first.wait_for(state="visible", timeout=15000)
    add_btn.first.click()
    page.wait_for_url(re.compile(rf".*/{re.escape(item.shop)}(/|$|\?)"), timeout=20000)
    page.wait_for_timeout(800)


@dataclass
class GuestProfile:
    """游客下单资料（仅虚拟/下载商品：邮箱即可）。"""

    email: str = ""
    auto_temp_order: bool = True  # 是否自动点「仮注文を実行」

    @classmethod
    def from_dict(cls, data: dict | None) -> "GuestProfile":
        data = data or {}
        email = (data.get("email") or "").strip() or ""
        return cls(
            email=email,
            auto_temp_order=bool(data.get("auto_temp_order", True)),
        )

    def enabled(self) -> bool:
        return bool(self.email)


class AddressRequiredError(RuntimeError):
    """结算页出现可见地址/配送字段，需人工处理。"""


def _fill_if_present(page, selector: str, value: str) -> bool:
    if not value:
        return False
    loc = page.locator(selector)
    if loc.count() == 0:
        return False
    el = loc.first
    try:
        if not el.is_visible():
            page.evaluate(
                """([sel, val]) => {
                  const el = document.querySelector(sel);
                  if (el) { el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); }
                }""",
                [selector, value],
            )
            return True
        el.fill(value)
        return True
    except Exception:
        return False


def page_requires_shipping_address(page) -> list[str]:
    """检测订单页是否出现需要填写的可见地址/配送相关字段。"""
    found = page.evaluate(
        """() => {
          const names = [
            'name', 'tel', 'tel1', 'tel2', 'tel3',
            'post', 'post1', 'post2',
            'address1', 'address2', 'address3', 'address4'
          ];
          const hit = [];
          for (const n of names) {
            const nodes = [...document.querySelectorAll(`[name="${n}"]`)];
            for (const el of nodes) {
              const style = window.getComputedStyle(el);
              const visible = el.offsetParent !== null
                && style.visibility !== 'hidden'
                && style.display !== 'none'
                && el.type !== 'hidden';
              if (visible) {
                hit.push(n);
                break;
              }
            }
          }
          // 文案兜底：明显的配送先区块
          const text = document.body.innerText || '';
          if (/配送先|お届け先|郵便番号|都道府県/.test(text)
              && document.querySelector('input[name=address1], input[name=post1], select[name=address1], input[name=name]')) {
            // 若上面已命中可见字段则已在 hit 中；这里仅补强
          }
          return hit;
        }"""
    )
    return list(found or [])


def fill_guest_order_form(page, profile: GuestProfile) -> None:
    """只填邮箱；不自动填任何地址。"""
    _fill_if_present(page, "input[name=mail]", profile.email)
    _fill_if_present(page, "#mail", profile.email)


def guest_checkout_to_temp_order(page, shop: str, profile: GuestProfile, log) -> str:
    """
    游客模式走到「仮注文」之后。
    若需要地址则抛出 AddressRequiredError，由上层暂停给人工处理。
    """
    cart_url = f"{BASE}/orders/cart_check/{shop}?no_signup=on"
    log(f"进入游客购物车: {cart_url}")
    page.goto(cart_url, wait_until="domcontentloaded")
    _pass_age_gate(page)

    proceed = page.get_by_role("button", name=re.compile(r"注文画面へ進む"))
    if proceed.count() == 0:
        proceed = page.locator("button, a, input[type=submit]").filter(
            has_text=re.compile(r"注文画面へ進む")
        )
    proceed.first.click()
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(800)
    _pass_age_gate(page)

    if "/orders/add/" not in page.url:
        page.goto(f"{BASE}/orders/add/{shop}", wait_until="domcontentloaded")
        _pass_age_gate(page)

    shipping_fields = page_requires_shipping_address(page)
    if shipping_fields:
        raise AddressRequiredError(
            "结算页需要填写地址/配送信息（字段: "
            + ", ".join(shipping_fields)
            + "）。已暂停，请在弹出浏览器查看并自行处理。"
        )

    log(f"填写游客邮箱: {profile.email}")
    fill_guest_order_form(page, profile)

    page.get_by_role("button", name=re.compile(r"注文確認画面へ")).click()
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(1000)

    # 提交后若因缺地址被拦回，或确认页仍提示地址
    shipping_fields = page_requires_shipping_address(page)
    body = page.inner_text("body")
    if shipping_fields or re.search(r"住所|郵便番号|配送先|お届け先|電話番号.*入力", body):
        if "add_confirm" not in page.url and "注文確認" not in page.title():
            raise AddressRequiredError(
                "提交后仍要求地址/配送信息。已暂停，请在弹出浏览器查看。"
            )

    if "add_confirm" not in page.url and "注文確認" not in page.title():
        raise RuntimeError(f"未能进入注文确认页。页面摘要: {body[:500]}")

    if profile.auto_temp_order:
        log("提交仮注文（游客）…")
        btn = page.get_by_role("button", name=re.compile(r"仮注文を実行"))
        if btn.count() == 0:
            btn = page.locator("button, input[type=submit]").filter(
                has_text=re.compile(r"仮注文")
            )
        btn.first.click()
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(1200)
    return page.url


class BatchJob:
    """可被网页控制的逐店加购 + 游客结算任务。"""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.logs: list[str] = []
        # idle|running|adding|guest_checkout|reading_email|waiting_email|waiting_payment|done|error|cancelled
        self.status = "idle"
        self.current_shop: str | None = None
        self.current_shop_name: str | None = None
        self.current_index = 0
        self.total_shops = 0
        self.cart_url: str | None = None
        self.page_url: str | None = None
        self.error: str | None = None
        self.hint: str | None = None
        self.payment_links: list[dict] = []
        self.download_links: list[dict] = []
        self.job_started_at: float | None = None
        self._continue = threading.Event()
        self._cancel = threading.Event()
        self._email_url: str | None = None
        self._email_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._page = None
        self.profile = GuestProfile()
        self.imap_auth_code: str = ""

    def _log(self, msg: str) -> None:
        with self.lock:
            self.logs.append(msg)
            if len(self.logs) > 400:
                self.logs = self.logs[-300:]

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "status": self.status,
                "logs": list(self.logs[-80:]),
                "current_shop": self.current_shop,
                "current_shop_name": self.current_shop_name,
                "current_index": self.current_index,
                "total_shops": self.total_shops,
                "cart_url": self.cart_url,
                "page_url": self.page_url,
                "error": self.error,
                "hint": self.hint,
                "guest_mode": self.profile.enabled(),
                "payment_links": list(self.payment_links),
                "download_links": list(self.download_links),
            }

    def continue_payment(self) -> None:
        self._continue.set()

    def submit_email_link(self, url: str) -> None:
        url = (url or "").strip()
        if not url.startswith("http"):
            raise ValueError("请粘贴邮件中的完整完成 URL（以 http 开头）")
        self._email_url = url
        self._email_event.set()

    def cancel(self) -> None:
        self._cancel.set()
        self._continue.set()
        self._email_event.set()

    def start(
        self,
        groups: dict[str, list[Item]],
        headed: bool = True,
        profile: GuestProfile | None = None,
        imap_auth_code: str = "",
    ) -> None:
        if self._thread and self._thread.is_alive():
            raise RuntimeError("已有任务在运行")
        self.profile = profile or GuestProfile()
        self.imap_auth_code = (imap_auth_code or "").strip()
        self._continue.clear()
        self._cancel.clear()
        self._email_event.clear()
        self._email_url = None
        self.error = None
        self.hint = None
        self.payment_links = []
        self.download_links = []
        self.job_started_at = time.time()
        self.status = "running"
        self.logs = []
        self.total_shops = len(groups)
        self._thread = threading.Thread(
            target=self._run, args=(groups, headed), daemon=True
        )
        self._thread.start()

    def _wait_user(self, status: str, hint: str) -> None:
        self.status = status
        self.hint = hint
        self._log(hint)
        self._continue.clear()
        self._continue.wait()

    def _wait_email_link_manual(self) -> str | None:
        self.status = "waiting_email"
        self.hint = (
            f"未能自动读到邮件。请打开邮箱 {self.profile.email}，"
            "复制「注文完了URL」粘贴到页面（或点继续跳过本店）。"
        )
        self._log(self.hint)
        self._email_event.clear()
        self._email_url = None
        self._continue.clear()
        # 任一：粘贴链接 或 点继续跳过
        while not self._cancel.is_set():
            if self._email_event.wait(timeout=0.4):
                return self._email_url
            if self._continue.is_set():
                self._continue.clear()
                return None
        return None

    def _collect_link(
        self,
        shop: str,
        shop_name: str,
        url: str,
        items: list[Item],
    ) -> None:
        with self.lock:
            self.payment_links.append(
                {
                    "shop": shop,
                    "shop_name": shop_name,
                    "url": url,
                    "item_count": len(items),
                    "items": [{"item_id": it.item_id, "title": it.title} for it in items],
                    "index": len(self.payment_links) + 1,
                }
            )
        self._log(f"已收集完成链接 [第{len(self.payment_links)}店] {shop_name}: {url}")
        self._persist_state()

    def _persist_state(self) -> None:
        try:
            path = Path(__file__).resolve().parent / "job_state.json"
            data = {
                "email": self.profile.email,
                "job_started_at": self.job_started_at,
                "payment_links": self.payment_links,
                "download_links": self.download_links,
            }
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    def load_persisted_state(self) -> None:
        try:
            path = Path(__file__).resolve().parent / "job_state.json"
            if not path.exists():
                return
            data = json.loads(path.read_text(encoding="utf-8"))
            self.payment_links = data.get("payment_links") or []
            self.download_links = data.get("download_links") or []
            self.job_started_at = data.get("job_started_at")
            if data.get("email"):
                self.profile.email = data["email"]
        except Exception:
            pass

    def scan_download_mails(self) -> list[dict]:
        """支付后：读邮箱，只提取本批任务对应的订单详情链接。"""
        from mail_imap import (
            MailConfig,
            extract_shop_from_subject,
            list_recent_pictspace_mails,
            match_shop_for_mail,
            pick_order_urls,
        )

        if not self.imap_auth_code:
            raise RuntimeError("未配置邮箱授权码")
        if not self.payment_links:
            raise RuntimeError("还没有店铺下单记录，请先完成自动下单收集")

        cfg = MailConfig(email_addr=self.profile.email, auth_code=self.imap_auth_code)
        # 本批任务开始后（允许 10 分钟时钟偏差）
        after = (self.job_started_at or time.time()) - 600
        need = len(self.payment_links)
        self._log(
            f"开始读取支付完成邮件（任务开始后，目标 {need} 店，邮箱 {self.profile.email}）…"
        )
        mails = list_recent_pictspace_mails(cfg, after_ts=after, limit=120)
        candidates = [m for m in mails if m["kind"] == "payment_done"]
        if not candidates:
            candidates = [
                m
                for m in mails
                if m["kind"] != "temp_order" and pick_order_urls(m.get("urls") or [])
            ]
        candidates.sort(key=lambda m: m.get("ts") or 0, reverse=True)
        self._log(
            f"  邮箱筛选：pictSPACE {len(mails)} 封，支付完成候选 {len(candidates)} 封"
        )

        used_order_urls: set[str] = set()
        results: list[dict] = []
        matched_indexes: set[int] = set()
        pay_urls = {p["url"] for p in self.payment_links}
        unmatched_pool: list[tuple[dict, str]] = []

        for mail in candidates:
            if len(matched_indexes) >= need:
                break
            order_urls = pick_order_urls(mail.get("urls") or [])
            order_urls = [u for u in order_urls if u not in pay_urls and u not in used_order_urls]
            if not order_urls:
                continue
            order_url = order_urls[0]
            subj = mail.get("subject") or ""
            shop_row = match_shop_for_mail(
                mail.get("text") or "",
                self.payment_links,
                subject=subj,
            )
            if not shop_row:
                hint = extract_shop_from_subject(subj) or subj[:36]
                unmatched_pool.append((mail, order_url))
                self._log(f"  暂未匹配「{hint}」→ 先放入候选")
                continue
            if shop_row["index"] in matched_indexes:
                continue

            used_order_urls.add(order_url)
            matched_indexes.add(shop_row["index"])
            results.append(
                {
                    "index": shop_row["index"],
                    "shop": shop_row["shop"],
                    "shop_name": shop_row["shop_name"],
                    "matched": True,
                    "mail_subject": subj,
                    "order_url": order_url,
                    "downloads": [{"title": "订单链接", "url": order_url}],
                    "items": shop_row.get("items") or [],
                }
            )
            self._log(
                f"  匹配到第 {shop_row['index']} 店「{shop_row['shop_name']}」← {order_url}"
            )

        # 单店任务：匹配失败时，取最新一封支付完成邮件（避免完全拿不到）
        if need == 1 and not results and unmatched_pool:
            mail, order_url = unmatched_pool[0]
            row = self.payment_links[0]
            results.append(
                {
                    "index": row.get("index") or 1,
                    "shop": row.get("shop") or "",
                    "shop_name": row.get("shop_name") or "",
                    "matched": True,
                    "mail_subject": mail.get("subject") or "",
                    "order_url": order_url,
                    "downloads": [{"title": "订单链接", "url": order_url}],
                    "items": row.get("items") or [],
                }
            )
            matched_indexes.add(results[0]["index"])
            self._log(
                f"  单店回退：采用最新支付邮件「{(mail.get('subject') or '')[:40]}」"
            )

        results.sort(key=lambda x: x["index"] or 999)
        with self.lock:
            self.download_links = results
        self._persist_state()
        self._log(f"订单链接扫描完成：匹配 {len(matched_indexes)}/{need} 店")
        return results

    def _fetch_email_link(self, exclude: set[str], after_ts: float) -> str | None:
        from mail_imap import MailConfig, poll_completion_url

        if not self.imap_auth_code:
            return None
        cfg = MailConfig(
            email_addr=self.profile.email,
            auth_code=self.imap_auth_code,
        )
        self.status = "reading_email"
        self.hint = f"正在读取邮箱 {self.profile.email} 中的注文完了链接…"
        return poll_completion_url(
            cfg,
            after_ts=after_ts,
            exclude_urls=exclude,
            timeout_sec=180,
            interval_sec=4.0,
            log=self._log,
            should_cancel=lambda: self._cancel.is_set(),
        )

    def _run(self, groups: dict[str, list[Item]], headed: bool) -> None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.status = "error"
            self.error = "未安装 playwright，请先 pip install -r requirements.txt"
            return

        _ensure_browsers_path()
        shops = list(groups.items())
        guest = self.profile.enabled()
        used_urls: set[str] = set()
        self._log(f"开始处理 {len(shops)} 个店铺" + ("（游客自动结算）" if guest else "（仅加购）"))
        if guest:
            if self.imap_auth_code:
                self._log("模式: 仮注文后自动读邮箱收集完成链接 → 不等支付，继续下一店 → 全部收齐后结束。")
            else:
                self._log("未配置 QQ 邮箱授权码：仮注文后需手动粘贴链接。建议在页面填写授权码。")

        try:
            with sync_playwright() as p:
                launch_args = []
                if sys.platform != "win32":
                    launch_args.extend(["--no-sandbox", "--disable-dev-shm-usage"])
                browser = p.chromium.launch(
                    headless=not headed,
                    args=launch_args,
                )
                context = browser.new_context(
                    locale="ja-JP",
                    user_agent=USER_AGENT,
                    viewport={"width": 1280, "height": 900},
                )
                page = context.new_page()
                self._page = page

                for i, (shop, items) in enumerate(shops, 1):
                    if self._cancel.is_set():
                        self.status = "cancelled"
                        self._log("已取消")
                        browser.close()
                        return

                    self.current_index = i
                    self.current_shop = shop
                    self.current_shop_name = items[0].shop_name if items else shop
                    self.status = "adding"
                    self.cart_url = f"{BASE}/orders/cart_check/{shop}"
                    self.page_url = None
                    self._log(f"[{i}/{len(shops)}] 店铺 {self.current_shop_name}：加购 {len(items)} 件")

                    for j, item in enumerate(items, 1):
                        if self._cancel.is_set():
                            self.status = "cancelled"
                            self._log("已取消")
                            browser.close()
                            return
                        self._log(f"  ({j}/{len(items)}) {item.title}")
                        try:
                            add_item_to_cart(page, item)
                        except Exception as e:
                            self._log(f"  ! 加购失败: {e}")
                            page.goto(item.url, wait_until="domcontentloaded")
                            self._wait_user(
                                "waiting_payment",
                                "加购失败，请在弹出浏览器手动加购后点「继续」",
                            )
                            if self._cancel.is_set():
                                self.status = "cancelled"
                                browser.close()
                                return
                            self.status = "adding"

                    if guest:
                        self.status = "guest_checkout"
                        try:
                            after_ts = time.time()
                            url = guest_checkout_to_temp_order(
                                page, shop, self.profile, self._log
                            )
                            self.page_url = url
                            self._log(f"仮注文流程完成，当前页: {url}")
                        except AddressRequiredError as e:
                            self.page_url = page.url
                            self._log(str(e))
                            self._wait_user(
                                "waiting_payment",
                                "检测到需要填写地址，已暂停。请在弹出浏览器处理，完成后点继续。",
                            )
                            if self._cancel.is_set():
                                self.status = "cancelled"
                                browser.close()
                                return
                            continue
                        except Exception as e:
                            self._log(f"游客结算失败: {e}")
                            self.cart_url = f"{BASE}/orders/cart_check/{shop}?no_signup=on"
                            self.page_url = page.url
                            page.goto(self.cart_url, wait_until="domcontentloaded")
                            self._wait_user(
                                "waiting_payment",
                                "游客自动结算失败，请手动处理后点继续",
                            )
                            if self._cancel.is_set():
                                self.status = "cancelled"
                                browser.close()
                                return
                            continue

                        if self.profile.auto_temp_order:
                            link = self._fetch_email_link(used_urls, after_ts)
                            if self._cancel.is_set():
                                self.status = "cancelled"
                                browser.close()
                                return
                            if not link:
                                link = self._wait_email_link_manual()
                                if self._cancel.is_set():
                                    self.status = "cancelled"
                                    browser.close()
                                    return
                            if link:
                                used_urls.add(link)
                                self._collect_link(
                                    shop,
                                    self.current_shop_name or shop,
                                    link,
                                    items,
                                )
                                self.hint = (
                                    f"已收集 {len(self.payment_links)}/{len(shops)} 个链接，"
                                    "继续下一店（不等待支付）…"
                                )
                            else:
                                self._log("本店未拿到完成链接，跳过收集，继续下一店。")
                        # 不等支付，直接下一店
                    else:
                        self._log(f"打开购物车: {self.cart_url}")
                        page.goto(self.cart_url, wait_until="domcontentloaded")
                        _pass_age_gate(page)
                        self._wait_user(
                            "waiting_payment",
                            "未启用游客邮箱模式：请手动结算后点继续。",
                        )

                    if self._cancel.is_set():
                        self.status = "cancelled"
                        self._log("已取消")
                        browser.close()
                        return

                browser.close()
            self._page = None
            self.status = "done"
            self.cart_url = None
            n = len(self.payment_links)
            self.hint = (
                f"全部店铺下单流程结束。共收集 {n} 个完成/支付链接，请在下方列表打开并自行支付。任务已终止。"
            )
            self._log(self.hint)
            for row in self.payment_links:
                self._log(f"  [{row['index']}] {row['shop_name']}: {row['url']}")
        except Exception as e:
            self.status = "error"
            self.error = str(e)
            self._log(f"错误: {e}")
            self._page = None
