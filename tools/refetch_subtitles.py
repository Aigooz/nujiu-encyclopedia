#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.stdout.reconfigure(encoding="utf-8")
import bili_api


def refill(bvid: str):
    path = ROOT / "subtitles" / f"{bvid}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("lines"):
        return bvid, len(data["lines"]), "cached"
    info = bili_api.get_video_info(bvid)
    lines = []
    for page in info.get("pages") or []:
        if page.get("cid"):
            lines.extend(bili_api.get_subtitle_lines(bvid, page["cid"]))
            time.sleep(0.06)
    data["lines"] = lines
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return bvid, len(lines), "fetched"


def main():
    registry = json.loads((ROOT / "registry.json").read_text(encoding="utf-8"))
    bvids = [v["bvid"] for v in registry["videos"] if v.get("bvid")]
    done = 0
    with_subs = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(refill, bvid) for bvid in bvids]
        for future in as_completed(futures):
            bvid, count, status = future.result()
            if count:
                with_subs += 1
            done += 1
            if done % 20 == 0 or done == len(bvids):
                print(f"{done}/{len(bvids)} | with subtitles {with_subs} | last {bvid}: {count}", flush=True)
            time.sleep(0.05)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
