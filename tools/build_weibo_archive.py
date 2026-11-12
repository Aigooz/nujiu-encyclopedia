# -*- coding: utf-8 -*-
"""把微博抓取结果合并进永久归档（tools/weibo_archive.json）。

归档是"只增不减"的：微博即使过了半年可见期、从线上消失，只要曾经抓过，
就会一直留在仓库里并被 App 内置。合并以微博 id 为键，新数据覆盖旧字段，
从未见过的条目追加。

用法：
  python tools/build_weibo_archive.py                    # 合并 tools/weibo_*_cache.json
  python tools/build_weibo_archive.py --status           # 只报告归档现状
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "tools" / "weibo_archive.json"
CACHE = {
    "nujiu": ROOT / "tools" / "weibo_nujiu_cache.json",
}
TZ = timezone(timedelta(hours=8))


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()

    archive = read_json(ARCHIVE, {"updated_at": "", "accounts": {}})
    accounts = archive.setdefault("accounts", {})

    if args.status:
        for key, acc in accounts.items():
            posts = acc.get("posts") or []
            comments = sum(len(p.get("comments_data") or []) for p in posts)
            print("%s：%d 条微博，%d 条顶层评论，区间 %s ~ %s" % (
                acc.get("name") or key, len(posts), comments,
                min((p.get("date") or "") for p in posts) if posts else "-",
                max((p.get("date") or "") for p in posts) if posts else "-"))
        return

    for key, path in CACHE.items():
        data = read_json(path, None)
        if not data or not data.get("posts"):
            print("%s：无缓存，跳过" % key)
            continue
        target = accounts.setdefault(key, {
            "uid": data.get("uid") or "", "name": data.get("name") or "",
            "first_seen": datetime.now(TZ).isoformat(timespec="seconds"),
            "posts": [],
        })
        target["uid"] = data.get("uid") or target.get("uid") or ""
        target["name"] = data.get("name") or target.get("name") or ""
        target["last_sync"] = data.get("fetched_at") or ""
        by_id = {str(p.get("id")): p for p in target.get("posts") or []}
        added = updated = 0
        for post in data["posts"]:
            pid = str(post.get("id") or "")
            if not pid:
                continue
            if pid in by_id:
                old = by_id[pid]
                # 保留已有评论；新数据里带评论时才覆盖，避免把归档里的评论洗掉。
                incoming_comments = post.get("comments_data")
                if not incoming_comments and old.get("comments_data"):
                    post = {**post, "comments_data": old["comments_data"]}
                if old.get("first_seen"):
                    post["first_seen"] = old["first_seen"]
                else:
                    post["first_seen"] = datetime.now(TZ).isoformat(timespec="seconds")
                updated += 1
            else:
                post["first_seen"] = datetime.now(TZ).isoformat(timespec="seconds")
                added += 1
            by_id[pid] = post
        target["posts"] = sorted(by_id.values(), key=lambda p: p.get("date") or "", reverse=True)
        print("%s：归档 %d 条（新增 %d，更新 %d）" % (
            target["name"] or key, len(target["posts"]), added, updated))

    archive["updated_at"] = datetime.now(TZ).isoformat(timespec="seconds")
    ARCHIVE.write_text(json.dumps(archive, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(len(a.get("posts") or []) for a in accounts.values())
    print("已写入 %s：累计 %d 条微博" % (ARCHIVE.name, total))


if __name__ == "__main__":
    main()
