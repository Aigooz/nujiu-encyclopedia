#!/usr/bin/env python3
"""Compare the entire accessible account lists with the local registry."""
import argparse
import json
from pathlib import Path

import bili_api

parser = argparse.ArgumentParser()
parser.add_argument("--historical", type=Path, required=True)
args = parser.parse_args()
bili_api.ROOT = str(args.historical)
config = bili_api.load_config()
registry = json.loads((Path(__file__).resolve().parents[1] / "registry.json").read_text(encoding="utf-8"))
known = {row.get("bvid") for row in registry["videos"]}
for key in ("uid_main", "uid_alt"):
    mid = config.get("bili", key, fallback="").strip()
    if not mid:
        continue
    try:
        rows = bili_api.get_user_videos(mid, ps=30, max_pages=100)
        print(json.dumps({"account": key, "mid": mid, "listed": len(rows),
                          "missing": [v for v in rows if v["bvid"] not in known]}, ensure_ascii=False), flush=True)
    except Exception as exc:
        print(json.dumps({"account": key, "mid": mid, "error": str(exc)[:200]}, ensure_ascii=False), flush=True)
