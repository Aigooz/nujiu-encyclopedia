# -*- coding: utf-8 -*-
"""怒九百科自动更新主程序。

用法（在百科目录下执行）：
  python tools/update.py status   查看台账状态
  python tools/update.py check    检查B站是否有新投稿（需Cookie）
  python tools/update.py run      全自动：拉新视频+下载字幕+写入百科
  python tools/update.py ingest   半自动：解析 inbox/ 里SubBatch导出的字幕并写入百科
  python tools/update.py watch    常驻轮询模式
"""
import os, sys, json, re, time, glob, configparser, datetime, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import bili_api
from analyze import analyze
from registry import latest_docx, build as rebuild_registry
from build_docx import DocPatcher

REG_PATH = os.path.join(ROOT, 'registry.json')
SUB_DIR = os.path.join(ROOT, 'subtitles')
INBOX_DIR = os.path.join(ROOT, 'inbox')

def load_reg():
    if os.path.exists(REG_PATH):
        with open(REG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    print('registry.json 不存在，正在从docx生成...')
    rebuild_registry()
    with open(REG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_reg(reg):
    with open(REG_PATH, 'w', encoding='utf-8') as f:
        json.dump(reg, f, ensure_ascii=False, indent=1)

def known_bvids(reg):
    return {v['bvid'] for v in reg['videos'] if v.get('bvid')}

def last_date(reg):
    ds = sorted(v['date'] for v in reg['videos'] if v['date'])
    return ds[-1].replace('-', '') if ds else None

def check_new(reg):
    cfg = bili_api.load_config()
    mids = []
    m = cfg.get('bili', 'uid_main', fallback='14751040').strip()
    if m:
        mids.append(m)
    alt = cfg.get('bili', 'uid_alt', fallback='').strip()
    if alt:
        mids.append(alt)
    if not mids:
        raise RuntimeError('config.ini 未配置UP主UID')
    known = known_bvids(reg)
    fresh = []
    for mid in mids:
        try:
            vids = bili_api.get_user_videos(mid, ps=30, max_pages=3)
        except RuntimeError:
            print('[提示] 主接口被风控，使用免Cookie接口...')
            vids = bili_api.get_user_videos_free(mid, ps=30, max_pages=3)
        for v in vids:
            if v['bvid'] not in known:
                fresh.append(v)
    seen, uniq = set(), []
    for v in sorted(fresh, key=lambda x: x['created']):
        if v['bvid'] not in seen:
            seen.add(v['bvid'])
            uniq.append(v)
    return uniq

def fetch_new(reg, fresh=None):
    fresh = fresh if fresh is not None else check_new(reg)
    os.makedirs(SUB_DIR, exist_ok=True)
    done = []
    for v in fresh:
        bv = v['bvid']
        out = os.path.join(SUB_DIR, bv + '.json')
        if os.path.exists(out):
            print(f'[跳过] {bv} 已有字幕缓存')
            done.append(out)
            continue
        try:
            info = bili_api.get_video_info(bv)
            lines = bili_api.get_subtitle_lines(bv, info['cid'])
            payload = {'bvid': bv, 'title': info['title'], 'desc': info['desc'],
                       'pubdate': info['pubdate'], 'owner_mid': info['owner_mid'],
                       'owner_name': info['owner_name'], 'lines': lines}
            with open(out, 'w', encoding='utf-8') as f:
                json.dump(payload, f, ensure_ascii=False, indent=1)
            print(f'[下载] {bv} {info["title"][:30]} 字幕{len(lines)}行'
                  + ('' if lines else '  <- 无CC/AI字幕，建议用SubBatch导出后放inbox/'))
            done.append(out)
            time.sleep(0.6)
        except Exception as e:
            print(f'[失败] {bv}: {e}')
    return done

def write_entries(reg, payloads):
    if not payloads:
        print('没有需要写入的新视频。')
        return
    src = latest_docx()
    patcher = DocPatcher(src)
    reg_videos = reg['videos']
    next_no = max(v['no'] for v in reg_videos) + 1
    prev_date = reg_videos[-1].get('date') if reg_videos else None
    new_rows = []
    for p in payloads:
        with open(p, 'r', encoding='utf-8') as f:
            data = json.load(f)
        lines = data.get('lines') or []
        if not lines:
            print(f"[警告] {data['bvid']} 无字幕，跳过写入")
            continue
        date = datetime.datetime.fromtimestamp(data['pubdate']).strftime('%Y-%m-%d')
        account = f"主号（{data.get('owner_name')}）" if data.get('owner_name') == '怒九笑' else f"小号（{data.get('owner_name')}）"
        a = analyze(data['title'], lines, data.get('desc', ''))
        if prev_date:
            d0 = datetime.datetime.strptime(prev_date, '%Y-%m-%d')
            d1 = datetime.datetime.strptime(date, '%Y-%m-%d')
            gap = (d1 - d0).days
            gap_note = f'{gap} 天' if gap >= 0 else f'回补（早于上一部{abs(gap)}天）'
        else:
            gap, gap_note = None, '首期投稿'
        v = {'no': next_no, 'title': data['title'], 'date': date, 'type': '其他',
             'account': account, 'intro_count': a['intro_count'],
             'sub_lines': len(lines), 'sub_chars': len(''.join(lines)),
             'bvid': data['bvid'], 'analysis': a, 'gap_note': gap_note,
             'gap_days': f'{gap} 天' if gap is not None else '首期投稿',
             'reading': a.get('reading')}
        new_rows.append(v)
        next_no += 1
        prev_date = date
        reg_videos.append({k: v[k] for k in ('no', 'title', 'date', 'type', 'account',
                                             'intro_count', 'sub_lines', 'sub_chars', 'bvid')})
    if not new_rows:
        return
    patcher.append_entries(new_rows)
    year_counts = {}
    for v in new_rows:
        year_counts.setdefault(int(v['date'][:4]), []).append(
            (v['no'], v['date'].replace('-', '/'), v['title'], v['type']))
    patcher.update_years(year_counts)
    reg['total_sub_lines'] = sum(v['sub_lines'] for v in reg_videos)
    patcher.update_ch1_tables(reg)
    patcher.update_appendix(reg, new_rows)
    patcher.update_cover(reg)
    out = patcher.save_next_version()
    m = re.search(r'-v(\d+)\.docx$', out)
    reg['docx_version'] = f'v{m.group(1)}'
    save_reg(reg)
    print(f'\n已写入 {len(new_rows)} 个新词条 -> {out}')
    print(f'当前台账：{len(reg_videos)} 部视频 | 字幕总行数 {reg["total_sub_lines"]:,}')

def ingest_inbox(reg):
    files = []
    for pat in ('*.json', '*.srt', '*.txt', '*.md'):
        files += glob.glob(os.path.join(INBOX_DIR, pat))
    cfg = bili_api.load_config()
    extra = cfg.get('paths', 'inbox_extra', fallback='')
    for d in [x.strip() for x in extra.split(';') if x.strip()]:
        d = os.path.expandvars(d)
        for pat in ('*nujiu*', '*怒九*'):
            files += glob.glob(os.path.join(d, pat, '**', pat), recursive=True)
    files = sorted(set(files))
    if not files:
        print('inbox/ 里没有待处理的字幕文件。')
        return
    known = known_bvids(reg)
    next_no = max(v['no'] for v in reg['videos']) + 1
    payloads = []
    for fp in files:
        bv = None
        m = re.search(r'(BV[0-9A-Za-z]{10})', os.path.basename(fp))
        if m:
            bv = m.group(1)
        lines = bili_api.parse_inbox_file(fp)
        if not lines:
            print(f'[跳过] {os.path.basename(fp)} 未解析到内容')
            continue
        title = re.sub(r'^(nujiu|怒九)[-_\s]*', '', os.path.splitext(os.path.basename(fp))[0])
        title = re.sub(r'[-_]?(srt|txt|json|md)$', '', title, flags=re.I)
        pubdate = os.path.getmtime(fp)
        payload = {'bvid': bv or f'INBOX_{int(pubdate)}', 'title': title, 'desc': '',
                   'pubdate': pubdate, 'owner_mid': None, 'owner_name': None, 'lines': lines}
        if bv and bv in known:
            print(f'[跳过] {os.path.basename(fp)} 已收录')
            continue
        out = os.path.join(SUB_DIR, (bv or f'inbox_{int(pubdate)}') + '.json')
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
        payloads.append(out)
        print(f'[就绪] {os.path.basename(fp)} -> {len(lines)} 行')
    write_entries(reg, payloads)

def cmd_status():
    reg = load_reg()
    vids = reg['videos']
    print(f'当前百科版本: {reg.get("docx_version")}')
    print(f'收录视频: {len(vids)} 部 | 字幕总行数: {reg["total_sub_lines"]:,}')
    ds = sorted(v["date"] for v in vids if v["date"])
    if ds:
        print(f'时间跨度: {ds[0]} 至 {ds[-1]}')
    print(f'最新词条: 第{vids[-1]["no"]}部 {vids[-1]["title"][:30]}')

def cmd_check():
    reg = load_reg()
    try:
        fresh = check_new(reg)
    except RuntimeError as e:
        print(f'[提示] {e}')
        return
    if not fresh:
        print('没有发现新投稿。')
        return
    print(f'发现 {len(fresh)} 个新投稿：')
    for v in fresh:
        print(' -', datetime.datetime.fromtimestamp(v['created']).strftime('%Y-%m-%d'),
              v['bvid'], v['title'][:40])

def cmd_run():
    reg = load_reg()
    print('== 检查新投稿 ==')
    try:
        fresh = check_new(reg)
    except RuntimeError as e:
        print(f'[提示] {e}')
        print('改用半自动：SubBatch导出字幕放入 inbox/ 后运行 ingest。')
        return
    if not fresh:
        print('没有新投稿，百科已是最新。')
        return
    print(f'发现 {len(fresh)} 个新投稿，开始下载字幕...')
    payloads = fetch_new(reg, fresh)
    with_sub = []
    for p in payloads:
        with open(p, 'r', encoding='utf-8') as f:
            if json.load(f)['lines']:
                with_sub.append(p)
    print('== 写入百科 ==')
    write_entries(reg, with_sub)

def cmd_ingest():
    reg = load_reg()
    ingest_inbox(reg)

def cmd_watch():
    cfg = bili_api.load_config()
    interval = cfg.getint('update', 'interval_minutes', fallback=60) * 60
    print(f'watch模式：每 {interval // 60} 分钟检查一次。Ctrl+C 退出。')
    while True:
        try:
            cmd_run()
        except Exception as e:
            print('[错误]', e)
        time.sleep(interval)

def _cmd_login():
    import subprocess
    subprocess.run([sys.executable, os.path.join(HERE, 'login.py')])

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('command', choices=['status', 'check', 'fetch', 'run', 'ingest', 'watch', 'login'])
    args = ap.parse_args()
    {'status': cmd_status, 'check': cmd_check, 'fetch': lambda: fetch_new(load_reg()),
     'run': cmd_run, 'ingest': cmd_ingest, 'watch': cmd_watch, 'login': _cmd_login}[args.command]()
