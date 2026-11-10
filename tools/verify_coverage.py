#!/usr/bin/env python3
"""Validate published catalog coverage and public transcript payloads."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
registry = json.loads((root / "registry.json").read_text(encoding="utf-8"))["videos"]
coverage = json.loads((root / "site" / "data-coverage.json").read_text(encoding="utf-8"))["videos"]
assert {v["bvid"] for v in registry} == set(coverage)
total = 0
files = 0
for bvid, video in coverage.items():
    assert video["pages"], bvid
    path = root / "site" / "danmaku" / (bvid + ".json")
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["bvid"] == bvid
        for page in payload["pages"]:
            for item in page["items"]:
                assert set(item) == {"t", "text"} and isinstance(item["text"], str)
                total += 1
        files += 1
    path = root / "site" / "subtitles" / (bvid + ".json")
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["bvid"] == bvid and all(isinstance(line, str) for line in payload["lines"])
print("videos", len(registry), "danmaku files", files, "public records", total)
