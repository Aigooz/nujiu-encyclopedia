# -*- coding: utf-8 -*-
"""抓取全部视频热门评论（WBI 签名 + 无需登录），支持断点续传。

输出: tools/bili_comments_cache.json
用法: python tools/fetch_bili_comments.py [--pages 2] [--pace 2.5] [--limit N] [--risk-cooldown 180]
"""
import argparse, gzip, hashlib, json, sys, time
import urllib.parse, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout.reconfigure(encoding="utf-8")

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "tools" / "bili_comments_cache.json"
PACE = 2.5
RISK_COOLDOWN = 180

# WBI 混淆表（B 站标准）
MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,
             33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,
             26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,
             20,34,44,52]

_wbi_cache = {"key": None, "ts": 0.0}


def _fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Referer": "https://www.bilibili.com/",
        "Accept": "application/json, text/plain, */*",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8"))


def get_wbi_key() -> str:
    """获取（并缓存 30 分钟）WBI 混淆密钥。"""
    now = time.time()
    if _wbi_cache["key"] and now - _wbi_cache["ts"] < 1800:
        return _wbi_cache["key"]
    nav = _fetch("https://api.bilibili.com/x/web-interface/nav")
    wbi_img = (nav.get("data") or {}).get("wbi_img") or {}
    img_key = (wbi_img.get("img_url") or "").rsplit("/", 1)[-1].split(".")[0]
    sub_key = (wbi_img.get("sub_url") or "").rsplit("/", 1)[-1].split(".")[0]
    raw = img_key + sub_key
    mixin = "".join(raw[i] for i in MIXIN_TAB)[:32]
    _wbi_cache["key"] = mixin
    _wbi_cache["ts"] = now
    return mixin


def wbi_request(base_url: str, params: dict) -> dict:
    """对 params 追加 wts/w_rid 并请求 wbi 接口。"""
    mixin = get_wbi_key()
    p = dict(params)
    p["wts"] = str(int(time.time()))
    query = "&".join(f"{k}={urllib.parse.quote(str(p[k]), safe='')}"
                     for k in sorted(p))
    w_rid = hashlib.md5((query + mixin).encode()).hexdigest()
    return _fetch(f"{base_url}?{query}&w_rid={w_rid}")


def clean_comment(r: dict) -> dict:
    item = {
        "rpid": r.get("rpid"),
        "name": (r.get("member") or {}).get("uname", ""),
        "like": r.get("like", 0),
        "ctime": r.get("ctime", 0),
        "message": (r.get("content") or {}).get("message", ""),
        "replies": [],
    }
    for sub in (r.get("replies") or [])[:3]:
        item["replies"].append({
            "name": (sub.get("member") or {}).get("uname", ""),
            "like": sub.get("like", 0),
            "message": (sub.get("content") or {}).get("message", ""),
        })
    return item


def fetch_video_comments(aid: int, pages: int = 2) -> list:
    comments, seen = [], set()
    next_offset = ""
    consecutive_fail = 0
    for _pn in range(1, pages + 1):
        d = None
        for attempt in range(2):
            try:
                d = wbi_request(
                    "https://api.bilibili.com/x/v2/reply/wbi/main",
                    {"type": 1, "mode": 3, "ps": 30, "oid": aid,
                     "pagination_str": json.dumps({"offset": next_offset})})
                break
            except Exception as e:
                consecutive_fail += 1
                wait = RISK_COOLDOWN
                print(f"    [risk] {e} -> 等待 {wait}s ({attempt + 1}/2)", flush=True)
                # 强制刷新 WBI key（可能已轮换）
                _wbi_cache["key"] = None
                time.sleep(wait)
                d = None
        if d is None:
            break
        consecutive_fail = 0
        code = d.get("code")
        if code != 0:
            print(f"    [api] code={code} msg={d.get('message', '')}", flush=True)
            break
        data = d.get("data") or {}
        reps = data.get("replies") or []
        if not reps:
            break
        for r in reps:
            rpid = r.get("rpid")
            if rpid in seen:
                continue
            seen.add(rpid)
            comments.append(clean_comment(r))
        if len(comments) >= 40:
            break
        cursor = data.get("cursor") or {}
        nxt = (cursor.get("pagination_reply") or {}).get("next_offset")
        if not nxt or cursor.get("is_end"):
            break
        next_offset = nxt
        time.sleep(PACE)
    comments.sort(key=lambda c: -c.get("like", 0))
    return comments


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--pace", type=float, default=2.5)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--risk-cooldown", type=int, default=180)
    args = ap.parse_args()
    global PACE, RISK_COOLDOWN
    PACE = max(0.5, args.pace)
    RISK_COOLDOWN = args.risk_cooldown

    meta = json.load(open(ROOT / "tools" / "bili_meta_cache.json", encoding="utf-8"))
    registry = json.load(open(ROOT / "registry.json", encoding="utf-8"))
    videos = registry.get("videos", registry)
    if args.limit:
        videos = videos[: args.limit]

    cache = {}
    if OUT_FILE.exists():
        try:
            cache = json.load(open(OUT_FILE, encoding="utf-8"))
        except Exception:
            cache = {}

    todo = [v["bvid"] for v in videos if v.get("bvid")]
    already = len([b for b in todo if b in cache and cache[b].get("comments")])
    print(f"共 {len(todo)} 个视频，已有评论 {already}", flush=True)
    start = time.time()
    done = 0
    for i, bvid in enumerate(todo, 1):
        if bvid in cache and cache[bvid].get("comments"):
            continue
        m = meta.get(bvid) or {}
        aid = m.get("aid")
        if not aid:
            continue
        comments = fetch_video_comments(aid, pages=args.pages)
        cache[bvid] = {
            "aid": aid,
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
            "total": len(comments),
            "comments": comments,
        }
        done += 1
        if done % 10 == 0 or i == len(todo):
            json.dump(cache, open(OUT_FILE, "w", encoding="utf-8"),
                      ensure_ascii=False)
            el = time.time() - start
            print(f"[{i}/{len(todo)}] 本轮 {done} 个新视频，累计 {len(cache)}，"
                  f"已有评论 {len([b for b in todo if b in cache and cache[b].get('comments')])}，"
                  f"耗时 {el:.0f}s", flush=True)
        time.sleep(PACE)
    json.dump(cache, open(OUT_FILE, "w", encoding="utf-8"), ensure_ascii=False)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
