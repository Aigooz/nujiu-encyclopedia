# -*- coding: utf-8 -*-
"""把微博永久归档整理成站点/App 可用的 weibo 数据块。

输入：tools/weibo_archive.json（由 tools/build_weibo_archive.py 维护）
输出：site/data-weibo.js（同时被 data.js 的构建脚本引用，并打包进 App）

归档是"只增不减"的：微博过了半年可见期后线上会消失，但归档仍保留，
因此 App 里的微博不会丢。数据块同时携带评论区（顶层评论 + 楼中楼），
让 App 能在本地完整浏览。
"""
from __future__ import annotations

import html
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ARCHIVE = ROOT / "tools" / "weibo_archive.json"
OUT = ROOT / "site" / "data-weibo.js"

IMAGE_TAG = re.compile(r'<img[^>]*alt="([^"]*)"[^>]*>', re.I)
TAG = re.compile(r"<[^>]+>")
LINK = re.compile(r'<a[^>]*>(.*?)</a>', re.I | re.S)


def clean_text(raw: str) -> str:
    if not raw:
        return ""
    # 表情的 alt 通常已经自带方括号（如 [馋嘴]），只有缺括号时才补。
    def emoji(match):
        name = match.group(1).strip()
        return name if name.startswith("[") else "[%s]" % name

    text = IMAGE_TAG.sub(emoji, raw)
    text = LINK.sub(lambda m: m.group(1), text)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = TAG.sub("", text)
    text = html.unescape(text)
    text = text.replace("\u200b", "")
    text = text.replace("...全文", "").replace("收起", "")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_created(value: str) -> str:
    """微博返回形如 `Tue Nov 10 21:39:48 +0800 2026`。"""
    try:
        return datetime.strptime(value, "%a %b %d %H:%M:%S %z %Y").strftime("%Y-%m-%d %H:%M")
    except Exception:
        return value or ""


def main() -> None:
    archive = json.loads(ARCHIVE.read_text(encoding="utf-8")) if ARCHIVE.exists() else {}
    payload = {}
    for key, account in (archive.get("accounts") or {}).items():
        posts = []
        for item in account.get("posts") or []:
            text = clean_text(item.get("text", ""))
            if not text:
                continue
            comments = []
            for comment in item.get("comments_data") or []:
                comments.append({
                    "user": comment.get("user") or "",
                    "avatar": comment.get("avatar") or "",
                    "date": comment.get("date") or "",
                    "text": clean_text(comment.get("text") or ""),
                    "likes": comment.get("likes") or 0,
                    "region": comment.get("region") or "",
                    "is_author": bool(comment.get("is_author")),
                    "replies": [{
                        "user": reply.get("user") or "",
                        "date": reply.get("date") or "",
                        "text": clean_text(reply.get("text") or ""),
                        "likes": reply.get("likes") or 0,
                        "is_author": bool(reply.get("is_author")),
                    } for reply in (comment.get("replies") or [])],
                })
            posts.append({
                "id": str(item.get("id") or ""),
                "date": item.get("date") or parse_created(item.get("created_at", "")),
                "text": text,
                "reposts": item.get("reposts") or 0,
                "comments": item.get("comments") or 0,
                "likes": item.get("likes") or item.get("attitudes") or 0,
                "region": item.get("region") or "",
                "pics": item.get("pics") or [],
                "url": item.get("url") or "https://m.weibo.cn/status/%s" % (item.get("bid") or ""),
                "comments_data": comments,
            })
        posts.sort(key=lambda p: p["date"], reverse=True)
        payload[key] = {
            "uid": account.get("uid"),
            "name": account.get("name") or key,
            "avatar": account.get("avatar") or "",
            "fetched_at": account.get("last_sync") or archive.get("updated_at") or "",
            "complete": False,
            "count": len(posts),
            "posts": posts,
        }
    OUT.write_text("const WEIBO = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    for key, value in payload.items():
        comment_total = sum(len(p.get("comments_data") or []) for p in value["posts"])
        print("%s: %d 条微博 · %d 条顶层评论 -> %s"
              % (key, value["count"], comment_total, OUT.name))


if __name__ == "__main__":
    main()
