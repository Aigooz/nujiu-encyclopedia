# -*- coding: utf-8 -*-
"""B站API客户端：无需第三方库，仅用标准库。支持wbi签名、用户视频列表、字幕下载。"""
import json, time, hashlib, urllib.parse, urllib.request, urllib.error, configparser, os, re, gzip, io

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,
             29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,
             22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_config():
    cfg = configparser.RawConfigParser()
    cfg.read(os.path.join(ROOT, 'config.ini'), encoding='utf-8-sig')
    return cfg

def _cookie():
    try:
        return load_config().get('bili', 'cookie', fallback='').strip()
    except Exception:
        return ''

def _headers():
    h = {
        'User-Agent': UA,
        'Referer': 'https://www.bilibili.com/',
        'Origin': 'https://www.bilibili.com',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
    }
    ck = _cookie()
    if ck:
        h['Cookie'] = ck
    return h

def _get(url, params=None, retries=3):
    if params:
        url = url + ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=_headers())
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read()
                if r.headers.get('Content-Encoding') == 'gzip':
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode('utf-8'))
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'请求失败: {url} -> {last}')

# ---------------- wbi 签名 ----------------
_wbi_cache = {'key': None, 'ts': 0}

def _wbi_key():
    if _wbi_cache['key'] and time.time() - _wbi_cache['ts'] < 3600:
        return _wbi_cache['key']
    nav = _get('https://api.bilibili.com/x/web-interface/nav')
    img = nav['data']['wbi_img']['img_url']
    sub = nav['data']['wbi_img']['sub_url']
    raw = img.rsplit('/', 1)[1].split('.')[0] + sub.rsplit('/', 1)[1].split('.')[0]
    key = ''.join(raw[i] for i in MIXIN_TAB)[:32]
    _wbi_cache['key'] = key
    _wbi_cache['ts'] = time.time()
    return key

def _signed(params):
    params = dict(params)
    params['wts'] = int(time.time())
    params = dict(sorted(params.items()))
    q = urllib.parse.urlencode(params)
    params['w_rid'] = hashlib.md5((q + _wbi_key()).encode()).hexdigest()
    return params

# ---------------- 数据接口 ----------------
def get_user_videos(mid, ps=30, stop_before_ts=None, max_pages=40):
    """拉取UP主投稿列表（按pubdate降序）。stop_before_ts: 遇到更早的投稿即停。"""
    out = []
    for pn in range(1, max_pages + 1):
        params = _signed({'mid': mid, 'ps': ps, 'tid': 0, 'pn': pn, 'keyword': '',
                          'order': 'pubdate', 'platform': 'web',
                          'web_location': '1550101', 'order_avoided': 'true'})
        data = _get('https://api.bilibili.com/x/space/wbi/arc/search', params)
        code = data.get('code')
        if code != 0:
            raise RuntimeError(f'获取投稿列表失败 code={code} message={data.get("message")} '
                               f'(Cookie缺失或过期时常见，请更新config.ini中的cookie，或改用inbox半自动模式)')
        vlist = data['data']['list']['vlist']
        if not vlist:
            break
        for v in vlist:
            out.append({'bvid': v['bvid'], 'title': v['title'],
                        'created': v['created'], 'aid': v['aid']})
        oldest = min(v['created'] for v in vlist)
        if stop_before_ts and oldest <= stop_before_ts:
            break
        if len(vlist) < ps:
            break
        time.sleep(0.4)
    return out

def get_user_videos_free(mid, ps=30, max_pages=20):
    """免Cookie获取投稿列表（recArchivesByKeywords 接口，仅主号）。"""
    out = []
    for pn in range(1, max_pages + 1):
        data = _get('https://api.bilibili.com/x/series/recArchivesByKeywords',
                    {'mid': mid, 'keywords': '', 'pn': pn, 'ps': ps, 'order': 'pubdate'})
        archives = data.get('data', {}).get('archives', [])
        if not archives:
            break
        for a in archives:
            out.append({'bvid': a['bvid'], 'title': a['title'],
                        'created': a['pubdate'], 'aid': a['aid']})
        if len(archives) < ps:
            break
        time.sleep(0.3)
    return out

def get_video_info(bvid):
    """视频详情：标题、简介、发布时间、UP主、cid。"""
    data = _get('https://api.bilibili.com/x/web-interface/view', {'bvid': bvid})
    if data.get('code') != 0:
        raise RuntimeError(f'获取视频信息失败 bvid={bvid} code={data.get("code")}')
    v = data['data']
    return {'bvid': bvid, 'aid': v['aid'], 'title': v['title'], 'desc': v.get('desc', ''),
            'pubdate': v['pubdate'], 'owner_mid': v['owner']['mid'],
            'owner_name': v['owner']['name'], 'cid': v['cid'], 'duration': v.get('duration', 0),
            'pages': v.get('pages', [])}

def _download_subtitle(url):
    if url.startswith('//'):
        url = 'https:' + url
    req = urllib.request.Request(url, headers=_headers())
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
        return json.loads(raw.decode('utf-8'))

def get_subtitle_lines(bvid, cid):
    """返回字幕行文本列表。优先AI中文字幕，其次CC中文。无字幕返回 []。"""
    data = _get('https://api.bilibili.com/x/player/wbi/v2',
                _signed({'bvid': bvid, 'cid': cid}))
    if data.get('code') != 0:
        data = _get('https://api.bilibili.com/x/player/v2',
                    {'bvid': bvid, 'cid': cid})
    subs = data.get('data', {}).get('subtitle', {}).get('subtitles', [])
    if not subs:
        return []
    subs = sorted(subs, key=lambda s: 0 if s.get('lan', '').startswith('ai') else 1)
    body = _download_subtitle(subs[0]['subtitle_url'])
    lines = [b['content'].strip() for b in body.get('body', []) if b.get('content', '').strip()]
    return lines

# ---------------- SubBatch inbox 解析 ----------------
def parse_inbox_file(path):
    """解析SubBatch导出的 SRT/TXT/JSON/MD 字幕文件，返回行文本列表。"""
    ext = os.path.splitext(path)[1].lower()
    with open(path, 'r', encoding='utf-8-sig', errors='ignore') as f:
        raw = f.read()
    lines = []
    if ext == '.json':
        try:
            body = json.loads(raw).get('body', [])
            return [b['content'].strip() for b in body if b.get('content', '').strip()]
        except Exception:
            pass
    if ext == '.srt':
        for block in re.split(r'\n\s*\n', raw):
            seg = [l for l in block.splitlines() if l.strip()]
            if len(seg) >= 2 and '-->' in seg[1]:
                lines.append(' '.join(seg[2:]).strip())
    elif ext in ('.txt', '.md'):
        for l in raw.splitlines():
            l = l.strip()
            if l:
                lines.append(l)
    else:
        for l in raw.splitlines():
            l = l.strip()
            if l:
                lines.append(l)
    return lines
