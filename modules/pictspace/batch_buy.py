#!/usr/bin/env python3
"""pictSPACE 跨店铺批量购买助手（命令行）。网页版请运行: python web_app.py"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from core import analyze, groups_to_json, normalize_urls
from core import BatchJob


def _configure_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def load_urls(path: Path) -> list[str]:
    if not path.exists():
        raise SystemExit(f"找不到链接文件: {path}")
    return normalize_urls(path.read_text(encoding="utf-8"))


def print_plan(groups) -> None:
    payload = groups_to_json(groups)
    if not payload:
        print("没有可处理的商品。")
        return
    print("\n========== 按店铺分组（每店需单独结算） ==========")
    total = 0
    for g in payload:
        print(f"\n【第 {g['index']} 单】店铺: {g['shop_name']} ({g['shop']}) — {g['count']} 件")
        for it in g["items"]:
            print(f"  - [{it['item_id']}] {it['title']}  {it['price']}  ({it['kind']})")
            print(f"    {it['url']}")
        total += g["count"]
    print(f"\n合计 {total} 件商品，需完成 {len(payload)} 次支付。")


def main(argv: list[str] | None = None) -> int:
    _configure_stdout()
    parser = argparse.ArgumentParser(description="pictSPACE 跨店铺批量购买助手")
    parser.add_argument("-f", "--file", default="urls.txt")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--headed", dest="headed", action="store_true", default=True)
    parser.add_argument("--headless", dest="headed", action="store_false")
    args = parser.parse_args(argv)

    urls_path = Path(args.file)
    if not urls_path.is_absolute():
        urls_path = Path.cwd() / urls_path

    urls = load_urls(urls_path)
    if not urls:
        print(f"请在 {urls_path} 中写入商品链接（每行一个）。")
        print("或启动网页版: python web_app.py")
        return 1

    print(f"读取到 {len(urls)} 个商品链接，开始解析…\n")
    groups, errors = analyze(urls, on_progress=lambda i, t, m: print(f"[{i}/{t}] {m}"))
    for e in errors:
        print(f"  ! 失败 {e['url']}: {e['error']}")
    print_plan(groups)

    if not groups:
        return 1

    if args.run:
        job = BatchJob()
        job.start(groups, headed=args.headed)
        while True:
            snap = job.snapshot()
            for line in snap["logs"][len(getattr(main, "_shown", 0)) :]:
                print(line)
            main._shown = len(snap["logs"])  # type: ignore[attr-defined]
            if snap["status"] == "waiting_payment":
                input("本店支付完成后按 Enter 继续… ")
                job.continue_payment()
            elif snap["status"] in {"done", "error", "cancelled"}:
                if snap["error"]:
                    print(snap["error"])
                break
            import time

            time.sleep(0.4)
    else:
        print("\n网页版: python web_app.py  →  http://127.0.0.1:8765")
        print(f"命令行: python batch_buy.py --run -f {args.file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
