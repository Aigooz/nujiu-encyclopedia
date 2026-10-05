# -*- coding: utf-8 -*-
"""从百科docx解析出全部视频台账 registry.json。"""
import json, os, re, sys, glob
import docx
from docx.table import Table
from docx.text.paragraph import Paragraph

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def latest_docx():
    files = glob.glob(os.path.join(ROOT, 'nujiu-encyclopedia-v*.docx'))
    def ver(f):
        m = re.search(r'-v(\d+)\.docx$', f)
        return int(m.group(1)) if m else 0
    return max(files, key=ver) if files else None

def build(docx_path=None):
    path = docx_path or latest_docx()
    if not path:
        print('未找到nujiu-encyclopedia-v*.docx')
        return None
    d = docx.Document(path)
    body = d.element.body
    items = []
    for child in body.iterchildren():
        if child.tag.endswith('}p'):
            items.append(('p', Paragraph(child, d)))
        elif child.tag.endswith('}tbl'):
            items.append(('t', Table(child, d)))
    videos = []
    cur = None
    for kind, obj in items:
        txt = obj.text.strip() if kind == 'p' else ''
        if kind == 'p' and obj.style.name == 'Heading 3' and re.match(r'^第\d+部', txt):
            if cur:
                videos.append(cur)
            m = re.match(r'^第(\d+)部\s+(.*)$', txt)
            cur = {'no': int(m.group(1)), 'title': m.group(2).strip(),
                   'date': None, 'type': '其他', 'account': '主号', 'intro_count': 0,
                   'sub_lines': 0, 'sub_chars': 0, 'bvid': None}
        elif kind == 't' and cur is not None and cur['bvid'] is None:
            hdr = [c.text.strip() for c in obj.rows[0].cells]
            if hdr[:2] == ['项目', '内容']:
                for row in obj.rows[1:]:
                    k = row.cells[0].text.strip()
                    v = row.cells[1].text.strip()
                    if k == '投稿时间':
                        cur['date'] = v.replace('/', '-')
                    elif k == '视频类型':
                        cur['type'] = v or '其他'
                    elif k == '账号':
                        cur['account'] = v or '主号'
                    elif k == '自我介绍次数':
                        m = re.search(r'(\d+)', v)
                        cur['intro_count'] = int(m.group(1)) if m else 0
                    elif k == '字幕行数':
                        m = re.search(r'(\d+)', v)
                        cur['sub_lines'] = int(m.group(1)) if m else 0
                    elif k == '字幕字数':
                        m = re.search(r'(\d+)', v)
                        cur['sub_chars'] = int(m.group(1)) if m else 0
                    elif k == '视频链接':
                        m = re.search(r'(BV[0-9A-Za-z]+)', v)
                        cur['bvid'] = m.group(1) if m else None
                        break
    if cur:
        videos.append(cur)
    videos.sort(key=lambda v: v['no'])
    m = re.search(r'-v(\d+)\.docx$', path)
    reg = {'docx_version': f'v{m.group(1)}' if m else 'v1',
           'total_sub_lines': sum(v['sub_lines'] for v in videos),
           'videos': videos}
    out = os.path.join(ROOT, 'registry.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(reg, f, ensure_ascii=False, indent=1)
    print(f'解析 {path}')
    print(f'共 {len(videos)} 部视频，字幕总行数 {reg["total_sub_lines"]}')
    print(f'台账已保存: {out}')
    return reg

if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv) > 1 else None)
