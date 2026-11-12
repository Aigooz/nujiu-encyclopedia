# -*- coding: utf-8 -*-
"""系统性探测微博免登录接口的可达范围（列表分页 / 评论分页）。"""
import gzip
import json
import time
import urllib.parse
import urllib.request

UA_MOBILE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
             "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
UA_DESKTOP = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
UID = "1782488734"
MID = "5363820765381922"


def get(url, mobile=True):
    headers = {
        "User-Agent": UA_MOBILE if mobile else UA_DESKTOP,
        "Referer": "https://m.weibo.cn/",
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        "MWeibo-Pwa": "1",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=25) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return resp.status, raw.decode("utf-8", "ignore")


def probe_list():
    print("== 微博列表分页 ==")
    base = "https://m.weibo.cn/api/container/getIndex"
    # 先拿第一页，取出 since_id 候选
    _, body = get("%s?type=uid&value=%s&containerid=107603%s" % (base, UID, UID))
    data = json.loads(body)
    info = (data.get("data") or {}).get("cardlistInfo") or {}
    cards = (data.get("data") or {}).get("cards") or []
    mblogs = [c["mblog"] for c in cards if c.get("mblog")]
    print("page1 cards=%d  cardlistInfo keys=%s" % (len(mblogs), sorted(info.keys())))
    last_id = mblogs[-1]["id"] if mblogs else ""
    print("last id =", last_id)

    variants = [
        ("since_id", "?type=uid&value=%s&containerid=107603%s&since_id=%s" % (UID, UID, last_id)),
        ("since_id+page_type", "?type=uid&value=%s&containerid=107603%s&since_id=%s&page_type=03" % (UID, UID, last_id)),
        ("page=2", "?type=uid&value=%s&containerid=107603%s&page=2" % (UID, UID)),
        ("page_type03&page=2", "?containerid=107603%s&page_type=03&page=2" % UID),
        ("page=2&page_type=03", "?type=uid&value=%s&containerid=107603%s&page=2&page_type=03" % (UID, UID)),
    ]
    for name, query in variants:
        try:
            _, body = get(base + query)
            if body.lstrip().startswith("{"):
                d = json.loads(body)
                cs = (d.get("data") or {}).get("cards") or []
                n = sum(1 for c in cs if c.get("mblog"))
                print("  %-22s ok=%s cards=%d first=%s" % (
                    name, d.get("ok"), n,
                    (cs[0]["mblog"]["id"] if cs and cs[0].get("mblog") else None)))
            else:
                print("  %-22s NON-JSON len=%d head=%r" % (name, len(body), body[:60]))
        except Exception as exc:
            print("  %-22s ERR %s %s" % (name, type(exc).__name__, str(exc)[:70]))
        time.sleep(0.5)


def probe_comments():
    print("== 评论分页 ==")
    base = "https://m.weibo.cn/comments/hotflow"
    _, body = get("%s?id=%s&mid=%s&max_id_type=0" % (base, MID, MID))
    d = json.loads(body)
    dd = d.get("data") or {}
    rows = dd.get("data") or []
    print("page1 rows=%d total=%s max_id=%s" % (len(rows), dd.get("total_number"), dd.get("max_id")))
    if rows:
        print("  first comment keys:", sorted(rows[0].keys())[:24])
        print("  first replies:", len(rows[0].get("comments") or []))
    mx = dd.get("max_id")
    if mx:
        for name, extra in [
            ("max_id", "&max_id=%s&max_id_type=0" % mx),
            ("max_id+page", "&max_id=%s&max_id_type=0&page=2" % mx),
        ]:
            try:
                _, b2 = get("%s?id=%s&mid=%s%s" % (base, MID, MID, extra))
                d2 = json.loads(b2)
                dd2 = d2.get("data") or {}
                print("  %-12s ok=%s rows=%d resp_keys=%s" % (
                    name, d2.get("ok"), len(dd2.get("data") or []), sorted(dd2.keys())[:6]))
            except Exception as exc:
                print("  %-12s ERR %s" % (name, type(exc).__name__))
            time.sleep(0.5)


def probe_comments_multi():
    """检查评论接口对不同微博（含较早的）是否都可用。"""
    print("== 多篇微博评论可达性 ==")
    ids = [
        "5363820765381922", "5363743527797969", "5363699699417454",
        "5363297655982188", "5363108178559856", "5363088161246118",
        "5362689583089295", "5362327663674728", "5362240036539476",
        "5362225657413892",
    ]
    ok = 0
    for mid in ids:
        try:
            _, body = get("https://m.weibo.cn/comments/hotflow?id=%s&mid=%s&max_id_type=0" % (mid, mid))
            d = json.loads(body)
            dd = d.get("data") or {}
            rows = dd.get("data") or []
            replies = sum(len(r.get("comments") or []) for r in rows)
            print("  %s ok=%s top=%d replies=%d total=%s" % (
                mid, d.get("ok"), len(rows), replies, dd.get("total_number")))
            if rows:
                ok += 1
        except Exception as exc:
            print("  %s ERR %s" % (mid, type(exc).__name__))
        time.sleep(0.6)
    print("  可用篇数: %d/%d" % (ok, len(ids)))


def probe_visitor():
    """拜访客系统能否换到可用于列表分页的 cookie。"""
    print("== 访客 cookie 流程 ==")
    import http.cookiejar
    import re
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", UA_MOBILE),
                         ("Referer", "https://passport.weibo.com/visitor/visitor")]
    body = urllib.parse.urlencode({"cb": "gen_callback", "fp": "{}"}).encode()
    try:
        req = urllib.request.Request("https://passport.weibo.com/visitor/genvisitor", data=body)
        txt = opener.open(req, timeout=20).read().decode("utf-8", "ignore")
        tid = re.search(r'"tid":"([^"]+)"', txt)
        print("  genvisitor tid:", bool(tid))
        if tid:
            q = urllib.parse.urlencode({"a": "incognito", "t": tid.group(1), "w": "2",
                                        "c": "095", "gc": "", "cb": "cross_domain",
                                        "from": "weibo", "_rand": "0.5"})
            r = opener.open("https://passport.weibo.com/visitor/visitor?" + q, timeout=20)
            payload = r.read().decode("utf-8", "ignore")
            print("  visitor status=%s body_len=%d cookies=%s" % (
                r.status, len(payload), [c.name for c in jar]))
    except Exception as exc:
        print("  ERR %s %s" % (type(exc).__name__, str(exc)[:80]))


if __name__ == "__main__":
    try:
        probe_list()
    except Exception as exc:
        print("列表探测失败:", type(exc).__name__, str(exc)[:80])
    probe_comments()
    probe_comments_multi()
    probe_visitor()
