#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.stdout.reconfigure(encoding="utf-8")
from analyze import analyze


def main():
    reg_path = ROOT / "registry.json"
    reg = json.loads(reg_path.read_text(encoding="utf-8"))
    for row in reg["videos"]:
        path = ROOT / "subtitles" / f"{row['bvid']}.json"
        if not path.exists():
            row.update(sub_lines=0, sub_chars=0, intro_count=0)
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        lines = data.get("lines") or []
        row["sub_lines"] = len(lines)
        row["sub_chars"] = sum(len(x) for x in lines)
        row["intro_count"] = 0
        if lines:
            analysis = analyze(row["title"], lines, row.get("desc", ""))
            row["analysis"] = analysis
            row["intro_count"] = analysis.get("intro_count", 0)
        else:
            row.pop("analysis", None)
    reg["total_sub_lines"] = sum(v["sub_lines"] for v in reg["videos"])
    reg["updated_at"] = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
    reg_path.write_text(json.dumps(reg, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"videos={len(reg['videos'])} sub_lines={reg['total_sub_lines']:,} with_subs={sum(v['sub_lines']>0 for v in reg['videos'])}")


if __name__ == "__main__":
    main()
