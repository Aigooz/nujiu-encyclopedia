# -*- coding: utf-8 -*-
"""把微博缓存整理成站点/App 可用的 weibo 数据块。

输入：tools/weibo_nujiu_cache.json
输出：site/data-weibo.js
"""
from __future__ import annotations

import html
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {"nujiu": ROOT / "tools" / "weibo_nujiu_cache.json"}
OUT = ROOT / "site" / "data-weibo.js"

IMAGE_TAG = re.compile(r'<img[^>]*alt="([^"]*)"[^>]*>', re.I)
TAG = re.compile(r"<[^>]+>")
LINK = re.compile(r'<a[^>]*>(.*?)</a>', re.I | re.S)


def clean_text(raw: str) -> str:
    if not raw:
        return ""

    def emoji(match):
        name = match.group(1).strip()
        return name if name.startswith("[") else "[%s]" % name

    text = IMAGE_TAG.sub(emoji, raw)
    text = LINK.sub(lambda m: m.group(1), text)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = TAG.sub("", text)
    text = html.unescape(text).replace("\u200b", "")
    text = text.replace("...全文", "").replace("收起", "")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_created(value: str) -> str:
    try:
        return datetime.strptime(value, "%a %b %d %H:%M:%S %z %Y").strftime("%Y-%m-%d %H:%M")
    except Exception:
        return value or ""


def main() -> None:
    payload = {}
    for key, path in SOURCES.items():
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        posts = []
        for item in data.get("posts") or []:
            text = clean_text(item.get("text", ""))
            if not text:
                continue
            posts.append({
                "id": str(item.get("id") or ""),
                "date": parse_created(item.get("created_at", "")),
                "text": text,
                "reposts": item.get("reposts") or 0,
                "comments": item.get("comments") or 0,
                "likes": item.get("attitudes") or 0,
                "region": item.get("region") or "",
                "pics": item.get("pics") or [],
                "url": "https://m.weibo.cn/status/%s" % item.get("bid", ""),
            })
        posts.sort(key=lambda p: p["date"], reverse=True)
        payload[key] = {"uid": data.get("uid"), "fetched_at": data.get("fetched_at"),
                        "count": len(posts), "posts": posts}
    OUT.write_text("const WEIBO = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    for key, value in payload.items():
        print("%s: %d 条微博 -> %s" % (key, value["count"], OUT.name))


if __name__ == "__main__":
    main()
