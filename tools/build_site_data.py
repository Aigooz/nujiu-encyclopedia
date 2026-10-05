#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding="utf-8")


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def main() -> None:
    reg = read_json(ROOT / "registry.json", {"videos": [], "total_sub_lines": 0})
    meta = read_json(ROOT / "tools" / "bili_meta_cache.json", {})
    tags_cache = read_json(ROOT / "tools" / "bili_tags_cache.json", {})
    comments_cache = read_json(ROOT / "tools" / "bili_comments_cache.json", {})
    insights = read_json(ROOT / "tools" / "danmaku_insights.json", {})
    profiles = read_json(ROOT / "tools" / "up_profiles.json", {})
    profiles = {
        key: {**value, "face": value.get("face") or value.get("avatar") or ""}
        for key, value in profiles.items()
    }
    account_stats = read_json(ROOT / "tools" / "account_stats.json", {})
    insight_videos = insights.get("videos") or {}

    followers = {}
    for key, value in (account_stats.get("snapshots") or [{}])[-1].get("accounts", {}).items():
        profile = profiles.get(key) or {}
        followers[str(profile.get("mid") or key)] = {
            "name": profile.get("name") or key,
            "follower": value.get("fans") or profile.get("fans") or 0,
            "mid": profile.get("mid"),
        }

    videos = []
    for row in reg["videos"]:
        bvid = row["bvid"]
        info = meta.get(bvid) or {}
        stat = info.get("stat") or {}
        pubdate = info.get("pubdate")
        pub_dt = None
        if pubdate:
            try:
                pub_dt = datetime.fromtimestamp(int(pubdate), ZoneInfo("Asia/Shanghai"))
            except Exception:
                pub_dt = None
        ins = insight_videos.get(bvid) or {}
        comments = (comments_cache.get(bvid) or {}).get("comments") or []
        videos.append({
            "no": row.get("no"),
            "title": row.get("title"),
            "date": row.get("date"),
            "pubdate_iso": pub_dt.strftime("%Y-%m-%d %H:%M") if pub_dt else row.get("pubdate_iso"),
            "type": row.get("type"),
            "account": row.get("account"),
            "account_short": row.get("account_short"),
            "table_source": row.get("source") or "B站用户视频列表",
            "intro_count": row.get("intro_count", 0),
            "sub_lines": row.get("sub_lines", 0),
            "sub_chars": row.get("sub_chars", 0),
            "bvid": bvid,
            "aid": row.get("aid") or info.get("aid"),
            "duration": row.get("duration") or info.get("duration") or 0,
            "tname": row.get("tname") or info.get("tname") or None,
            "tags": tags_cache.get(bvid) or row.get("tags") or [],
            "pic": row.get("pic") or info.get("pic"),
            "desc": (row.get("desc") or info.get("desc") or "")[:300],
            "summary": (row.get("analysis") or {}).get("summary"),
            "topics": (row.get("analysis") or {}).get("topic_str"),
            "catchphrases": (row.get("analysis") or {}).get("catch_str"),
            "atmosphere": (row.get("analysis") or {}).get("atmo"),
            "language": (row.get("analysis") or {}).get("lang"),
            "merged": (row.get("analysis") or {}).get("merged") or [],
            "view": stat.get("view", 0),
            "danmaku": stat.get("danmaku", 0),
            "reply": stat.get("reply", 0),
            "like": stat.get("like", 0),
            "coin": stat.get("coin", 0),
            "favorite": stat.get("favorite", 0),
            "share": stat.get("share", 0),
            "peaks": ins.get("peaks") or [],
            "dm_profile": ins.get("profile") or [],
            "memes": ins.get("top_phrases") or [],
            "comments": comments,
            "honors": [
                {"type": h.get("type"), "desc": h.get("desc", "")}
                for h in ((info.get("honor_reply") or {}).get("honor") or [])
            ],
        })

    videos.sort(key=lambda x: (x.get("date") or "", x.get("bvid") or ""))
    for index, video in enumerate(videos, 1):
        video["no"] = index

    table_last_date = {}
    for video in videos:
        account = video.get("account") or "未分类"
        last_date = table_last_date.get(account)
        if last_date:
            gap_days = (datetime.strptime(video["date"], "%Y-%m-%d") - datetime.strptime(last_date, "%Y-%m-%d")).days
            video["gap_days"] = gap_days
            video["gap_band"] = "≤7天" if gap_days <= 7 else "≤30天" if gap_days <= 30 else "≤90天" if gap_days <= 90 else ">90天"
        else:
            video["gap_days"] = None
            video["gap_band"] = None
        table_last_date[account] = video["date"]

    gaps = [v["gap_days"] for v in videos if isinstance(v.get("gap_days"), int)]
    account_summary = []
    for account in ["主号（怒九笑）", "小号（怒九摸鱼馆）"]:
        rows = [v for v in videos if v.get("account") == account]
        account_gaps = [v["gap_days"] for v in rows if isinstance(v.get("gap_days"), int)]
        account_summary.append({
            "account": account,
            "record_count": len(rows),
            "first_date": rows[0].get("date") if rows else None,
            "last_date": rows[-1].get("date") if rows else None,
            "max_gap_days": max(account_gaps) if account_gaps else None,
            "avg_gap_days": round(sum(account_gaps) / len(account_gaps), 1) if account_gaps else None,
        })

    sync_fields = ["title", "bvid", "aid", "date", "type", "duration", "table_source"]
    field_checks = sum(sum(bool(v.get(field)) for field in sync_fields) for v in videos)
    table_sync = {
        "sources": ["@怒九笑 相关.xlsx", "@怒九摸鱼馆 相关.xlsx"],
        "generated_at": datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M"),
        "record_count": len(videos),
        "field_completeness": round(field_checks / max(1, len(videos) * len(sync_fields)), 4),
        "max_gap_days": max(gaps) if gaps else None,
        "avg_gap_days": round(sum(gaps) / len(gaps), 1) if gaps else None,
        "accounts": account_summary,
    }

    global_memes = Counter()
    for item in insight_videos.values():
        for phrase in item.get("top_phrases") or []:
            global_memes[phrase["content"]] += phrase["count"]

    yearly = Counter(v["date"][:4] for v in videos)
    type_counts = Counter(v["type"] for v in videos)
    account_counts = Counter(v["account"] for v in videos)
    tag_counts = Counter(tag.get("name") if isinstance(tag, dict) else tag for v in videos for tag in v["tags"])
    payload = {
        "docx_version": f"{reg.get('docx_version') or 'v1'}-{datetime.now().strftime('%Y%m%d')}",
        "table_sync": table_sync,
        "total_sub_lines": sum(v.get("sub_lines") or 0 for v in videos),
        "total_view": sum(v.get("view") or 0 for v in videos),
        "total_like": sum(v.get("like") or 0 for v in videos),
        "total_danmaku": sum(v.get("danmaku") or 0 for v in videos),
        "total_coin": sum(v.get("coin") or 0 for v in videos),
        "total_reply": sum(v.get("reply") or 0 for v in videos),
        "total_favorite": sum(v.get("favorite") or 0 for v in videos),
        "total_share": sum(v.get("share") or 0 for v in videos),
        "total_duration": sum(v.get("duration") or 0 for v in videos),
        "yearly_danmaku": insights.get("yearly") or {},
        "top_memes": [{"content": key, "count": count} for key, count in global_memes.most_common(40)],
        "insights_generated_at": insights.get("generated_at"),
        "comments_fetched": len(comments_cache),
        "followers": followers,
        "profiles": profiles,
        "stats": {
            "videos": len(videos),
            "with_subtitles": sum(v["sub_lines"] > 0 for v in videos),
            "sub_lines": reg.get("total_sub_lines", 0),
            "danmaku_records": insights.get("total_records", 0),
            "view": sum(v["view"] for v in videos),
            "like": sum(v["like"] for v in videos),
            "danmaku": sum(v["danmaku"] for v in videos),
            "reply": sum(v["reply"] for v in videos),
            "coin": sum(v["coin"] for v in videos),
            "favorite": sum(v["favorite"] for v in videos),
            "share": sum(v["share"] for v in videos),
            "yearly": dict(sorted(yearly.items())),
            "types": dict(type_counts),
            "accounts": dict(account_counts),
            "tags": dict(tag_counts.most_common(60)),
        },
        "videos": videos,
    }

    out = ROOT / "site" / "data.js"
    out.write_text("const RAW = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"site data: {len(videos)} videos, {out.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
