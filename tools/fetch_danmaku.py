#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取 @怒九笑 主号和 @怒九摸鱼馆 小号全部视频弹幕。

用法：
    python tools/fetch_danmaku.py --limit 3 --workers 1      # 小样本验证
    python tools/fetch_danmaku.py                            # 全量抓取并汇总
    python tools/fetch_danmaku.py --aggregate-only            # 只重新汇总
    python tools/fetch_danmaku.py --clean-invalid --aggregate-only

输出：
    danmaku/raw/{bvid}.p{page}.json   每个分P的原始合并结果
    danmaku/all_danmaku.jsonl         全部弹幕，一行一条
    danmaku/all_danmaku.csv           全部弹幕，便于 Excel 查看
    danmaku/summary.json              抓取统计
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import random
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from bilibili_api import DanmakuClosedException, ResponseCodeException, video


ROOT = Path(__file__).resolve().parents[1]
REGISTRY_FILE = ROOT / "registry.json"
CACHE_FILE = ROOT / "tools" / "bili_meta_cache.json"
OUT_DIR = ROOT / "danmaku"
RAW_DIR = OUT_DIR / "raw"
JSONL_FILE = OUT_DIR / "all_danmaku.jsonl"
CSV_FILE = OUT_DIR / "all_danmaku.csv"
SUMMARY_FILE = OUT_DIR / "summary.json"
PER_VIDEO_FILE = OUT_DIR / "per_video_summary.csv"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
TZ = ZoneInfo("Asia/Shanghai")


def now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def load_json(path: Path, default=None):
    try:
        with path.open("r", encoding="utf-8") as fp:
            return json.load(fp)
    except FileNotFoundError:
        return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)
    tmp.replace(path)


def account_label(value: str) -> str:
    # 怒九摸鱼馆是联合投稿相关账号，不作为独立账号维度。
    return "小号" if "小号" in value else "主号"


def normalize_color(value) -> int:
    try:
        if value is None or value == "":
            return 0xFFFFFF
        if isinstance(value, int):
            return value
        text = str(value).strip()
        if text.startswith("#"):
            return int(text[1:], 16)
        if all(c in "0123456789abcdefABCDEF" for c in text) and len(text) <= 8:
            return int(text, 16)
        return int(text, 10)
    except Exception:
        return 0xFFFFFF


def xml_to_record(fields: list[str], content: str) -> dict:
    while len(fields) < 8:
        fields.append("")
    return {
        "id": fields[7],
        "progress": round(float(fields[0] or 0), 3),
        "mode": int(fields[1] or 1),
        "font_size": int(fields[2] or 25),
        "color": normalize_color(fields[3]),
        "send_time": int(float(fields[4] or 0)),
        "pool": int(fields[5] or 0),
        "crc32_id": fields[6],
        "weight": 0,
        "action": 0,
        "attr": 0,
        "content": content,
        "source": ["xml"],
    }


def bilibili_danmaku_to_record(dm) -> dict | None:
    record_id = str(dm.id_str or dm.id_ or "")
    if record_id in {"-1", "lb.c"}:
        return None
    return {
        "id": record_id,
        "progress": round(float(dm.dm_time or 0), 3),
        "mode": int(dm.mode or 1),
        "font_size": int(dm.font_size or 25),
        "color": normalize_color(dm.color),
        "send_time": int(float(dm.send_time or 0)),
        "pool": int(dm.pool or 0),
        "crc32_id": dm.crc32_id or "",
        "weight": int(dm.weight or 0),
        "action": int(dm.action or 0) if str(dm.action or 0).isdigit() else 0,
        "attr": int(dm.attr or 0),
        "content": dm.text or "",
        "source": ["seg"],
    }


def clean_invalid_cache() -> dict:
    removed = 0
    pages = 0
    for path in RAW_DIR.glob("*.p*.json"):
        data = load_json(path)
        if not isinstance(data, dict):
            continue
        pages += 1
        original = data.get("danmaku", [])
        kept = [
            rec for rec in original
            if not (rec.get("source") == ["seg"] and rec.get("id") in {"-1", "lb.c"})
        ]
        removed_here = len(original) - len(kept)
        removed += removed_here
        if removed_here and isinstance(data.get("source_counts"), dict):
            source_counts = data["source_counts"]
            source_counts["seg"] = max(0, int(source_counts.get("seg") or 0) - removed_here)
        data["danmaku"] = kept
        data["version"] = 3
        save_json(path, data)
    return {"pages": pages, "removed": removed}


def merge_records(records: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for rec in records:
        key = rec.get("id")
        if not key:
            continue
        old = merged.get(key)
        if old is None:
            merged[key] = rec
            continue
        sources = list(dict.fromkeys(old.get("source", []) + rec.get("source", [])))
        for field in ("weight", "action", "attr", "crc32_id", "content"):
            if not old.get(field) and rec.get(field):
                old[field] = rec[field]
        old["source"] = sources
        old["progress"] = old.get("progress") or rec.get("progress")
        old["send_time"] = old.get("send_time") or rec.get("send_time")
        old["mode"] = old.get("mode") or rec.get("mode")
        old["font_size"] = old.get("font_size") or rec.get("font_size")
        old["color"] = old.get("color") or rec.get("color")
    return list(merged.values())


def parse_xml_danmaku(xml_bytes: bytes) -> list[dict]:
    import xml.etree.ElementTree as ET

    root = ET.fromstring(xml_bytes)
    records = []
    for node in root.findall("./d"):
        raw_p = node.attrib.get("p", "")
        fields = raw_p.split(",")
        try:
            records.append(xml_to_record(fields, node.text or ""))
        except Exception:
            continue
    return records


async def fetch_page(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    page_info: dict,
    video_info: dict,
) -> dict:
    async with sem:
        bvid = video_info["bvid"]
        aid = int(video_info["aid"])
        cid = int(page_info["cid"])
        page_no = int(page_info["page"])
        out_file = RAW_DIR / f"{bvid}.p{page_no:03d}.json"
        if out_file.exists():
            old = load_json(out_file)
            if isinstance(old, dict) and old.get("version") == 3:
                return {
                    "bvid": bvid,
                    "page": page_no,
                    "cached": True,
                    "danmaku": len(old.get("danmaku", [])),
                    "sources": old.get("source_counts", {}),
                }

        headers = {
            "User-Agent": UA,
            "Referer": f"https://www.bilibili.com/video/{bvid}/",
            "Origin": "https://www.bilibili.com",
        }
        xml_records: list[dict] = []
        xml_error = None
        for attempt in range(4):
            try:
                resp = await client.get(
                    f"https://comment.bilibili.com/{cid}.xml",
                    headers=headers,
                    timeout=25,
                )
                resp.raise_for_status()
                xml_records = parse_xml_danmaku(resp.content)
                xml_error = None
                break
            except Exception as exc:
                xml_error = repr(exc)
                await asyncio.sleep(1.5 * (attempt + 1) + random.random())

        seg_records: list[dict] = []
        seg_error = None
        duration = int(page_info.get("duration") or video_info.get("duration") or 0)
        segment_count = max(1, (duration + 359) // 360)
        try:
            v = video.Video(aid=aid)
            for seg_index in range(segment_count):
                for attempt in range(4):
                    try:
                        dm_list = await v.get_danmakus(
                            cid=cid,
                            from_seg=seg_index,
                            to_seg=seg_index,
                        )
                        for dm in dm_list:
                            rec = bilibili_danmaku_to_record(dm)
                            if rec:
                                seg_records.append(rec)
                        break
                    except DanmakuClosedException:
                        seg_error = "closed"
                        break
                    except (ResponseCodeException, Exception) as exc:
                        seg_error = repr(exc)
                        await asyncio.sleep(
                            (1.5 * (attempt + 1) + random.random())
                            * (1 if attempt < 3 else 2)
                        )
        except Exception as exc:
            seg_error = repr(exc)

        records = merge_records(xml_records + seg_records)
        payload = {
            "version": 3,
            "bvid": bvid,
            "aid": aid,
            "account": account_label(video_info["account"]),
            "page": page_no,
            "cid": cid,
            "part": page_info.get("part") or "",
            "duration": duration,
            "title": video_info["title"],
            "date": video_info["date"],
            "fetched_at": now_iso(),
            "source_counts": {
                "xml": len(xml_records),
                "seg": len(seg_records),
            },
            "errors": {
                "xml": xml_error,
                "seg": seg_error,
            },
            "danmaku": records,
        }
        save_json(out_file, payload)
        return {
            "bvid": bvid,
            "page": page_no,
            "cached": False,
            "danmaku": len(records),
            "sources": payload["source_counts"],
            "errors": payload["errors"],
        }


async def run_fetch(limit: int, workers: int) -> list[dict]:
    registry = load_json(REGISTRY_FILE, {})
    cache = load_json(CACHE_FILE, {})
    jobs = []
    for row in registry.get("videos", []):
        bvid = row.get("bvid")
        info = cache.get(bvid)
        if not bvid or not isinstance(info, dict):
            continue
        video_info = {
            "bvid": bvid,
            "aid": info.get("aid") or row.get("aid"),
            "title": row.get("title") or info.get("title") or "",
            "date": row.get("date"),
            "account": row.get("account") or "",
            "duration": info.get("duration") or 0,
        }
        pages = info.get("pages") or [
            {"cid": info.get("cid"), "page": 1, "part": "", "duration": info.get("duration") or 0}
        ]
        for page in pages:
            if not page.get("cid"):
                continue
            jobs.append((page, video_info))

    if limit > 0:
        # 每个 BV 保留全部分P，避免多P视频漏抓。
        selected_bvids = []
        for page, video_info in jobs:
            if video_info["bvid"] not in selected_bvids:
                selected_bvids.append(video_info["bvid"])
            if len(selected_bvids) >= limit:
                break
        jobs = [job for job in jobs if job[1]["bvid"] in selected_bvids]

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(workers)
    async with httpx.AsyncClient(headers={"User-Agent": UA}) as client:
        results = await asyncio.gather(
            *(fetch_page(client, sem, page, video_info) for page, video_info in jobs),
            return_exceptions=True,
        )

    normalized = []
    for result in results:
        if isinstance(result, Exception):
            normalized.append({"error": repr(result)})
        else:
            normalized.append(result)
    return normalized


def aggregate() -> dict:
    registry = load_json(REGISTRY_FILE, {})
    account_by_bvid = {
        row.get("bvid"): account_label(row.get("account") or "")
        for row in registry.get("videos", [])
    }
    page_files = sorted(RAW_DIR.glob("*.p*.json"))
    total_records = 0
    total_pages = 0
    total_videos = 0
    by_account = Counter()
    by_source = Counter()
    unique_source_records = Counter()
    history_source_records = 0
    errors = 0
    video_stats: dict[str, dict] = {}
    csv_columns = [
        "bvid", "aid", "account", "page", "cid", "part", "title", "date",
        "id", "progress", "mode", "font_size", "color", "send_time",
        "pool", "crc32_id", "weight", "action", "attr", "content", "source",
    ]
    JSONL_FILE.parent.mkdir(parents=True, exist_ok=True)
    CSV_FILE.parent.mkdir(parents=True, exist_ok=True)
    with JSONL_FILE.open("w", encoding="utf-8", newline="\n") as json_fp, \
         CSV_FILE.open("w", encoding="utf-8-sig", newline="") as csv_fp:
        writer = csv.DictWriter(csv_fp, fieldnames=csv_columns)
        writer.writeheader()
        for path in page_files:
            data = load_json(path)
            if not isinstance(data, dict):
                errors += 1
                continue
            total_pages += 1
            if data.get("bvid") not in account_by_bvid:
                continue
            # 只读取历史缓存的 s001.json。旧测试策略写入的 s002+ 是页 1 拷贝，
            # 扫进去会导致重复爆炸。
            history_records: list[dict] = []
            history_dir = OUT_DIR / "history" / f"{data.get('bvid')}.p{int(data.get('page') or 1):03d}"
            for day_dir in sorted(history_dir.iterdir()) if history_dir.exists() else []:
                if not day_dir.is_dir():
                    continue
                day_file = day_dir / "s001.json"
                day_data = load_json(day_file)
                if not isinstance(day_data, dict) or not isinstance(day_data.get("danmaku"), list):
                    continue
                for rec in day_data["danmaku"]:
                    rec["source"] = ["history"]
                    history_records.append(rec)
            merged_records = merge_records((data.get("danmaku") or []) + history_records)
            seen_bvids = aggregate.__dict__.setdefault("_seen_bvids", set())
            if data["bvid"] not in seen_bvids:
                seen_bvids.add(data["bvid"])
                total_videos += 1
            source_counts = data.get("source_counts", {})
            account = data.get("account") or account_by_bvid.get(data["bvid"], "主号")
            stats = video_stats.setdefault(
                data["bvid"],
                {
                    "bvid": data["bvid"],
                    "aid": data.get("aid"),
                    "account": account,
                    "title": data.get("title"),
                    "date": data.get("date"),
                    "page_count": 0,
                    "danmaku_count": 0,
                    "xml_count": 0,
                    "seg_count": 0,
                    "history_count": 0,
                    "first_send_time": 0,
                    "last_send_time": 0,
                },
            )
            stats["page_count"] += 1
            stats["danmaku_count"] += len(merged_records)
            stats["xml_count"] += source_counts.get("xml", 0)
            stats["seg_count"] += source_counts.get("seg", 0)
            stats["history_count"] += sum(1 for rec in merged_records if "history" in rec.get("source", []))
            send_times = [int(rec.get("send_time") or 0) for rec in data.get("danmaku", [])]
            send_times = [t for t in send_times if t > 0]
            if send_times:
                stats["first_send_time"] = min([stats["first_send_time"] or min(send_times)] + send_times)
                stats["last_send_time"] = max(stats["last_send_time"], max(send_times))
            by_source["xml"] += source_counts.get("xml", 0)
            by_source["seg"] += source_counts.get("seg", 0)
            history_source_records += sum(1 for rec in merged_records if "history" in rec.get("source", []))
            for rec in merged_records:
                total_records += 1
                by_account[account] += 1
                for source_name in rec.get("source") or ["xml"]:
                    unique_source_records[source_name] += 1
                row = {
                    "bvid": data.get("bvid"),
                    "aid": data.get("aid"),
                    "account": account,
                    "page": data.get("page"),
                    "cid": data.get("cid"),
                    "part": data.get("part"),
                    "title": data.get("title"),
                    "date": data.get("date"),
                    "id": rec.get("id"),
                    "progress": rec.get("progress"),
                    "mode": rec.get("mode"),
                    "font_size": rec.get("font_size"),
                    "color": rec.get("color"),
                    "send_time": rec.get("send_time"),
                    "pool": rec.get("pool"),
                    "crc32_id": rec.get("crc32_id"),
                    "weight": rec.get("weight"),
                    "action": rec.get("action"),
                    "attr": rec.get("attr"),
                    "content": rec.get("content"),
                    "source": "|".join(rec.get("source", [])),
                }
                json_fp.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
                writer.writerow(row)

    summary = {
        "fetched_at": now_iso(),
        "videos": total_videos,
        "pages": total_pages,
        "danmaku_records": total_records,
        "by_account": dict(by_account),
        "source_fetches": dict(by_source),
        "unique_source_records": dict(unique_source_records),
        "history_unique_records": history_source_records,
        "raw_file_errors": errors,
        "jsonl": str(JSONL_FILE.relative_to(ROOT)),
        "csv": str(CSV_FILE.relative_to(ROOT)),
        "per_video_summary": str(PER_VIDEO_FILE.relative_to(ROOT)),
    }
    save_json(SUMMARY_FILE, summary)
    video_columns = [
        "bvid", "aid", "account", "title", "date", "page_count", "danmaku_count",
        "xml_count", "seg_count", "history_count", "first_send_time", "last_send_time",
    ]
    with PER_VIDEO_FILE.open("w", encoding="utf-8-sig", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=video_columns)
        writer.writeheader()
        for bvid in sorted(video_stats, key=lambda x: video_stats[x].get("date") or ""):
            writer.writerow(video_stats[bvid])
    aggregate._seen_bvids = set()
    return summary


async def main_async(args) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    if args.clean_invalid:
        print("清理分段弹幕占位缓存：", json.dumps(clean_invalid_cache(), ensure_ascii=False))
    if not args.aggregate_only:
        print(f"开始抓取，限制 {args.limit or '全部'} 个 BV，并发 {args.workers} ...")
        started = time.time()
        results = await run_fetch(args.limit, args.workers)
        ok = sum(1 for item in results if isinstance(item, dict) and not item.get("error"))
        fail = sum(1 for item in results if isinstance(item, dict) and item.get("error"))
        records = sum(item.get("danmaku", 0) for item in results if isinstance(item, dict))
        print(f"抓取完成：页面 {ok}，异常 {fail}，本轮记录 {records}，耗时 {time.time() - started:.1f}s")
    summary = aggregate()
    print("汇总完成：", json.dumps(summary, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0, help="只抓取前 N 个 BV；0 表示全部")
    parser.add_argument("--workers", type=int, default=3, help="并发数，默认 3")
    parser.add_argument("--aggregate-only", action="store_true", help="只重新汇总，不抓取")
    parser.add_argument("--clean-invalid", action="store_true", help="清理已有缓存中的分段弹幕占位记录")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
