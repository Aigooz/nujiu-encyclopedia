# -*- coding: utf-8 -*-
from __future__ import annotations
import json, time, sys, urllib.request, urllib.parse, gzip
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REG = ROOT / 'registry.json'
OUT = ROOT / 'tools' / 'bili_tags_cache.json'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
HEADERS = None


def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
        return json.loads(raw.decode('utf-8'))

def main():
    sys.path.insert(0, str(ROOT / 'tools'))
    from bili_api import _headers
    global HEADERS
    HEADERS = _headers()
    registry = json.loads(REG.read_text(encoding='utf-8'))
    bvids = []
    seen = set()
    for row in registry.get('videos', []):
        bvid = row.get('bvid')
        if bvid and bvid not in seen:
            seen.add(bvid)
            bvids.append(bvid)
    cache = {}
    if OUT.exists():
        try:
            cache = json.loads(OUT.read_text(encoding='utf-8'))
        except Exception:
            cache = {}
    total = len(bvids)
    done = 0
    for i, bvid in enumerate(bvids, 1):
        if bvid in cache and isinstance(cache[bvid], list):
            done += 1
            continue
        url = 'https://api.bilibili.com/x/tag/archive/tags?' + urllib.parse.urlencode({'bvid': bvid})
        last_err = None
        for attempt in range(4):
            try:
                obj = get_json(url)
                if obj.get('code') != 0:
                    raise RuntimeError(f"code={obj.get('code')} msg={obj.get('message')}")
                rows = []
                for x in obj.get('data') or []:
                    name = (x.get('tag_name') or '').strip()
                    if name:
                        rows.append({'id': x.get('tag_id'), 'name': name})
                cache[bvid] = rows
                OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding='utf-8')
                done += 1
                last_err = None
                break
            except Exception as e:
                last_err = e
                time.sleep(0.7 * (attempt + 1))
        if last_err is not None:
            cache[bvid] = []
            OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding='utf-8')
            print(f'FAIL {bvid}: {last_err}')
        if i % 20 == 0 or i == total:
            print(f'{done}/{total} 完成')
        time.sleep(0.18)
    OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'全部完成 {done}/{total} -> {OUT}')

if __name__ == '__main__':
    main()
