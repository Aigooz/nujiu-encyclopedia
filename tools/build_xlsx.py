#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动更新 怒九笑 相关 / 怒九摸鱼馆 相关 两个 Excel 表。

用法:
  python tools/build_xlsx.py            # 读取缓存 + 只补充缺失的 B 站元数据
  python tools/build_xlsx.py --refresh  # 强制重新拉取 B 站元数据
  python tools/build_xlsx.py --skip-fetch # 完全离线，使用当前缓存

核心数据源:
  registry.json                 # 字幕库整理出来的视频清单
  registry.json                # 全量视频台账；本表离线重建时不读取旧表
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo

from openpyxl import Workbook, load_workbook
from openpyxl.chart import BarChart, LineChart, PieChart, Reference
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


# 项目目录（registry.json 所在位置）
PROJECT_DIR = Path(__file__).resolve().parents[1]
# Excel 文件所在目录（比项目目录高一级，即 F:\怒九百科）
XLSX_DIR = Path(__file__).resolve().parents[2]
MAIN_FILE = XLSX_DIR / "@怒九笑 相关.xlsx"
SMALL_FILE = XLSX_DIR / "@怒九摸鱼馆 相关.xlsx"
REGISTRY_FILE = PROJECT_DIR / "registry.json"
CACHE_FILE = PROJECT_DIR / "tools" / "bili_meta_cache.json"
SITE_DATA_FILE = PROJECT_DIR / "site" / "data.js"
COMMENTS_FILE = PROJECT_DIR / "tools" / "bili_comments_cache.json"
BACKUP_DIR = XLSX_DIR / "backup_xlsx"

CN_WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
HEADER_FILL = PatternFill("solid", fgColor="4F46E5")
SUBHEAD_FILL = PatternFill("solid", fgColor="E0E7FF")
WARN_FILL = PatternFill("solid", fgColor="FEF3C7")
GOOD_FILL = PatternFill("solid", fgColor="DCFCE7")
BAD_FILL = PatternFill("solid", fgColor="FEE2E2")
CARD_FILL = PatternFill("solid", fgColor="EEF2FF")
THIN_GRAY = Side(style="thin", color="D1D5DB")
BORDER = Border(left=THIN_GRAY, right=THIN_GRAY, top=THIN_GRAY, bottom=THIN_GRAY)


def log(message: str) -> None:
    print(message, flush=True)


def normalize_title(value) -> str:
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff#]+", "", str(value or "")).lower()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def read_js_json(path: Path):
    raw = path.read_text(encoding="utf-8")
    start = raw.index("=") + 1
    payload, _ = json.JSONDecoder().raw_decode(raw[start:].lstrip())
    return payload


def excel_time_to_seconds(value) -> float | int | None:
    if value in (None, ""):
        return None
    if isinstance(value, dt.time):
        return value.hour * 3600 + value.minute * 60 + value.second
    if isinstance(value, dt.datetime):
        return value.hour * 3600 + value.minute * 60 + value.second
    if isinstance(value, (int, float)):
        # openpyxl 有时会把 Excel 时间读成天数。
        return round(float(value) * 86400) if 0 < float(value) < 2 else float(value)
    text = str(value).strip()
    parts = re.findall(r"\d+", text)
    if not parts:
        return None
    nums = [int(x) for x in parts]
    if len(nums) >= 3:
        return nums[-3] * 3600 + nums[-2] * 60 + nums[-1]
    if len(nums) == 2:
        return nums[0] * 60 + nums[1]
    return nums[0]


def read_history_rows(path: Path, max_rows: int = 1200):
    """只读取旧表第一页的核心列，避免读取异常膨胀的工作表维度。"""
    rows = []
    if not path.exists():
        return rows
    wb = load_workbook(path, data_only=True, read_only=True)
    ws = wb.worksheets[0]
    for row in ws.iter_rows(min_row=2, max_row=min(ws.max_row, max_rows), max_col=13, values_only=True):
        title = row[1]
        if not title:
            continue
        link = row[11] or row[6] or ""
        match = re.search(r"(BV[0-9A-Za-z]{10})", str(link))
        rows.append(
            {
                "old_no": row[0],
                "title": str(title).strip(),
                "date": row[3],
                "duration_seconds": excel_time_to_seconds(row[4]),
                "link": str(link) if link else None,
                "bvid": match.group(1) if match else None,
            }
        )
    wb.close()
    return rows


def fetch_bili_meta(bvid: str, cookie: str | None = None):
    url = "https://api.bilibili.com/x/web-interface/view?" + urllib.parse.urlencode({"bvid": bvid})
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        "Referer": "https://www.bilibili.com/",
        "Accept": "application/json,text/plain,*/*",
    }
    if cookie:
        headers["Cookie"] = cookie
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as response:
                raw = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                payload = json.loads(raw.decode("utf-8"))
            if payload.get("code") == 0:
                return payload.get("data") or {}
            if payload.get("code") in (-400, -404, 62002, 62012):
                return {"_error": payload.get("message", "not found"), "_code": payload.get("code")}
        except Exception as exc:
            if attempt == 2:
                return {"_error": str(exc)}
        time.sleep(0.4 + attempt * 0.7)
    return {"_error": "request failed"}


def refresh_meta_cache(bvids: list[str], force: bool, skip_fetch: bool) -> dict:
    cache = read_json(CACHE_FILE) if CACHE_FILE.exists() else {}
    if skip_fetch:
        missing = [bv for bv in bvids if bv not in cache]
        log(f"离线模式：缺少 {len(missing)} 条 B 站元数据")
        return cache
    todo = [bv for bv in bvids if force or bv not in cache]
    log(f"B 站元数据：缓存 {len(cache) - len([b for b in todo if b in cache])} 条，本次请求 {len(todo)} 条")
    cookie = None
    for index, bvid in enumerate(todo, 1):
        cache[bvid] = fetch_bili_meta(bvid, cookie)
        if index % 25 == 0 or index == len(todo):
            log(f"  已拉取 {index}/{len(todo)}")
        if index % 100 == 0:
            write_json(CACHE_FILE, cache)
        time.sleep(0.14)
    write_json(CACHE_FILE, cache)
    return cache


def build_unified_rows(main_rows: list[dict], small_rows: list[dict], registry_rows: list[dict], meta_cache: dict):
    reg_by_bvid = {row["bvid"]: row for row in registry_rows}
    reg_by_title = {normalize_title(row["title"]): row for row in registry_rows}
    used_registry_bvids = set()

    def api_date(bvid, fallback):
        info = meta_cache.get(bvid) if bvid else None
        pubdate = info.get("pubdate") if isinstance(info, dict) else None
        if pubdate:
            return dt.datetime.fromtimestamp(int(pubdate), ZoneInfo("Asia/Shanghai")).replace(tzinfo=None)
        return fallback

    def make_record(source_row, workbook_account, source_label):
        bvid = source_row.get("bvid")
        reg = reg_by_bvid.get(bvid) or reg_by_title.get(normalize_title(source_row.get("title")))
        if reg:
            bvid = reg["bvid"]
            used_registry_bvids.add(bvid)
        info = meta_cache.get(bvid) if bvid else None
        if not isinstance(info, dict):
            info = {}
        title = info.get("title") or (reg or {}).get("title") or source_row.get("title")
        date = api_date(bvid, source_row.get("date"))
        duration = info.get("duration") or source_row.get("duration_seconds")
        stat = info.get("stat") or {}
        return {
            "title": title,
            "bvid": bvid,
            "aid": info.get("aid") or (str(source_row.get("old_no")) if False else None),
            "date": date,
            "year": date.year if isinstance(date, dt.datetime) else None,
            "month": date.month if isinstance(date, dt.datetime) else None,
            "type": (reg or {}).get("type") or info.get("tname") or None,
            "account": (reg or {}).get("account") or workbook_account,
            "duration_seconds": int(duration) if duration not in (None, "") else None,
            "sub_lines": (reg or {}).get("sub_lines"),
            "sub_chars": (reg or {}).get("sub_chars"),
            "view": stat.get("view"),
            "danmaku": stat.get("danmaku"),
            "reply": stat.get("reply"),
            "favorite": stat.get("favorite"),
            "coin": stat.get("coin"),
            "share": stat.get("share"),
            "like": stat.get("like"),
            "link": f"https://www.bilibili.com/video/{bvid}" if bvid else source_row.get("link"),
            "source": source_label + (" + 字幕库" if reg else " + B站API" if bvid else " + 历史表格"),
            "note": "历史表保留记录" if not reg else None,
        }

    unified = []
    unmatched_main = []
    unmatched_small = []

    for row in main_rows:
        matched_bvid = row.get("bvid")
        matched = bool(matched_bvid and matched_bvid in reg_by_bvid) or normalize_title(row.get("title")) in reg_by_title
        record = make_record(row, "主号（怒九笑）", "历史主号表")
        unified.append(record)
        if not matched:
            unmatched_main.append(record)

    for row in small_rows:
        matched_bvid = row.get("bvid")
        matched = bool(matched_bvid and matched_bvid in reg_by_bvid) or normalize_title(row.get("title")) in reg_by_title
        record = make_record(row, "小号（怒九摸鱼馆）", "历史小号表")
        unified.append(record)
        if not matched:
            unmatched_small.append(record)

    existing_keys = {
        (normalize_title(row["title"]), str(row["date"])[:10]) for row in unified if row.get("title") and row.get("date")
    }
    for row in registry_rows:
        if row["bvid"] in used_registry_bvids:
            continue
        date = api_date(row["bvid"], dt.datetime.fromisoformat(row["date"]))
        key = (normalize_title(row["title"]), str(date)[:10])
        if key in existing_keys:
            continue
        info = meta_cache.get(row["bvid"]) or {}
        stat = info.get("stat") or {}
        unified.append(
            {
                "title": info.get("title") or row["title"],
                "bvid": row["bvid"],
                "aid": info.get("aid"),
                "date": date,
                "year": date.year,
                "month": date.month,
                "type": row.get("type") or info.get("tname"),
                "account": row.get("account"),
                "duration_seconds": int(info.get("duration")) if info.get("duration") else None,
                "sub_lines": row.get("sub_lines"),
                "sub_chars": row.get("sub_chars"),
                "view": stat.get("view"),
                "danmaku": stat.get("danmaku"),
                "reply": stat.get("reply"),
                "favorite": stat.get("favorite"),
                "coin": stat.get("coin"),
                "share": stat.get("share"),
                "like": stat.get("like"),
                "link": f"https://www.bilibili.com/video/{row['bvid']}",
                "source": "字幕库 + B站API",
                "note": None,
            }
        )

    # 按 BV 去重，再按标题+日期去重。
    seen_bv = set()
    seen_key = set()
    deduped = []
    for row in sorted(unified, key=lambda x: (x["date"] or dt.datetime(1970, 1, 1), x["bvid"] or "", x["title"] or "")):
        if row["bvid"] and row["bvid"] in seen_bv:
            continue
        key = (normalize_title(row["title"]), str(row["date"])[:10])
        if key in seen_key:
            continue
        if row["bvid"]:
            seen_bv.add(row["bvid"])
        seen_key.add(key)
        deduped.append(row)
    return deduped, unmatched_main, unmatched_small


def style_header(ws, row, last_col):
    for col in range(1, last_col + 1):
        cell = ws.cell(row, col)
        cell.fill = HEADER_FILL
        cell.font = Font(color="FFFFFF", bold=True, size=10)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
    ws.row_dimensions[row].height = 26


def set_widths(ws, widths: list[float]):
    for index, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(index)].width = width


def add_note(ws, row, title, text, fill=None, width=8):
    ws.cell(row, 1, title).font = Font(bold=True, size=12, color="1F2937")
    ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=width)
    cell = ws.cell(row, 2, text)
    cell.alignment = Alignment(vertical="center", wrap_text=True)
    if fill:
        ws.cell(row, 1).fill = fill
        cell.fill = fill


def publish_hour(video: dict) -> str:
    value = str(video.get("pubdate_iso") or "")
    match = re.match(r"\d{4}-\d{2}-\d{2} (\d{2}):\d{2}", value)
    return f"{match.group(1)}:00" if match else ""


def extract_title_keywords(title: str) -> str:
    text = (title or "").lower()
    keywords = []
    tests = [
        ("怒九", r"怒九"), ("杂菌", r"杂菌"), ("合作视频", r"杂菌|箱眠|怒九|四迹|冷鱼"),
        ("直播录像", r"直播录像"), ("游戏实况", r"实况|游戏|试玩"), ("翻唱", r"翻唱|合唱|唱歌"),
        ("配音", r"配音|中文配音"), ("手书", r"手书"), ("小剧场", r"小剧场"),
        ("绘画", r"画画|绘画|手绘"), ("Minecraft", r"minecraft|我的世界"),
        ("星露谷物语", r"星露谷"), ("双人实况", r"双人|双影奇境"), ("恐怖游戏", r"恐怖"),
        ("生活日常", r"日常|生活|做饭|种田|旅行|老家"), ("鬼畜", r"鬼畜"),
        ("动森", r"动物森|岛上"), ("音乐游戏", r"音游|音乐游戏"),
    ]
    for name, pattern in tests:
        if re.search(pattern, text):
            keywords.append(name)
    return "、".join(keywords)


def peak_count(video: dict):
    return len(video.get("peaks") or [])


def desc_len(video: dict):
    return len(video.get("desc") or "")


def top_peak_sample(video: dict) -> str:
    peak = best_peak(video)
    samples = (peak or {}).get("samples") or []
    return " | ".join(str(sample) for sample in samples[:3])


def write_data_sheet(wb: Workbook, rows: list[dict], site_data: dict | None = None):
    # 删除 openpyxl 默认创建的空 Sheet，避免 wb.active 指向已合并单元格的说明页。
    for name in list(wb.sheetnames):
        sheet = wb[name]
        if (
            sheet.max_row == 1
            and sheet.max_column == 1
            and sheet["A1"].value is None
        ):
            wb.remove(sheet)
            break
    ws = wb.create_sheet("数据总表")
    ws.title = "数据总表"
    video_by_bvid = {video.get("bvid"): video for video in (site_data or {}).get("videos", []) if video.get("bvid")}
    headers = [
        "序号", "标题", "BV号", "AV号", "投稿日期", "内容类型", "时长(秒)", "时长",
        "距上次投稿(天)", "间隔等级", "发布时段", "主要关键词", "弹幕峰值数", "简介字数",
        "视频链接", "封面链接", "数据来源", "备注",
    ]
    ws.append(headers)
    style_header(ws, 1, len(headers))

    for index, row in enumerate(rows, 1):
        r = index + 1
        ws.cell(r, 1, index)
        ws.cell(r, 2, row["title"])
        ws.cell(r, 3, row["bvid"])
        ws.cell(r, 4, row["aid"])
        ws.cell(r, 5, row["date"])
        ws.cell(r, 6, row["type"])
        ws.cell(r, 7, row["duration_seconds"])
        ws.cell(r, 8, f'=IF($G{r}="","",TEXT($G{r}/86400,"[h]:mm:ss"))')
        ws.cell(r, 9, f'=IF(OR($B{r}="",$E{r}=""),"",$E{r}-$E{r-1})')
        ws.cell(r, 10, f'=IF($I{r}="","",IF($I{r}<=7,"≤7天",IF($I{r}<=30,"≤30天",IF($I{r}<=90,"≤90天",">90天"))))')
        video = video_by_bvid.get(row["bvid"] or "") or {}
        ws.cell(r, 11, publish_hour(video))
        ws.cell(r, 12, extract_title_keywords(row.get("title") or ""))
        ws.cell(r, 13, peak_count(video) or None)
        ws.cell(r, 14, desc_len(video) or None)
        ws.cell(r, 15, row.get("link") or (f"https://www.bilibili.com/video/{row['bvid']}" if row.get("bvid") else ""))
        ws.cell(r, 16, video.get("pic") or "")
        ws.cell(r, 17, row.get("source"))
        ws.cell(r, 18, row.get("note"))

    last_row = len(rows) + 1
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = f"A1:R{last_row}"
    ws.conditional_formatting.add(
        f"I2:I{last_row}",
        CellIsRule(operator="greaterThan", formula=["90"], fill=BAD_FILL, font=Font(color="B91C1C", bold=True)),
    )
    ws.conditional_formatting.add(
        f"G2:G{last_row}",
        FormulaRule(formula=['AND($B2<>"",$G2="")'], fill=WARN_FILL),
    )
    ws.conditional_formatting.add(
        f"M2:M{last_row}",
        FormulaRule(formula=['AND($B2<>"",$M2>=10)'], fill=GOOD_FILL),
    )
    set_widths(
        ws,
        [6, 50, 15, 12, 12, 16, 10, 10, 16, 10, 10, 22, 10, 10, 40, 40, 22, 18],
    )
    for r in range(2, last_row + 1):
        ws.cell(r, 5).number_format = "yyyy-mm-dd"
        ws.cell(r, 7).number_format = "#,##0"
        ws.cell(r, 2).alignment = Alignment(vertical="center", wrap_text=False)
        ws.row_dimensions[r].height = 18
    return ws


def write_dashboard(wb: Workbook, rows: list[dict], years: list[int]):
    data_rows = len(rows)
    ws = wb.create_sheet("仪表盘")
    ws["A1"] = "怒九 数据仪表盘"
    ws["A2"].font = Font(size=10, color="6B7280")
    ws["A3"] = "指标"; ws["B3"] = "数值"
    style_header(ws, 3, 2)
    last = data_rows + 1
    kpis = [
        ("视频总数", f"=COUNTA('数据总表'!$B$2:$B${last})"),
        ("总时长(小时)", f"=ROUND(SUM('数据总表'!$G$2:$G${last})/3600,1)"),
        ("平均时长(分钟)", f"=IFERROR(ROUND(AVERAGE('数据总表'!$G$2:$G${last})/60,1),\"\")"),
        ("最新投稿日期", f"=IFERROR(TEXT(MAX('数据总表'!$E$2:$E${last}),\"yyyy-mm-dd\"),\"-\")"),
        ("平均间隔(天)", f"=IFERROR(ROUND(AVERAGE('数据总表'!$I$2:$I${last}),1),\"\")"),
        ("内容类型数", f"=COUNTA('类型分析'!$A$2:$A${wb['类型分析'].max_row})"),
        ("最早投稿日期", f"=IFERROR(TEXT(MIN('数据总表'!$E$2:$E${last}),\"yyyy-mm-dd\"),\"-\")"),
    ]
    for index, (label, formula) in enumerate(kpis):
        r = 4 + index
        ws.cell(r, 1, label)
        ws.cell(r, 2, formula)
        for c in (1, 2):
            ws.cell(r, c).border = BORDER


    # T-AE 静态数据块（与 Warma 布局完全一致），4 张图表引用这些块。
    headers_static = [("年份", "视频数"), ("年份", "总时长(小时)"), ("内容类型", "视频数"), ("时长段", "视频数")]
    for (h1, h2), base_col in zip(headers_static, (21, 24, 27, 30)):
        ws.cell(1, base_col, h1); ws.cell(1, base_col + 1, h2)
        ws.cell(1, base_col).font = Font(bold=True, size=10)
        ws.cell(1, base_col + 1).font = Font(bold=True, size=10)

    for i, y in enumerate(years):
        ws.cell(2 + i, 21, y)
        year_count = sum(1 for row in rows if row.get("date") and row["date"].year == y)
        ws.cell(2 + i, 22, year_count)
        ws.cell(2 + i, 24, y)
        year_hours = sum(row.get("duration_seconds") or 0 for row in rows if row.get("date") and row["date"].year == y)
        ws.cell(2 + i, 25, round(year_hours / 3600, 1))
    type_counter = Counter(row.get("type") for row in rows if row.get("type"))
    for i, (type_name, count) in enumerate(type_counter.most_common()):
        ws.cell(2 + i, 27, type_name)
        ws.cell(2 + i, 28, count)
    buckets_static = [
        ("0-59秒", 0, 59), ("1-2分钟", 60, 119), ("2-5分钟", 120, 299), ("5-10分钟", 300, 599),
        ("10-30分钟", 600, 1799), ("30-60分钟", 1800, 3599), ("1-2小时", 3600, 7199), (">2小时", 7200, 10**9),
    ]
    for i, (name, low, high) in enumerate(buckets_static):
        ws.cell(2 + i, 30, name)
        ws.cell(2 + i, 31, sum(1 for row in rows if low <= (row.get("duration_seconds") or 0) <= high))

    chart1 = BarChart()
    chart1.title = "年度视频数"
    chart1.height, chart1.width = 7.5, 15
    chart1.add_data(Reference(ws, min_col=22, min_row=1, max_row=1 + len(years)), titles_from_data=True)
    chart1.set_categories(Reference(ws, min_col=21, min_row=2, max_row=1 + len(years)))
    ws.add_chart(chart1, "D4")

    chart2 = BarChart()
    chart2.title = "年度总时长"
    chart2.height, chart2.width = 7.5, 15
    chart2.add_data(Reference(ws, min_col=25, min_row=1, max_row=1 + len(years)), titles_from_data=True)
    chart2.set_categories(Reference(ws, min_col=24, min_row=2, max_row=1 + len(years)))
    ws.add_chart(chart2, "L4")

    chart3 = PieChart()
    chart3.title = "内容类型分布"
    chart3.height, chart3.width = 7.5, 15
    type_count = min(type_counter.__len__(), 10)
    chart3.add_data(Reference(ws, min_col=28, min_row=1, max_row=1 + type_count), titles_from_data=True)
    chart3.set_categories(Reference(ws, min_col=27, min_row=2, max_row=1 + type_count))
    ws.add_chart(chart3, "D20")

    chart4 = BarChart()
    chart4.title = "时长分段分布"
    chart4.height, chart4.width = 7.5, 15
    chart4.add_data(Reference(ws, min_col=31, min_row=1, max_row=9), titles_from_data=True)
    chart4.set_categories(Reference(ws, min_col=30, min_row=2, max_row=9))
    ws.add_chart(chart4, "L20")
    set_widths(ws, [16, 14] + [8] * 18)


def write_year_analysis(wb: Workbook, rows: list[dict], data_rows: int):
    ws = wb.create_sheet("年度分析")
    years = sorted({row["date"].year for row in rows if row["date"]})
    headers = ["年份", "视频数", "总时长(小时)", "平均时长(分钟)", "平均间隔(天)"]
    ws.append(headers)
    style_header(ws, 1, len(headers))
    for year in years:
        r = ws.max_row + 1
        ws.cell(r, 1, year)
        date_cond = f"'数据总表'!$E$2:$E${data_rows + 1}"
        cond_ge = f"\">=\"&DATE($A{r},1,1)"
        cond_lt = f"\"<\"&DATE($A{r}+1,1,1)"
        ws.cell(r, 2, f"=COUNTIFS({date_cond},{cond_ge},{date_cond},{cond_lt})")
        ws.cell(r, 3, f"=ROUND(SUMIFS('数据总表'!$G$2:$G${data_rows + 1},{date_cond},{cond_ge},{date_cond},{cond_lt})/3600,1)")
        ws.cell(r, 4, f"=IFERROR(ROUND(AVERAGEIFS('数据总表'!$G$2:$G${data_rows + 1},{date_cond},{cond_ge},{date_cond},{cond_lt})/60,1),\"\")")
        ws.cell(r, 5, f"=IFERROR(ROUND(AVERAGEIFS('数据总表'!$I$2:$I${data_rows + 1},{date_cond},{cond_ge},{date_cond},{cond_lt}),1),\"\")")
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=len(headers)):
        for cell in row:
            cell.border = BORDER
            if cell.column >= 2:
                cell.number_format = "#,##0"
    ws.freeze_panes = "A2"
    set_widths(ws, [10, 10, 14, 16, 16])
    return years


def write_type_analysis(wb: Workbook, rows: list[dict], data_rows: int):
    ws = wb.create_sheet("类型分析")
    type_counts = Counter(row["type"] for row in rows if row["type"])
    headers = ["内容类型", "视频数", "总时长(小时)", "平均时长(分钟)"]
    ws.append(headers)
    style_header(ws, 1, len(headers))
    for type_name, _count in type_counts.most_common():
        r = ws.max_row + 1
        ws.cell(r, 1, type_name)
        ws.cell(r, 2, f"=COUNTIF('数据总表'!$F$2:$F${data_rows + 1},$A{r})")
        ws.cell(r, 3, f"=ROUND(SUMIF('数据总表'!$F$2:$F${data_rows + 1},$A{r},'数据总表'!$G$2:$G${data_rows + 1})/3600,1)")
        ws.cell(r, 4, f"=IFERROR(ROUND(AVERAGEIF('数据总表'!$F$2:$F${data_rows + 1},$A{r},'数据总表'!$G$2:$G${data_rows + 1})/60,1),\"\")")
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=len(headers)):
        for cell in row:
            cell.border = BORDER
            if cell.column in (2, 3):
                cell.number_format = "#,##0"
    ws.freeze_panes = "A2"
    set_widths(ws, [20, 10, 14, 14])


def write_duration_buckets(wb: Workbook, data_rows: int):
    ws = wb.create_sheet("时长分段")
    buckets = [
        ("0-59秒", 0, 59), ("1-2分钟", 60, 119), ("2-5分钟", 120, 299), ("5-10分钟", 300, 599),
        ("10-30分钟", 600, 1799), ("30-60分钟", 1800, 3599), ("1-2小时", 3600, 7199),
        (">2小时", 7200, 10**9),
    ]
    ws.append(["时长段", "视频数"])
    style_header(ws, 1, 2)
    for name, low, high in buckets:
        r = ws.max_row + 1
        ws.cell(r, 1, name)
        ws.cell(r, 2, f"=COUNTIFS('数据总表'!$G$2:$G${data_rows + 1},\">={low}\",'数据总表'!$G$2:$G${data_rows + 1},\"<={high}\")")
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=2):
        for cell in row:
            cell.border = BORDER
            if cell.column == 2:
                cell.number_format = "#,##0"
    ws.freeze_panes = "A2"
    set_widths(ws, [18, 12])


def write_unmatched(wb: Workbook, unmatched: list[dict], label: str):
    ws = wb.create_sheet("未匹配记录")
    ws["A1"] = "未匹配记录"
    ws["A1"].font = Font(size=16, bold=True, color="4F46E5")
    ws["A3"] = "项目"; ws["B3"] = "结果"
    style_header(ws, 3, 2)
    if unmatched:
        ws["A4"] = "未匹配标题列表"
        ws["B4"] = "、".join(item.get("title", "") for item in unmatched[:5])
    else:
        ws["A4"] = "当前未匹配记录"
        ws["B4"] = "无"
    set_widths(ws, [20, 60])


def write_quality(wb: Workbook, data_rows: int):
    ws = wb.create_sheet("数据质量")
    ws["A1"] = "数据质量检查"
    ws["A1"].font = Font(size=16, bold=True)
    last = data_rows + 1
    checks = [
        ("数据行数", f"=COUNTA('数据总表'!$B$2:$B${last})"),
        ("缺失 BV 号", f"=COUNTBLANK('数据总表'!$C$2:$C${last})"),
        ("缺失 AV 号", f"=COUNTBLANK('数据总表'!$D$2:$D${last})"),
        ("缺失投稿日期", f"=COUNTBLANK('数据总表'!$E$2:$E${last})"),
        ("缺失内容类型", f"=COUNTBLANK('数据总表'!$F$2:$F${last})"),
        ("缺失时长", f"=COUNTBLANK('数据总表'!$G$2:$G${last})"),
        ("缺失视频链接", f"=COUNTBLANK('数据总表'!$O$2:$O${last})"),
        ("重复 BV 号", f"=SUMPRODUCT((COUNTIF('数据总表'!$C$2:$C${last},'数据总表'!$C$2:$C${last})>1)*1)"),
        ("重复 AV 号", f"=SUMPRODUCT((COUNTIF('数据总表'!$D$2:$D${last},'数据总表'!$D$2:$D${last})>1)*1)"),
        ("最早投稿日期", f"=IFERROR(TEXT(MIN('数据总表'!$E$2:$E${last}),\"yyyy-mm-dd\"),\"-\")"),
        ("最新投稿日期", f"=IFERROR(TEXT(MAX('数据总表'!$E$2:$E${last}),\"yyyy-mm-dd\"),\"-\")"),
    ]
    ws["A3"] = "检查项"; ws["B3"] = "数量"
    style_header(ws, 3, 2)
    for i, (name, formula) in enumerate(checks):
        r = 4 + i
        ws.cell(r, 1, name)
        ws.cell(r, 2, formula)
        for c in (1, 2):
            ws.cell(r, c).border = BORDER
    for row in ws.iter_rows(min_row=4, max_row=ws.max_row, max_col=2):
        for cell in row:
            cell.border = BORDER
    set_widths(ws, [24, 14])


def write_guide(wb: Workbook):
    ws = wb.create_sheet("使用说明", 0)
    ws["A1"] = "使用说明"
    ws["A1"].font = Font(size=16, bold=True)
    ws["A3"] = "项目"; ws["B3"] = "说明"
    style_header(ws, 3, 2)
    notes = [
        ("数据范围", "以B站用户视频列表为准，覆盖两个账号的全部公开视频。"),
        ("主要字段", "序号、标题、BV号、AV号、投稿日期、内容类型、时长、间隔、视频链接、数据来源、备注。"),
        ("自动更新字段", "时长、距上次投稿(天)、间隔等级、视频链接由公式自动生成。"),
        ("分析表", "年度分析、类型分析、时长分段均由数据总表公式驱动。"),
        ("网站联动", "“网站联动”页按 BV 号回填网站标签、评论、弹幕峰值、热词和荣誉记录。"),
        ("仪表盘", "包含核心指标和 4 张图表。"),
        ("数据来源", "B站用户视频列表与B站元数据。"),
        ("维护方式", "如需刷新，可重新拉取用户视频列表后重建数据总表。"),
    ]
    for i, (title, text) in enumerate(notes):
        r = 4 + i
        ws.cell(r, 1, title)
        ws.cell(r, 2, text)
        for c in (1, 2):
            ws.cell(r, c).border = BORDER
            ws.cell(r, c).alignment = Alignment(vertical="center", wrap_text=True)
    set_widths(ws, [18, 80])


def write_update_log(wb: Workbook, rows_count: int, unmatched_count: int, message: str):
    ws = wb.create_sheet("更新日志")
    ws["A1"] = "更新日志"
    ws["A1"].font = Font(size=16, bold=True)
    ws["A3"] = "时间"; ws["B3"] = "操作"; ws["C3"] = "说明"
    style_header(ws, 3, 3)
    now = dt.datetime.now().strftime("%Y-%m-%d")
    ws.cell(4, 1, now)
    ws.cell(4, 2, "重建数据总表与分析表")
    ws.cell(4, 3, message)
    for c in (1, 2, 3):
        ws.cell(4, c).border = BORDER
    set_widths(ws, [16, 24, 80])


def format_seconds(seconds):
    if seconds in (None, ""):
        return ""
    try:
        seconds = int(seconds)
    except (TypeError, ValueError):
        return ""
    minutes, sec = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}:{minutes:02d}:{sec:02d}" if hours else f"{minutes}:{sec:02d}"


def best_peak(video):
    peaks = video.get("peaks") or []
    return max(peaks, key=lambda item: item.get("count", 0)) if peaks else None


def write_site_linkage(wb: Workbook, rows: list[dict], site_data: dict, comments: dict):
    video_by_bvid = {v.get("bvid"): v for v in (site_data or {}).get("videos", []) if v.get("bvid")}
    headers = [
        "序号", "标题", "BV号", "AV号", "投稿日期", "B站标签",
        "最高赞评论", "评论用户", "评论点赞", "弹幕峰值时间", "峰值弹幕",
        "峰值弹幕样例", "主要梗/热词", "荣誉记录",
        "发布时段", "弹幕峰值数", "峰值时间", "峰值弹幕样例",
        "标题关键词", "简介字数", "封面链接",
    ]
    ws = wb.create_sheet("网站联动")
    ws.append(headers)
    style_header(ws, 1, len(headers))

    for index, row in enumerate(rows, 1):
        r = index + 1
        bvid = row.get("bvid")
        video = video_by_bvid.get(bvid) or {}
        record = comments.get(bvid) or {}
        comment_list = record.get("comments") or []
        best_comment = max(comment_list, key=lambda item: item.get("like", 0)) if comment_list else {}
        peak = best_peak(video)
        peak_samples = (peak or {}).get("samples") or []
        memes = video.get("memes") or []
        honors = [
            h.get("desc") or f"荣誉类型{h.get('type')}"
            for h in (video.get("honors") or [])
            if isinstance(h, dict)
        ]

        ws.cell(r, 1, index)
        ws.cell(r, 2, f"='数据总表'!B{r}")
        ws.cell(r, 3, f"='数据总表'!C{r}")
        ws.cell(r, 4, f"='数据总表'!D{r}")
        ws.cell(r, 5, f"='数据总表'!E{r}")
        ws.cell(r, 6, "、".join(tag.get("name", "") for tag in (video.get("tags") or [])))
        ws.cell(r, 7, best_comment.get("message", ""))
        ws.cell(r, 8, best_comment.get("name", ""))
        ws.cell(r, 9, best_comment.get("like", "") or "")
        ws.cell(r, 10, format_seconds((peak or {}).get("t")))
        ws.cell(r, 11, (peak or {}).get("count", ""))
        ws.cell(r, 12, " | ".join(str(x) for x in peak_samples[:3]))
        ws.cell(r, 13, "、".join(f"{m.get('content', '')}×{m.get('count', 0)}" for m in memes[:4]))
        ws.cell(r, 14, "、".join(honors))
        ws.cell(r, 15, publish_hour(video))
        ws.cell(r, 16, peak_count(video) or "")
        ws.cell(r, 17, format_seconds((peak or {}).get("t")))
        ws.cell(r, 18, " | ".join(str(x) for x in peak_samples[:3]))
        ws.cell(r, 19, extract_title_keywords(row.get("title") or ""))
        ws.cell(r, 20, desc_len(video) or "")
        ws.cell(r, 21, video.get("pic") or "")

    last_row = max(2, len(rows) + 1)
    ws.freeze_panes = "A2"
    set_widths(ws, [7, 42, 19, 13, 11, 12, 11, 10, 11, 10, 10, 10, 10, 10, 35, 46, 15, 10, 12, 10, 34])
    for r in range(2, last_row + 1):
        ws.cell(r, 2).alignment = Alignment(vertical="center", wrap_text=False)
        ws.cell(r, 7).alignment = Alignment(vertical="center", wrap_text=True)
        ws.cell(r, 5).number_format = "yyyy-mm-dd"
        ws.row_dimensions[r].height = 18


def build_workbook(
    rows: list[dict],
    unmatched: list[dict],
    label: str,
    log_message: str,
    output: Path,
    account_filter: str | None = None,
    site_data: dict | None = None,
    comments: dict | None = None,
):
    """account_filter: 例如 "主号" 只保留主号视频，"小号" 保留所有小号。"""
    if account_filter:
        rows = [r for r in rows if (r.get("account") or "").startswith(account_filter)]
    wb = Workbook()
    write_guide(wb)
    data_ws = write_data_sheet(wb, rows, site_data)
    data_rows = len(rows)
    years = write_year_analysis(wb, rows, data_rows)
    write_type_analysis(wb, rows, data_rows)
    write_duration_buckets(wb, data_rows)
    write_dashboard(wb, rows, years)
    write_unmatched(wb, unmatched, label)
    write_quality(wb, data_rows)
    write_update_log(wb, len(rows), len(unmatched), log_message)
    write_site_linkage(wb, rows, site_data or {}, comments or {})
    # 把使用说明放第一页，数据总表第二页。
    wb.move_sheet("数据总表", offset=-(wb.sheetnames.index("数据总表") - 1))
    wb.save(output)


def backup_file(path: Path):
    if not path.exists():
        return
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    target = BACKUP_DIR / f"{path.stem}-{stamp}{path.suffix}"
    shutil.copy2(path, target)
    log(f"已备份：{target}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="强制重新拉取 B 站元数据")
    parser.add_argument("--skip-fetch", action="store_true", help="完全离线，只使用缓存")
    args = parser.parse_args()

    registry_rows = read_json(REGISTRY_FILE)["videos"]
    site_data = read_js_json(SITE_DATA_FILE)
    comments = read_json(COMMENTS_FILE) if COMMENTS_FILE.exists() else {}
    log(f"读取 registry.json：{len(registry_rows)} 条视频")
    main_history = []
    small_history = []
    log("离线重建模式：以 registry.json 为唯一来源，不读取旧表")

    bvids = [row["bvid"] for row in registry_rows if row.get("bvid")]
    bvids += [row["bvid"] for row in main_history + small_history if row.get("bvid")]
    bvids = list(dict.fromkeys(bvids))
    meta_cache = refresh_meta_cache(bvids, args.refresh, args.skip_fetch)
    rows, unmatched_main, unmatched_small = build_unified_rows(main_history, small_history, registry_rows, meta_cache)
    log(f"合并后总数：{len(rows)} 条；未匹配：主号 {len(unmatched_main)}，小号 {len(unmatched_small)}")

    backup_file(MAIN_FILE)
    backup_file(SMALL_FILE)
    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    build_workbook(
        rows,
        unmatched_main,
        "主号历史表",
        f"自动更新：接入 registry.json、B站元数据和公式分析（{stamp}）",
        MAIN_FILE,
        account_filter="主号",
        site_data=site_data,
        comments=comments,
    )
    build_workbook(
        rows,
        unmatched_small,
        "小号历史表",
        f"自动更新：接入 registry.json、B站元数据和公式分析（{stamp}）",
        SMALL_FILE,
        account_filter="小号",
        site_data=site_data,
        comments=comments,
    )
    log("已生成怒九主号表")
    log("已生成怒九小号表")
    log("完成")


if __name__ == "__main__":
    main()
