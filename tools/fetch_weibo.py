# -*- coding: utf-8 -*-
"""抓取微博内容与评论区，输出 site/data-weibo.js。

设计目标（对应"软件内完整浏览 + 本地留存"）：
  - 微博正文、配图、互动数、发布时间全部落地到仓库，半年可见也不会丢；
  - 每条微博附带评论区（顶层评论 + 楼中楼），供 App/站点原生渲染；
  - 免登录只能拿到列表第一页与评论第一页，若在 config.ini 配了 weibo cookie，
    则自动翻页抓取更早的内容。

用法：
  python tools/fetch_weibo.py                 # 免登录，抓当前可见的第一页
  python tools/fetch_weibo.py --comments-all  # 评论尽量多抓（仍受登录限制）
  python tools/fetch_weibo.py --pages 8       # 配了 cookie 时可翻更多页
"""
from __future__ import annotations

import argparse
import configparser
import gzip
import html
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site" / "data-weibo.js"
CACHE_DIR = ROOT / "tools"
# 浏览器抓取的列表种子（m.weibo.cn 直连被 432 拦截时作为回退来源）。
SEED_FILES = {
    "nujiu": CACHE_DIR / "weibo_nujiu_seed.json",
}

MOBILE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
             "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")

ACCOUNTS = {
    "nujiu": {"uid": "5584883348", "name": "怒九今天爆肝了吗"},
}
# 作者头像：微博图片 CDN 需要 Referer 才能加载，这里只存无水印基础地址，
# 由客户端在请求时附带 Referer。
AVATARS = {
    "warma": "https://tvax2.sinaimg.cn/crop.0.0.600.600.180/6a3e9e9ely8hobt1otu99j20go0gowgh.jpg",
    "nujiu": "https://tvax2.sinaimg.cn/crop.0.0.996.996.180/0065XBhGly8ggxg9cwb13j30ro0ro40q.jpg",
}

IMAGE_TAG = re.compile(r'<img[^>]*alt="([^"]*)"[^>]*>', re.I)
LINK_TAG = re.compile(r'<a[^>]*>(.*?)</a>', re.I | re.S)
ANY_TAG = re.compile(r"<[^>]+>")


# ---------------------------------------------------------------- 基础请求

def load_cookie() -> str:
    cfg_path = ROOT / "config.ini"
    if not cfg_path.exists():
        return ""
    cfg = configparser.RawConfigParser()
    try:
        cfg.read(cfg_path, encoding="utf-8-sig")
    except Exception:
        return ""
    for section in cfg.sections():
        if cfg.has_option(section, "weibo_cookie"):
            return cfg.get(section, "weibo_cookie").strip()
    return ""


def http_get(url: str, cookie: str = "", backend: str = "m") -> str:
    headers = {
        "User-Agent": MOBILE_UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
    }
    if backend == "m":
        headers.update({
            "Referer": "https://m.weibo.cn/",
            "X-Requested-With": "XMLHttpRequest",
            "MWeibo-Pwa": "1",
        })
    else:
        headers["Referer"] = "https://weibo.com/"
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=25) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", "ignore")


# ---------------------------------------------------------------- 文本清洗

def clean_text(raw: str) -> str:
    """把微博 HTML 正文转成纯文本，保留 [表情] 标记与换行。"""
    if not raw:
        return ""

    def emoji(match):
        name = match.group(1).strip()
        return name if name.startswith("[") else "[%s]" % name

    text = IMAGE_TAG.sub(emoji, raw)
    text = LINK_TAG.sub(lambda m: m.group(1), text)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = ANY_TAG.sub("", text)
    text = html.unescape(text).replace("\u200b", "")
    text = text.replace("...全文", "").replace("收起", "")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_created(value: str) -> str:
    try:
        return datetime.strptime(value, "%a %b %d %H:%M:%S %z %Y").strftime("%Y-%m-%d %H:%M")
    except Exception:
        return value or ""


# ---------------------------------------------------------------- 内容抓取

def fetch_post_list(uid: str, cookie: str, max_pages: int) -> list:
    """抓取微博列表。免登录通常只有第一页；有 cookie 时才可能翻页。"""
    base = "https://m.weibo.cn/api/container/getIndex"
    posts, seen, since_id = [], set(), ""
    for page in range(1, max_pages + 1):
        query = "?type=uid&value=%s&containerid=107603%s" % (uid, uid)
        if since_id:
            # 官方翻页优先用 since_id；部分接口也接受 page。
            query += "&since_id=%s" % since_id
        else:
            query += "&page=%d" % page
        try:
            body = http_get(base + query, cookie)
        except urllib.error.HTTPError as exc:
            print("    列表第 %d 页被拒绝(%s)，停止翻页" % (page, exc.code))
            break
        if not body.lstrip().startswith("{"):
            print("    列表第 %d 页返回非 JSON，停止翻页" % page)
            break
        data = json.loads(body)
        if data.get("ok") != 1:
            print("    列表第 %d 页 ok=%s，停止翻页" % (page, data.get("ok")))
            break
        cards = (data.get("data") or {}).get("cards") or []
        page_posts = [c["mblog"] for c in cards if c.get("mblog")]
        new = 0
        for m in page_posts:
            mid = str(m.get("id") or "")
            if not mid or mid in seen:
                continue
            seen.add(mid)
            new += 1
            posts.append({
                "id": mid,
                "bid": m.get("bid") or "",
                "date": parse_created(m.get("created_at") or ""),
                "text": clean_text(m.get("text") or ""),
                "reposts": m.get("reposts_count") or 0,
                "comments": m.get("comments_count") or 0,
                "likes": m.get("attitudes_count") or 0,
                "region": (m.get("region_name") or "").replace("发布于", "").strip(),
                "pics": [p.get("large", {}).get("url") or p.get("url")
                         for p in (m.get("pics") or [])],
                "url": "https://m.weibo.cn/status/%s" % (m.get("bid") or mid),
                "is_top": bool(m.get("title", {}).get("text") == "置顶") if isinstance(m.get("title"), dict) else False,
            })
        info = (data.get("data") or {}).get("cardlistInfo") or {}
        since_id = str(info.get("since_id") or "")
        print("    列表第 %d 页 +%d（累计 %d）" % (page, new, len(posts)))
        if not page_posts or not since_id:
            break
        time.sleep(1.0)
    return posts


def load_seed_posts(key: str) -> list:
    """浏览器抓到的列表缓存（m.weibo.cn 直连被风控 432 时使用）。

    浏览器能拿到第一页，Python 直连常被判定为脚本而返回 432；
    这里把浏览器结果作为种子，再交给 Python 补评论。

    注意：种子文件是只读的原始抓取结果，抓取器不会回写它，避免
    "新格式覆盖种子"导致日期等字段在下一轮读取时丢失。
    """
    path = SEED_FILES.get(key)
    if path is None or not path.exists():
        path = CACHE_DIR / ("weibo_%s_cache.json" % key)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    out = []
    for item in data.get("posts") or []:
        text = clean_text(item.get("text") or "")
        if not text:
            continue
        # 兼容两种来源：浏览器原始抓取用 created_at，上一轮生成的缓存用 date。
        date = item.get("date") or parse_created(item.get("created_at") or "")
        out.append({
            "id": str(item.get("id") or ""),
            "bid": item.get("bid") or "",
            "date": date,
            "text": text,
            "reposts": item.get("reposts") or 0,
            "comments": item.get("comments") or 0,
            "likes": item.get("attitudes") or 0,
            "region": item.get("region") or "",
            "pics": item.get("pics") or [],
            "url": "https://m.weibo.cn/status/%s" % (item.get("bid") or item.get("id") or ""),
            "is_top": False,
        })
    return out


def fetch_post_comments(mid: str, cookie: str, author_uid: str = "", max_pages: int = 3) -> list:
    """抓取一条微博的评论区（顶层评论 + 楼中楼）。"""
    base = "https://m.weibo.cn/comments/hotflow"
    out, seen, max_id, max_id_type = [], set(), "", 0
    for page in range(1, max_pages + 1):
        url = "%s?id=%s&mid=%s&max_id_type=%d" % (base, mid, mid, max_id_type)
        if max_id:
            url += "&max_id=%s" % max_id
        try:
            body = http_get(url, cookie)
        except urllib.error.HTTPError as exc:
            if page == 1:
                print("      评论被拒绝(%s)" % exc.code)
            break
        if not body.lstrip().startswith("{"):
            break
        data = json.loads(body)
        if data.get("ok") != 1:
            if page == 1:
                print("      评论 ok=%s" % data.get("ok"))
            break
        payload = data.get("data") or {}
        rows = payload.get("data") or []
        if not rows:
            break
        for r in rows:
            cid = str(r.get("id") or "")
            if not cid or cid in seen:
                continue
            seen.add(cid)
            user = r.get("user") or {}
            out.append({
                "user": user.get("screen_name") or "",
                "avatar": user.get("profile_image_url") or "",
                "date": parse_created(r.get("created_at") or ""),
                "text": clean_text(r.get("text") or ""),
                "likes": r.get("like_count") or 0,
                "region": (r.get("source") or "").replace("来自", "").strip(),
                # 顶层评论是否由博主本人发出（用于 App 里的「博主」标记）。
                "is_author": bool(author_uid) and str(user.get("id")) == str(author_uid),
                "replies": [{
                    "user": (sub.get("user") or {}).get("screen_name") or "",
                    "date": parse_created(sub.get("created_at") or ""),
                    "text": clean_text(sub.get("text") or ""),
                    "likes": sub.get("like_count") or 0,
                    "is_author": bool(sub.get("is_mblog_author")),
                } for sub in (r.get("comments") or [])],
            })
        next_id = payload.get("max_id")
        next_type = payload.get("max_id_type") or 0
        if not next_id or str(next_id) == str(max_id):
            break
        max_id, max_id_type = str(next_id), next_type
        time.sleep(1.2)
    return out


# ---------------------------------------------------------------- 主流程

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=8, help="列表最多翻页数（需 cookie）")
    parser.add_argument("--comment-pages", type=int, default=3, help="每条微博评论最多翻页数")
    parser.add_argument("--no-comments", action="store_true", help="只抓正文，跳过评论")
    parser.add_argument("--only", choices=list(ACCOUNTS), default=None)
    args = parser.parse_args()

    cookie = load_cookie()
    print("微博 cookie：%s" % ("已配置（可翻页）" if cookie else "未配置（仅第一页）"))

    payload = {}
    for key, meta in ACCOUNTS.items():
        if args.only and key != args.only:
            continue
        print("== %s (%s) ==" % (meta["name"], meta["uid"]))
        posts = fetch_post_list(meta["uid"], cookie, args.pages)
        if not posts:
            posts = load_seed_posts(key)
            if posts:
                print("    直连列表被风控，改用浏览器缓存种子 %d 条" % len(posts))
        if not args.no_comments:
            for index, post in enumerate(posts, 1):
                comments = fetch_post_comments(post["id"], cookie, meta["uid"], args.comment_pages)
                post["comments_data"] = comments
                saved = sum(1 + len(c.get("replies") or []) for c in comments)
                print("    [%d/%d] %s 评论 %d 条（含楼中楼 %d）"
                      % (index, len(posts), post["date"], len(comments), saved))
                time.sleep(1.0)
        payload[key] = {
            "uid": meta["uid"],
            "name": meta["name"],
            "avatar": AVATARS.get(key, ""),
            "fetched_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "complete": bool(cookie),
            "count": len(posts),
            "posts": posts,
        }
        # 增量备份：即使后续账号失败也不丢已抓内容
        (CACHE_DIR / ("weibo_%s_cache.json" % key)).write_text(
            json.dumps(payload[key], ensure_ascii=False, indent=1), encoding="utf-8")

    OUT.write_text("const WEIBO = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    total_comments = sum(len(p.get("comments_data") or []) for acc in payload.values() for p in acc["posts"])
    print("已生成 %s：%d 个账号，共 %d 条微博，%d 条顶层评论"
          % (OUT.name, len(payload), sum(a["count"] for a in payload.values()), total_comments))


if __name__ == "__main__":
    main()
