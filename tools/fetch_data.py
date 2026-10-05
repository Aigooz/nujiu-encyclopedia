#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch Nujiu accounts and build the source registry, metadata, tags and subtitles."""

from __future__ import annotations

import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
SUB_DIR = ROOT / "subtitles"
sys.path.insert(0, str(TOOLS))
sys.stdout.reconfigure(encoding="utf-8")

import bili_api
from classify_videos import classify

TZ = timezone(timedelta(hours=8))
ACCOUNTS = [
    {"mid": "14751040", "label": "主号（怒九笑）", "short": "主号"},
    {"mid": "693485501", "label": "小号（怒九摸鱼馆）", "short": "小号"},
]
OUT_REGISTRY = ROOT / "registry.json"
OUT_META = TOOLS / "bili_meta_cache.json"
OUT_TAGS = TOOLS / "bili_tags_cache.json"
OUT_PROFILES = TOOLS / "up_profiles.json"
OUT_STATS = TOOLS / "account_stats.json"

tag_cache = {}
if OUT_TAGS.exists():
    try:
        tag_cache = json.loads(OUT_TAGS.read_text(encoding="utf-8"))
    except Exception:
        tag_cache = {}

tag_lock = threading.Lock()


def iso_date(ts):
    return datetime.fromtimestamp(int(ts), TZ).strftime("%Y-%m-%d")


def iso_minutes(ts):
    return datetime.fromtimestamp(int(ts), TZ).strftime("%Y-%m-%d %H:%M")


def fetch_profile(account):
    data = bili_api._get("https://api.bilibili.com/x/web-interface/card", {"mid": account["mid"]})
    if data.get("code") != 0:
        raise RuntimeError(data.get("message") or "profile API failed")
    card = data.get("data", {}).get("card", {})
    level = (card.get("level_info") or {}).get("current_level")
    return {
        "mid": account["mid"],
        "name": card.get("name") or "",
        "sign": card.get("sign") or "",
        "avatar": card.get("face") or "",
        "fans": card.get("fans") or 0,
        "like_num": data.get("data", {}).get("like_num") or card.get("like_num") or 0,
        "level": level or 0,
        "official": (card.get("official_verify") or {}).get("desc") or "",
        "archive_count": data.get("data", {}).get("archive_count") or 0,
    }


def fetch_tags_for(bvid: str):
    with tag_lock:
        if bvid in tag_cache:
            return tag_cache[bvid]
    obj = bili_api._get("https://api.bilibili.com/x/tag/archive/tags", {"bvid": bvid})
    rows = []
    if obj.get("code") == 0:
        for x in obj.get("data") or []:
            if x.get("tag_name"):
                rows.append({"id": x.get("tag_id"), "name": x.get("tag_name")})
    with tag_lock:
        tag_cache[bvid] = rows
    return rows


def fetch_video(account, raw):
    bvid = raw["bvid"]
    view = bili_api._get("https://api.bilibili.com/x/web-interface/view", {"bvid": bvid})
    if view.get("code") != 0:
        raise RuntimeError(view.get("message") or "view API failed")
    info = view["data"]
    lines = []
    page_errors = []
    for page in info.get("pages") or []:
        cid = page.get("cid")
        if not cid:
            continue
        try:
            lines.extend(bili_api.get_subtitle_lines(bvid, cid))
            time.sleep(0.08)
        except Exception as exc:
            page_errors.append(repr(exc))
    tags = fetch_tags_for(bvid)
    payload = {
        "bvid": bvid,
        "title": info["title"],
        "desc": info.get("desc", ""),
        "pubdate": info["pubdate"],
        "owner_mid": info.get("owner_mid"),
        "owner_name": info.get("owner_name"),
        "lines": lines,
        "pages": info.get("pages", []),
    }
    (SUB_DIR / f"{bvid}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    meta = {
        **info,
        "date": iso_date(info["pubdate"]),
        "pubdate_iso": iso_minutes(info["pubdate"]),
    }
    row = {
        "bvid": bvid,
        "aid": info.get("aid"),
        "title": info["title"],
        "date": iso_date(info["pubdate"]),
        "pubdate_iso": iso_minutes(info["pubdate"]),
        "type": classify(info.get("title", ""), info.get("desc", ""), tags, info.get("tid")),
        "account": account["label"],
        "account_short": account["short"],
        "intro_count": 0,
        "sub_lines": len(lines),
        "sub_chars": sum(len(x) for x in lines),
        "source": "B站用户视频列表 + B站视频详情",
        "duration": info.get("duration") or 0,
        "tname": info.get("tname"),
        "desc": info.get("desc", ""),
        "pic": info.get("pic"),
        "pages": info.get("pages", []),
        "tags": [x["name"] for x in tags],
        "subtitle_errors": page_errors,
    }
    return bvid, meta, row, len(lines)


def main():
    SUB_DIR.mkdir(parents=True, exist_ok=True)
    profiles = {}
    all_rows = []
    all_meta = {}
    for account in ACCOUNTS:
        print(f"Fetching profile {account['mid']}...", flush=True)
        profiles[account["label"]] = fetch_profile(account)
        vids = bili_api.get_user_videos_free(account["mid"], ps=30, max_pages=20)
        print(f"  videos: {len(vids)}", flush=True)
        if len(vids) != profiles[account["label"]]["archive_count"]:
            print(
                f"  warning: profile archive_count="
                f"{profiles[account['label']]['archive_count']}, API list={len(vids)}"
            )
        done = 0
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(fetch_video, account, raw) for raw in vids]
            for future in as_completed(futures):
                try:
                    bvid, meta, row, sub_lines = future.result()
                    all_rows.append(row)
                    all_meta[bvid] = meta
                    done += 1
                    if done % 20 == 0 or done == len(vids):
                        print(
                            f"  {account['short']} {done}/{len(vids)} | subtitles {sub_lines} lines",
                            flush=True,
                        )
                except Exception as exc:
                    print(f"  FAILED: {exc}", flush=True)
        time.sleep(0.5)

    all_rows.sort(key=lambda x: (x["date"], x["pubdate_iso"], x["bvid"]))
    for i, row in enumerate(all_rows, 1):
        row["no"] = i
        lines_payload = json.loads((SUB_DIR / f"{row['bvid']}.json").read_text(encoding="utf-8"))
        if lines_payload.get("lines"):
            from analyze import analyze
            analysis = analyze(row["title"], lines_payload["lines"], row.get("desc", ""))
            row["analysis"] = analysis
            row["intro_count"] = analysis.get("intro_count", 0)
            row["gap_note"] = None
            row["gap_days"] = None

    # calculate per-account gap, then global no.
    last_date = {}
    for row in all_rows:
        account = row["account"]
        prev = last_date.get(account)
        if prev:
            d0 = datetime.strptime(prev, "%Y-%m-%d")
            d1 = datetime.strptime(row["date"], "%Y-%m-%d")
            gap = (d1 - d0).days
            row["gap_days"] = gap
            row["gap_note"] = f"{gap} 天" if gap >= 0 else f"回补（早于上一部 {abs(gap)} 天）"
        else:
            row["gap_days"] = None
            row["gap_note"] = "首期投稿"
        last_date[account] = row["date"]

    snapshot = {
        "fetched_at": datetime.now(TZ).isoformat(timespec="seconds"),
        "accounts": {name: {"fans": p["fans"], "likes": p["like_num"]} for name, p in profiles.items()},
    }
    OUT_META.write_text(json.dumps(all_meta, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_TAGS.write_text(json.dumps(tag_cache, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_PROFILES.write_text(json.dumps(profiles, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_STATS.write_text(json.dumps({"snapshots": [snapshot]}, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_REGISTRY.write_text(
        json.dumps(
            {
                "docx_version": "v1",
                "total_sub_lines": sum(x["sub_lines"] for x in all_rows),
                "generated_at": datetime.now(TZ).isoformat(timespec="seconds"),
                "videos": all_rows,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(
        f"DONE videos={len(all_rows)} sub_lines={sum(x['sub_lines'] for x in all_rows):,} "
        f"with_subs={sum(x['sub_lines'] > 0 for x in all_rows)}",
        flush=True,
    )


if __name__ == "__main__":
    main()
