#!/usr/bin/env python3
"""Refresh every registered video, retaining historical data and per-page status."""
import argparse
import concurrent.futures
import gzip
import json
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from datetime import datetime, timezone
from pathlib import Path

import bili_api

ROOT = Path(__file__).resolve().parents[1]


def read(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return default


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temp.replace(path)


def request(url, params=None):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=bili_api._headers())
    with urllib.request.urlopen(req, timeout=18) as response:
        data = response.read()
        encoding = response.headers.get("Content-Encoding", "")
        if encoding == "gzip":
            data = gzip.decompress(data)
        elif encoding == "deflate":
            try:
                data = zlib.decompress(data)
            except zlib.error:
                data = zlib.decompress(data, -zlib.MAX_WBITS)
        return data


def api(url, params):
    response = json.loads(request(url, params))
    if response.get("code") != 0:
        raise ValueError("api_code=" + str(response.get("code")))
    return response.get("data") or {}


def collect(row, old_meta, historical):
    bvid = row["bvid"]
    result = {"checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "pages": []}
    try:
        meta = api("https://api.bilibili.com/x/web-interface/view", {"bvid": bvid})
        result["metadata"] = "ok"
    except Exception as exc:
        result["metadata"] = "error:" + type(exc).__name__ + ":" + str(exc)[:100]
        meta = old_meta or {}
    pages = meta.get("pages") or ([{"cid": meta["cid"], "page": 1}] if meta.get("cid") else [])
    subtitles = []
    exported = []
    previous_export = read(ROOT / "site" / "danmaku" / (bvid + ".json"), {})
    for index, page in enumerate(pages, 1):
        cid = page.get("cid")
        number = page.get("page", index)
        state = {"page": number, "cid": cid, "title": page.get("part", "")}
        lines = []
        try:
            player = api("https://api.bilibili.com/x/player/wbi/v2", bili_api._signed({"bvid": bvid, "cid": cid}))
            tracks = player.get("subtitle", {}).get("subtitles") or []
            tracks.sort(key=lambda s: (not s.get("lan", "").startswith("zh"), not s.get("lan", "").startswith("ai")))
            if tracks:
                url = tracks[0].get("subtitle_url") or ""
                if url.startswith("//"):
                    url = "https:" + url
                if not url.startswith("https://"):
                    raise ValueError("invalid subtitle URL")
                body = json.loads(request(url))
                lines = [item.get("content", "").strip() for item in body.get("body", []) if item.get("content", "").strip()]
                state["subtitle"] = "ok" if lines else "empty"
            else:
                state["subtitle"] = "none"
        except Exception as exc:
            state["subtitle"] = "error:" + type(exc).__name__ + ":" + str(exc)[:100]
        state["subtitle_lines"] = len(lines)
        subtitles.extend(lines)
        records = {}
        raw = historical / "danmaku" / "raw" / (bvid + ".p%03d.json" % number)
        for item in read(raw, {}).get("danmaku", []):
            if item.get("content"):
                key = str(item.get("id") or (str(item.get("progress")) + "|" + item["content"]))
                records[key] = {"t": item.get("progress", 0), "text": item["content"]}
        state["historical_danmaku"] = len(records)
        try:
            root = ET.fromstring(request("https://comment.bilibili.com/%s.xml" % cid))
            if root.tag != "i":
                raise ValueError("unexpected XML root")
            current = 0
            for element in root.findall("d"):
                parts = element.get("p", "").split(",")
                text = element.text or ""
                if len(parts) < 8 or not text:
                    continue
                records[parts[7] or parts[0] + "|" + text] = {"t": float(parts[0]), "text": text}
                current += 1
            state["danmaku"] = "ok" if current else "empty"
            state["current_danmaku"] = current
        except Exception as exc:
            state["danmaku"] = "error:" + type(exc).__name__ + ":" + str(exc)[:100]
        existing = {(item["t"], item["text"]) for item in records.values()}
        for old_page in previous_export.get("pages", []):
            if old_page.get("page") == number:
                for item in old_page.get("items", []):
                    key = (item.get("t", 0), item.get("text", ""))
                    if key not in existing:
                        records["previous:" + str(len(records))] = {"t": key[0], "text": key[1]}
                        existing.add(key)
        state["available_danmaku"] = len(records)
        exported.append({"page": number, "title": page.get("part", ""),
                         "items": sorted(records.values(), key=lambda x: x["t"])})
        result["pages"].append(state)
    if subtitles:
        path = ROOT / "site" / "subtitles" / (bvid + ".json")
        previous = read(path, {}).get("lines", [])
        if len(subtitles) >= len(previous):
            write(path, {"bvid": bvid, "lines": subtitles})
    for old_page in previous_export.get("pages", []):
        if old_page.get("page") not in {page["page"] for page in exported}:
            exported.append(old_page)
    if any(page["items"] for page in exported):
        write(ROOT / "site" / "danmaku" / (bvid + ".json"), {"bvid": bvid, "pages": exported})
    return bvid, result, meta


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--historical", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--retry-errors", action="store_true")
    args = parser.parse_args()
    bili_api.ROOT = str(args.historical)
    bili_api._wbi_key()
    rows = [row for row in read(ROOT / "registry.json", {})["videos"] if row.get("bvid")]
    rows.sort(key=lambda r: (r.get("date") or "", r["bvid"]))
    if args.limit:
        rows = rows[:args.limit]
    meta_path = ROOT / "tools" / "bili_meta_cache.json"
    report_path = ROOT / "site" / "data-coverage.json"
    metadata = read(meta_path, {})
    report = read(report_path, {"videos": {}})
    completed = report["videos"]
    def needs_retry(row):
        previous = completed.get(row["bvid"])
        if not previous:
            return True
        return args.retry_errors and (previous["metadata"].startswith("error") or any(
            page["subtitle"].startswith("error") or page["danmaku"].startswith("error")
            for page in previous["pages"]))
    pending = [row for row in rows if needs_retry(row)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(collect, row, metadata.get(row["bvid"]), args.historical) for row in pending]
        for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
            bvid, result, meta = future.result()
            completed[bvid] = result
            if result["metadata"] == "ok":
                metadata[bvid] = meta
            if i % 10 == 0 or i == len(futures):
                write(report_path, report)
                write(meta_path, metadata)
                print("processed %d/%d (%s)" % (i, len(futures), bvid), flush=True)


if __name__ == "__main__":
    main()
