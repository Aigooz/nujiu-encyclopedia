#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 site/data.js 读取网站分析维度，同步丰富两个 Excel 表格。

新增列（不在用户排除列表中）：
  数据总表:  发布时段, 主要关键词, 弹幕峰值数, 简介字数, 封面链接
  网站联动:  发布时段, 弹幕峰值数, 标题关键词, 简介字数, 封面链接
同时移除用户明确排除的冗余列。
"""

import json
import re
import shutil
import datetime as dt
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

PROJECT = Path(__file__).resolve().parents[1]
XLSX_DIR = PROJECT.parent
SITE_DATA = PROJECT / "site" / "data.js"
MAIN_FILE = XLSX_DIR / "@怒九笑 相关.xlsx"
SMALL_FILE = XLSX_DIR / "@怒九摸鱼馆 相关.xlsx"
BACKUP_DIR = XLSX_DIR / "backup_xlsx"

HEADER_FILL = PatternFill("solid", fgColor="4F46E5")
NEW_FILL = PatternFill("solid", fgColor="7C3AED")


raw = SITE_DATA.read_text(encoding="utf-8")
payload = raw[raw.index("=") + 1:].strip().rstrip(";")
site = json.loads(payload)
videos = site.get("videos", [])
print(f"读取 site/data.js：{len(videos)} 条视频")

video_map = {}
for v in videos:
    bvid = v.get("bvid", "")
    if bvid:
        video_map[bvid] = v


def extract_keywords(title):
    text = (title or "").lower()
    keywords = []
    tests = [
        ("Warma", r"warma|沃玛"), ("怒九", r"怒九"), ("捏碳", r"捏碳|捏碳碳碳碳"),
        ("四迹", r"四迹"), ("合作视频", r"warma|沃玛|捏碳|四迹|怒九|艺术就是|撩到我"),
        ("直播录像", r"直播录像"),
        ("游戏实况", r"实况|游戏|试玩"), ("爆炸电台", r"爆炸电台"),
        ("爆米花电台", r"爆米花电台"), ("电台", r"电台"),
        ("翻唱", r"翻唱|合唱|唱歌"), ("配音", r"配音|中文配音"),
        ("手书", r"手书"), ("小剧场", r"小剧场"), ("绘画", r"画画|绘画|手绘"),
        ("自制游戏", r"自制游戏|游戏介绍"), ("星露谷物语", r"星露谷"),
        ("Splatoon", r"splatoon"), ("塞尔达", r"塞尔达|旷野之息"),
        ("Undertale", r"undertale"), ("Celeste", r"celeste"), ("奥里", r"奥里"),
        ("双影奇境", r"双影奇境"), ("双人实况", r"双影奇境|双人"),
        ("恐怖游戏", r"恐怖"), ("恋爱", r"恋爱|情侣|告白"),
        ("生活日常", r"日常|生活|做饭|种田|旅行|老家"), ("鬼畜", r"鬼畜"),
        ("动森", r"动物森|岛上"), ("Subnautica", r"subnautica|异星水域"),
        ("Minecraft", r"minecraft|我的世界"), ("Party", r"party|派对"),
        ("音乐游戏", r"音游|音乐游戏"),
    ]
    for name, pattern in tests:
        if re.search(pattern, text):
            keywords.append(name)
    return "、".join(keywords) if keywords else ""


def pub_hour(v):
    pub = v.get("pubdate_iso") or ""
    m = re.match(r"\d{4}-\d{2}-\d{2} (\d{2}):\d{2}", pub)
    return f"{m.group(1)}:00" if m else ""


def peak_count(v):
    return len(v.get("peaks") or [])


def desc_len(v):
    return len(v.get("desc") or "")


def best_peak(v):
    peaks = v.get("peaks") or []
    if not peaks:
        return ""
    top = max(peaks, key=lambda p: p.get("count", 0))
    t = top.get("t", 0)
    m, s = divmod(int(t), 60)
    return f"{m}:{s:02d}"


def top_sample(v):
    peaks = v.get("peaks") or []
    if not peaks:
        return ""
    top = max(peaks, key=lambda p: p.get("count", 0))
    samples = top.get("samples") or []
    return " | ".join(samples[:3]) if samples else ""


def backup(path):
    if not path.exists():
        return
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    target = BACKUP_DIR / f"{path.stem}-{stamp}{path.suffix}"
    shutil.copy2(path, target)
    print(f"  备份: {target.name}")


MAIN_HEADERS = [
    "序号", "标题", "BV号", "AV号", "投稿日期", "内容类型",
    "时长(秒)", "时长", "距上次投稿(天)", "间隔等级",
    "发布时段", "主要关键词", "弹幕峰值数", "简介字数",
    "视频链接", "封面链接", "数据来源", "备注",
]


def find_old_data(wb):
    """从旧 workbook 找到数据总表位置并读出保留列。"""
    for name in wb.sheetnames:
        ws = wb[name]
        if ws.max_row and ws.max_row > 1:
            headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
            hl = [str(h or "") for h in headers]
            if "序号" in hl and "标题" in hl and "BV号" in hl and "投稿日期" in hl:
                return ws, hl
    return None, None


def rebuild_data_sheet(wb, wb_data, label):
    """wb 是正常模式（保留公式），wb_data 是 data_only=True 模式（有计算值）。"""
    # 先从 data_only 版读取旧数据总表的所有计算值
    old_data = {}
    old_headers_list = []
    if "数据总表" in wb_data.sheetnames:
        old_ws = wb_data["数据总表"]
        old_headers_list = [old_ws.cell(1, c).value for c in range(1, old_ws.max_column + 1)]
        for r in range(2, old_ws.max_row + 1):
            title = old_ws.cell(r, 2).value
            bvid = old_ws.cell(r, 3).value
            if not title and not bvid:
                continue
            row = {}
            for c in range(1, old_ws.max_column + 1):
                h = old_headers_list[c - 1] if c - 1 < len(old_headers_list) else ""
                if h:
                    row[str(h)] = old_ws.cell(r, c).value
            old_data[r] = row

    # 删除旧 sheet 并创建新的
    if "数据总表" in wb.sheetnames:
        del wb["数据总表"]
    ws = wb.create_sheet("数据总表", 1)
    ws.append(MAIN_HEADERS)
    for c in range(1, len(MAIN_HEADERS) + 1):
        cell = ws.cell(1, c)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center")

    rows = []
    for r in sorted(old_data.keys()):
        rows.append(old_data[r])

    print(f"  [{label}] 数据总表 {len(rows)} 行")
    for i, row in enumerate(rows, 1):
        r = i + 1
        bvid = str(row.get("BV号") or "").strip()
        v = video_map.get(bvid, {})
        ws.cell(r, 1, i)
        ws.cell(r, 2, row.get("标题"))
        ws.cell(r, 3, bvid)
        ws.cell(r, 4, row.get("AV号") or v.get("aid"))
        ws.cell(r, 5, row.get("投稿日期"))
        ws.cell(r, 6, row.get("内容类型") or v.get("type"))
        dur = row.get("时长(秒)") or v.get("duration")
        ws.cell(r, 7, int(dur) if dur else None)
        ws.cell(r, 8, f'=IF($G{r}="","",TEXT($G{r}/86400,"[h]:mm:ss"))')
        ws.cell(r, 9, f'=IF(OR($B{r}="",$E{r}=""),"",$E{r}-$E{r-1})')
        ws.cell(r, 10, f'=IF($I{r}="","",IF($I{r}<=7,"≤7天",IF($I{r}<=30,"≤30天",IF($I{r}<=90,"≤90天",">90天"))))')
        ws.cell(r, 11, pub_hour(v))
        ws.cell(r, 12, extract_keywords(v.get("title") or ""))
        ws.cell(r, 13, peak_count(v) or None)
        ws.cell(r, 14, desc_len(v) or None)
        link = f"https://www.bilibili.com/video/{bvid}" if bvid else (row.get("视频链接") or "")
        ws.cell(r, 15, link)
        ws.cell(r, 16, v.get("pic") or "")
        ws.cell(r, 17, row.get("数据来源"))
        ws.cell(r, 18, row.get("备注"))

    widths = [6, 50, 15, 12, 12, 16, 10, 10, 16, 10, 10, 22, 10, 10, 40, 40, 22, 18]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "C2"
    last_row = max(2, len(rows) + 1)
    ws.auto_filter.ref = f"A1:{get_column_letter(len(MAIN_HEADERS))}{last_row}"

    for r in range(2, last_row + 1):
        ws.cell(r, 5).number_format = "yyyy-mm-dd"
        ws.cell(r, 7).number_format = "#,##0"
        ws.cell(r, 2).alignment = Alignment(vertical="center", wrap_text=False)


SITE_NEW_COLS = [
    ("发布时段", lambda v: pub_hour(v), 10),
    ("弹幕峰值数", lambda v: peak_count(v) or None, 10),
    ("峰值时间", lambda v: best_peak(v), 10),
    ("峰值弹幕样例", lambda v: top_sample(v), 30),
    ("标题关键词", lambda v: extract_keywords(v.get("title") or ""), 22),
    ("简介字数", lambda v: desc_len(v) or None, 10),
    ("封面链接", lambda v: v.get("pic") or "", 40),
]


def enrich_site_sheet(wb, wb_data, label):
    """用 data_only 版本读取 BV 号等值。"""
    if "网站联动" not in wb.sheetnames:
        print(f"  [{label}] 未找到网站联动 sheet")
        return
    ws = wb["网站联动"]
    ws_data = wb_data["网站联动"] if "网站联动" in wb_data.sheetnames else None
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    bvid_col = None
    for i, h in enumerate(headers):
        if h and "BV" in str(h):
            bvid_col = i + 1
            break
    if not bvid_col:
        print(f"  [{label}] 网站联动无 BV 号列")
        return

    # 新建网站联动的 BV 列是公式；改用数据总表的 BV 原值，按行号一一映射。
    bvids_by_row = {}
    data_ws = wb_data.get("数据总表") if hasattr(wb_data, "get") else None
    if data_ws is None and "数据总表" in wb_data.sheetnames:
        data_ws = wb_data["数据总表"]
    if data_ws:
        data_headers = [data_ws.cell(1, c).value for c in range(1, data_ws.max_column + 1)]
        data_bv_col = next((i + 1 for i, h in enumerate(data_headers) if h and "BV" in str(h)), None)
        if data_bv_col:
            for r in range(2, data_ws.max_row + 1):
                val = data_ws.cell(r, data_bv_col).value
                if val:
                    bvids_by_row[r] = str(val).strip()
    elif ws_data:
        for r in range(2, ws_data.max_row + 1):
            val = ws_data.cell(r, bvid_col).value
            if val:
                bvids_by_row[r] = str(val).strip()

    headers_map = {str(h): i + 1 for i, h in enumerate(headers) if h}
    start_col = ws.max_column + 1
    for col_name, fn, width in SITE_NEW_COLS:
        c = headers_map.get(col_name, start_col)
        if c == start_col:
            start_col += 1
        cell = ws.cell(1, c, col_name)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = NEW_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center")
        for r in range(2, ws.max_row + 1):
            bvid = bvids_by_row.get(r, "")
            v = video_map.get(bvid)
            if v:
                val = fn(v)
                if val is not None:
                    ws.cell(r, c, val)
        ws.column_dimensions[get_column_letter(c)].width = width

    aid_col = link_col = None
    for i, h in enumerate(headers):
        hs = str(h or "")
        if "AV" in hs:
            aid_col = i + 1
        if "链接" in hs and "封面" not in hs and "B站" not in hs:
            link_col = i + 1
    for r in range(2, ws.max_row + 1):
        bvid = bvids_by_row.get(r, "")
        v = video_map.get(bvid)
        if not v:
            continue
        if aid_col and not ws.cell(r, aid_col).value:
            ws.cell(r, aid_col, v.get("aid"))
        if link_col and not ws.cell(r, link_col).value:
            ws.cell(r, link_col, f"https://www.bilibili.com/video/{bvid}")

    print(f"  [{label}] 网站联动追加 {len(SITE_NEW_COLS)} 列")


def process(filepath, label):
    print(f"\n=== {label} ===")
    if not filepath.exists():
        print(f"  文件不存在: {filepath}")
        return
    backup(filepath)
    wb = load_workbook(filepath)
    wb_data = load_workbook(filepath, data_only=True)
    rebuild_data_sheet(wb, wb_data, label)
    enrich_site_sheet(wb, wb_data, label)
    wb.save(filepath)
    wb.close()
    print(f"  已保存: {filepath.name}")


if __name__ == "__main__":
    process(MAIN_FILE, "主号 @怒九笑 相关")
    process(SMALL_FILE, "小号 @怒九摸鱼馆 相关")
    print("\n完成！")
