"""Fanbox creator post tier statistics."""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import unquote

from fanbox_client import FanboxError, list_creator_plans, list_creator_posts_page


def normalize_creator_id(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""

    if s.startswith("https://") or s.startswith("http://"):
        s = s.split("://", 1)[1] if "://" in s else s
        if s.startswith("www."):
            s = s[4:]
        if "/@" in s:
            part = s.split("/@", 1)[1]
            for sep in ("?", "/"):
                if sep in part:
                    part = part.split(sep, 1)[0]
            return part.strip().lower()
        if ".fanbox.cc" in s:
            return s.split(".fanbox.cc", 1)[0].strip().lower()
        return ""

    if s.startswith("@"):
        s = s[1:]

    return s.strip().lower()


def fetch_posts_by_fee(creator_id: str) -> Counter[int]:
    counter: Counter[int] = Counter()
    seen: set[str] = set()
    first_id: str | None = None
    first_published: str | None = None

    while True:
        page = list_creator_posts_page(
            creator_id,
            first_id=first_id,
            first_published_datetime=first_published,
        )
        if not page:
            break

        for post in page:
            post_id = post.get("id")
            if post_id is not None:
                pid = str(post_id)
                if pid in seen:
                    continue
                seen.add(pid)
            fee = post.get("feeRequired", 0)
            try:
                fee_int = int(fee)
            except (TypeError, ValueError):
                fee_int = 0
            counter[fee_int] += 1

        if len(page) < 100:
            break

        last = page[-1]
        first_id = str(last.get("id", ""))
        first_published = last.get("publishedDatetime")
        if not first_id or not first_published:
            break

    return counter


def analyze_creator(creator_id: str) -> dict[str, Any]:
    t0 = time.perf_counter()

    with ThreadPoolExecutor(max_workers=2) as pool:
        plans_future = pool.submit(list_creator_plans, creator_id)
        counter_future = pool.submit(fetch_posts_by_fee, creator_id)
        plans = plans_future.result()
        counter = counter_future.result()

    plan_by_fee: dict[int, list[dict[str, Any]]] = {}
    for plan in plans:
        fee = plan.get("fee", 0)
        try:
            fee_int = int(fee)
        except (TypeError, ValueError):
            fee_int = 0
        plan_by_fee.setdefault(fee_int, []).append(plan)

    fees = sorted(set(counter.keys()) | set(plan_by_fee.keys()))
    cumulative: list[dict[str, int]] = []
    running = 0
    for fee in fees:
        running += counter.get(fee, 0)
        cumulative.append({"fee": fee, "total_visible": running})

    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    return {
        "creator_id": creator_id,
        "plans": plans,
        "plan_by_fee": plan_by_fee,
        "counter": dict(counter),
        "total": sum(counter.values()),
        "fees": fees,
        "cumulative": cumulative,
        "elapsed_ms": elapsed_ms,
    }


def fee_label(fee: int, plan_by_fee: dict[int, list[dict[str, Any]]]) -> str:
    if fee == 0:
        return "免费公开"
    plans = plan_by_fee.get(fee, [])
    if plans:
        titles = " / ".join(p.get("title", "") for p in plans if p.get("title"))
        return f"¥{fee}/月 — {titles}" if titles else f"¥{fee}/月"
    return f"¥{fee}/月（无对应方案或已下架）"


def to_api_response(
    data: dict[str, Any],
    *,
    cached: bool = False,
    cache_age_sec: int | None = None,
) -> dict[str, Any]:
    creator_id = data["creator_id"]
    plan_by_fee = data["plan_by_fee"]
    counter = data["counter"]
    cumulative_map = {item["fee"]: item["total_visible"] for item in data["cumulative"]}

    plans_sorted = sorted(data["plans"], key=lambda p: int(p.get("fee", 0) or 0))

    tiers = []
    for fee in data["fees"]:
        plans_at_fee = plan_by_fee.get(fee, [])
        plan_title = plans_at_fee[0].get("title") if plans_at_fee else None
        tiers.append(
            {
                "fee": fee,
                "label": fee_label(fee, plan_by_fee),
                "plan_title": plan_title,
                "exclusive_count": counter.get(fee, 0),
                "cumulative_visible": cumulative_map.get(fee, 0),
            }
        )

    result: dict[str, Any] = {
        "creator_id": creator_id,
        "url": f"https://www.fanbox.cc/@{creator_id}",
        "total": data["total"],
        "plan_count": len(data["plans"]),
        "plans": [
            {
                "fee": int(p.get("fee", 0) or 0),
                "title": p.get("title", ""),
                "description": p.get("description", ""),
            }
            for p in plans_sorted
        ],
        "tiers": tiers,
        "elapsed_ms": data["elapsed_ms"],
        "cached": cached,
    }
    if cache_age_sec is not None:
        result["cache_age_sec"] = cache_age_sec
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fanbox creator tier statistics")
    parser.add_argument("creator", help="Creator ID, @id, or Fanbox URL")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args(argv)

    creator_id = normalize_creator_id(unquote(args.creator))
    if not creator_id:
        print("请提供有效的创作者 ID 或链接", file=sys.stderr)
        return 1

    try:
        raw = analyze_creator(creator_id)
        response = to_api_response(raw)
    except FanboxError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.json:
        out = json.dumps(response, ensure_ascii=False, indent=2) + "\n"
        sys.stdout.buffer.write(out.encode("utf-8"))
    else:
        print(f"@{response['creator_id']} — 共 {response['total']} 篇")
        for tier in response["tiers"]:
            print(
                f"  {tier['label']}: 专属 {tier['exclusive_count']}, "
                f"累计可见 {tier['cumulative_visible']}"
            )
        print(f"耗时 {response['elapsed_ms']} ms")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
