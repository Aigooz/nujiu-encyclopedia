# -*- coding: utf-8 -*-
"""Generate 16 static visualizations for the Nujiu encyclopedia."""

from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CHARTS = ROOT / "charts"
CHARTS.mkdir(exist_ok=True)

PALETTE = {
    "pink": "#E8919C", "lavender": "#B39DDB", "blue": "#82B1FF", "mint": "#80CBC4",
    "amber": "#FFD54F", "coral": "#FF8A65", "purple": "#CE93D8", "teal": "#4DB6AC",
    "rose": "#F48FB1", "sky": "#81D4FA", "grey": "#CFD8DC",
    "bg": "#FFFFFF", "text": "#37474F", "grid": "#E0E0E0",
}
COLORS = [PALETTE[k] for k in ["pink", "lavender", "blue", "mint", "amber", "coral", "purple", "teal", "rose", "sky"]]

plt.rcParams.update({
    "font.family": ["Microsoft YaHei", "SimHei", "sans-serif"],
    "font.size": 11, "axes.unicode_minus": False,
    "figure.facecolor": PALETTE["bg"], "axes.facecolor": PALETTE["bg"],
    "axes.edgecolor": PALETTE["grid"], "axes.labelcolor": PALETTE["text"],
    "xtick.color": PALETTE["text"], "ytick.color": PALETTE["text"], "text.color": PALETTE["text"],
})

registry = json.loads((ROOT / "registry.json").read_text(encoding="utf-8"))
videos = registry["videos"]
meta = json.loads((ROOT / "tools" / "bili_meta_cache.json").read_text(encoding="utf-8"))
insights = json.loads((ROOT / "tools" / "danmaku_insights.json").read_text(encoding="utf-8"))


def style_ax(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(PALETTE["grid"])
    ax.spines["bottom"].set_color(PALETTE["grid"])
    ax.grid(axis="y", color=PALETTE["grid"], linewidth=0.5, alpha=0.6)
    ax.set_axisbelow(True)


def save(fig, name):
    fig.tight_layout()
    fig.savefig(CHARTS / name, bbox_inches="tight", facecolor="white", dpi=200)
    plt.close(fig)
    print(f"OK {name}")


sorted_videos = sorted([v for v in videos if v.get("date")], key=lambda x: x["date"])
dates = [datetime.strptime(v["date"], "%Y-%m-%d") for v in sorted_videos]
year_counter = Counter(v["date"][:4] for v in sorted_videos)
year_labels = sorted(year_counter)

# 01
fig, ax = plt.subplots(figsize=(10, 5))
bars = ax.bar(year_labels, [year_counter[y] for y in year_labels], color=PALETTE["pink"], width=0.65)
for bar, val in zip(bars, [year_counter[y] for y in year_labels]):
    ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.3, str(val), ha="center", fontweight="bold")
ax.set_title("怒九年度投稿趋势（2017—2026）")
ax.set_xlabel("年份"); ax.set_ylabel("投稿数量"); style_ax(ax)
save(fig, "01_yearly_trend.png")

# 02
type_counter = Counter(v["type"] for v in videos)
main_types = [(t, c) for t, c in type_counter.most_common() if c >= 4]
other = sum(c for t, c in type_counter.most_common() if c < 4)
if other:
    main_types.append(("其他", other))
labels = [t for t, _ in main_types]; sizes = [c for _, c in main_types]
fig, ax = plt.subplots(figsize=(9, 7))
wedges, texts, autotexts = ax.pie(sizes, autopct=lambda p: f"{p:.1f}%\n({round(p*sum(sizes)/100)}部)",
    startangle=90, pctdistance=0.78, colors=COLORS[:len(sizes)], wedgeprops=dict(width=0.42, edgecolor="white", linewidth=2))
for t in autotexts: t.set_fontsize(9); t.set_fontweight("bold"); t.set_color("white")
ax.text(0, 0.06, str(sum(sizes)), ha="center", fontsize=28, fontweight="bold")
ax.text(0, -0.14, "部视频", ha="center", fontsize=13)
ax.legend(wedges, [f"{t} ({c})" for t, c in zip(labels, sizes)], loc="center left", bbox_to_anchor=(1.02, .5), frameon=False)
ax.set_title("怒九视频类型分布")
save(fig, "02_type_donut.png")

# 03
month_matrix = np.zeros((12, len(year_labels)))
for v in sorted_videos:
    month_matrix[int(v["date"][5:7]) - 1, year_labels.index(v["date"][:4])] += 1
fig, ax = plt.subplots(figsize=(12, 5.5))
im = ax.imshow(month_matrix, aspect="auto", cmap="RdPu", vmin=0)
ax.set_xticks(range(len(year_labels))); ax.set_xticklabels(year_labels)
ax.set_yticks(range(12)); ax.set_yticklabels([f"{i}月" for i in range(1, 13)])
for i in range(12):
    for j in range(len(year_labels)):
        val = int(month_matrix[i, j])
        if val:
            ax.text(j, i, str(val), ha="center", va="center", fontsize=8, color="white" if val > month_matrix.max()*.5 else PALETTE["text"])
ax.set_title("月度投稿热力图"); ax.set_xlabel("年份"); fig.colorbar(im, ax=ax, shrink=.8, pad=.02)
save(fig, "03_monthly_heatmap.png")

# 04
fig, ax1 = plt.subplots(figsize=(11, 5))
cum_chars = np.cumsum([v.get("sub_chars", 0) for v in sorted_videos])
cum_lines = np.cumsum([v.get("sub_lines", 0) for v in sorted_videos])
ax1.fill_between(dates, cum_chars / 10000, alpha=.3, color=PALETTE["pink"])
ax1.plot(dates, cum_chars / 10000, color=PALETTE["pink"], lw=2, label="累计字幕字数")
ax1.set_ylabel("累计字幕字数（万）", color=PALETTE["pink"])
ax2 = ax1.twinx(); ax2.plot(dates, cum_lines / 1000, color=PALETTE["lavender"], lw=2, label="累计字幕行数")
ax2.set_ylabel("累计字幕行数（千）", color=PALETTE["lavender"])
ax1.xaxis.set_major_formatter(mdates.DateFormatter("%Y")); ax1.xaxis.set_major_locator(mdates.YearLocator())
ax1.set_title("字幕累计增长趋势"); style_ax(ax1)
ax1.legend(loc="upper left", frameon=False); ax2.spines["top"].set_visible(False)
save(fig, "04_subtitle_growth.png")

# 05
acct_counter = Counter(v.get("account", "未知") for v in videos)
fig, ax = plt.subplots(figsize=(8, 5))
bars = ax.barh(list(acct_counter), list(acct_counter.values()), color=[PALETTE["pink"], PALETTE["blue"]], height=.5)
total = sum(acct_counter.values())
for bar, val in zip(bars, acct_counter.values()):
    ax.text(bar.get_width() + total*.005, bar.get_y() + bar.get_height()/2, f"{val} ({val/total:.1%})", va="center", fontweight="bold")
ax.set_title("主号与小号投稿分布"); ax.set_xlabel("投稿数量")
ax.set_xlim(0, max(acct_counter.values()) * 1.25); style_ax(ax)
ax.grid(axis="x", color=PALETTE["grid"], alpha=.6); ax.grid(axis="y", visible=False)
save(fig, "05_account_dist.png")

# 06
gaps = [(dates[i], (dates[i] - dates[i-1]).days) for i in range(1, len(dates)) if dates[i] > dates[i-1]]
fig, ax = plt.subplots(figsize=(11, 4.5))
ax.scatter([g[0] for g in gaps], [g[1] for g in gaps], s=9, c=PALETTE["pink"], alpha=.38)
ax.axhline(7, color=PALETTE["lavender"], ls="--", label="7天参考线")
ax.axhline(30, color=PALETTE["amber"], ls="--", label="30天参考线")
ax.set_title("投稿间隔分布"); ax.set_ylabel("距上次投稿（天）")
ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y")); ax.xaxis.set_major_locator(mdates.YearLocator())
style_ax(ax); ax.legend(frameon=False)
save(fig, "06_upload_gaps.png")

# 07
top20 = sorted(videos, key=lambda x: x.get("sub_chars", 0), reverse=True)[:20]
fig, ax = plt.subplots(figsize=(10, 8))
y = range(len(top20)); vals = [v.get("sub_chars", 0)/1000 for v in top20]
labels7 = [f"#{v['no']} {v['title'][:14]}" for v in top20]
ax.barh(y, vals, color=PALETTE["lavender"], height=.6)
ax.set_yticks(y); ax.set_yticklabels(labels7, fontsize=8.5); ax.invert_yaxis()
for i, val in enumerate(vals): ax.text(val + .08, i, f"{val:.1f}k", va="center", fontsize=8)
ax.set_title("字幕量最多的 20 部视频"); ax.set_xlabel("字幕字数（千字符）")
ax.grid(axis="x", color=PALETTE["grid"], alpha=.6); ax.grid(axis="y", visible=False)
save(fig, "07_top_subtitle.png")

# 08
intro = defaultdict(int)
for v in sorted_videos:
    intro[f"{v['date'][:4]}{'上' if int(v['date'][5:7]) <= 6 else '下'}"] += v.get("intro_count", 0)
fig, ax = plt.subplots(figsize=(12, 5))
bars = ax.bar(list(intro), list(intro.values()), color=PALETTE["teal"], width=.6)
for bar, val in zip(bars, intro.values()):
    if val: ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + .15, str(val), ha="center", fontsize=9)
ax.set_title("「我是怒九 / 这里是怒九」出现频率（按半年）"); ax.set_ylabel("自我介绍次数")
plt.xticks(rotation=45, ha="right"); style_ax(ax)
save(fig, "08_intro_freq.png")

# 09
TOPIC_MAP = {
    "游戏": ["游戏", "实况", "关卡", "boss", "存档", "地图", "角色", "通关", "steam", "switch", "undertale"],
    "绘画/创作": ["画", "手书", "投稿", "制作", "素材", "剪辑", "视频", "动画", "渲染"],
    "日常生活": ["今天", "昨天", "明天", "家", "出门", "快递", "睡觉", "起床", "学校"],
    "社交/合作": ["朋友", "一起", "我们", "大家", "合作", "队友", "同学", "聊天"],
    "情感": ["喜欢", "爱", "开心", "难过", "感动", "哭", "笑", "生气", "委屈"],
    "音乐": ["歌", "唱", "曲", "音乐", "旋律", "编曲", "伴奏", "翻唱", "原创"],
    "美食": ["吃", "好吃", "美食", "饿", "饭", "菜", "肉", "火锅", "零食", "奶茶"],
    "学习/知识": ["学习", "知识", "数学", "英语", "教材", "课本", "考试", "复习"],
    "直播互动": ["直播", "弹幕", "观众", "礼物", "舰长", "连麦", "提问"],
}
full_text = " ".join(x for v in videos for x in v.get("analysis", {}).get("merged", []))
low = full_text.lower()
topic_scores = {cat: sum(low.count(k) for k in kws) for cat, kws in TOPIC_MAP.items()}
topic_scores = sorted(topic_scores.items(), key=lambda x: -x[1])[:10]
fig, ax = plt.subplots(figsize=(10, 6))
ax.barh([t[0] for t in topic_scores], [t[1] for t in topic_scores], color=COLORS[:len(topic_scores)], height=.6)
ax.invert_yaxis()
for i, (_, val) in enumerate(topic_scores): ax.text(val + max(1, topic_scores[0][1]*.01), i, f"{val:,}", va="center", fontweight="bold")
ax.set_title("话题关键词频次 TOP10"); ax.set_xlabel("关键词出现次数")
ax.grid(axis="x", color=PALETTE["grid"], alpha=.6); ax.grid(axis="y", visible=False)
save(fig, "09_topics.png")

# 10
CATCH = [("诶", r"诶"), ("哇", r"哇"), ("哈哈哈", r"哈{3,}"), ("啊啊啊", r"啊{3,}"), ("天哪", r"天哪"),
         ("我的天", r"我的天"), ("救命", r"救命"), ("好耶", r"好耶"), ("离谱", r"离谱"), ("拜拜", r"拜拜"),
         ("完了", r"完了"), ("怎么办", r"怎么办"), ("芜湖", r"芜?湖"), ("嘿嘿", r"嘿{2,}"), ("炸了", r"炸了")]
catch_data = sorted([(k, len(re.findall(p, low))) for k, p in CATCH], key=lambda x: -x[1])[:15]
fig, ax = plt.subplots(figsize=(10, 6))
ax.barh([c[0] for c in catch_data], [c[1] for c in catch_data], color=PALETTE["pink"], height=.55)
ax.invert_yaxis()
for i, (_, val) in enumerate(catch_data): ax.text(val + max(1, catch_data[0][1]*.01), i, f"{val:,}", va="center", fontweight="bold")
ax.set_title("口头禅/语气词使用频率 TOP15"); ax.set_xlabel("出现次数")
ax.grid(axis="x", color=PALETTE["grid"], alpha=.6); ax.grid(axis="y", visible=False)
save(fig, "10_catchphrases.png")

# 11
def simplify(t):
    if "游戏" in t or "实况" in t: return "游戏实况"
    if "翻唱" in t or "音乐" in t or "原创" in t: return "音乐/翻唱"
    if "电台" in t: return "电台"
    if "直播" in t: return "直播录像"
    if "生活" in t or "日常" in t or "杂谈" in t or "Vlog" in t: return "生活/杂谈"
    if "绘画" in t or "手书" in t: return "绘画/手书"
    if "配音" in t or "小剧场" in t: return "配音/小剧场"
    if "科普" in t: return "知识科普"
    if "搞笑" in t: return "搞笑娱乐"
    return "其他"

year_type = defaultdict(lambda: defaultdict(int))
for v in sorted_videos:
    year_type[v["date"][:4]][simplify(v["type"])] += 1
type_names = ["游戏实况", "音乐/翻唱", "直播录像", "电台", "生活/杂谈", "绘画/手书", "配音/小剧场", "知识科普", "搞笑娱乐", "其他"]
matrix = np.array([[year_type[y].get(t, 0) / max(1, sum(year_type[y].values())) * 100 for t in type_names] for y in year_labels]).T
fig, ax = plt.subplots(figsize=(12, 6))
ax.stackplot(range(len(year_labels)), matrix, labels=type_names, colors=COLORS + [PALETTE["grey"]], alpha=.88)
ax.set_xticks(range(len(year_labels))); ax.set_xticklabels(year_labels)
ax.set_ylim(0, 100); ax.set_title("内容类型年度演变"); ax.set_ylabel("占比（%）")
ax.legend(loc="upper left", fontsize=9, frameon=False, ncol=3)
save(fig, "11_type_evolution.png")

# 12
type_stats = defaultdict(lambda: {"count": 0, "chars": 0})
for v in videos:
    t = simplify(v["type"]); type_stats[t]["count"] += 1; type_stats[t]["chars"] += v.get("sub_chars", 0)
fig, ax = plt.subplots(figsize=(11, 7))
xs = [x["count"] for x in type_stats.values()]
ys = [x["chars"] / max(1, x["count"]) / 1000 for x in type_stats.values()]
ss = [max(80, x["chars"] / 4000) for x in type_stats.values()]
ax.scatter(xs, ys, s=ss, c=COLORS[:len(xs)], alpha=.75, edgecolors="white", linewidths=1.5)
for i, (name, item) in enumerate(type_stats.items()):
    ax.annotate(f"{name}\n({item['count']}部, 均{ys[i]:.1f}k字)", (xs[i], ys[i]), textcoords="offset points", xytext=(0, 18), ha="center", fontsize=8.5)
ax.set_xlabel("视频数量（部）"); ax.set_ylabel("平均字幕量（千字符/部）")
ax.set_title("视频类型 × 平均字幕量（气泡大小=总字幕量）"); style_ax(ax)
save(fig, "12_type_scatter.png")

# 13
hours = Counter(int(v["pubdate_iso"][11:13]) for v in sorted_videos if v.get("pubdate_iso"))
fig, ax = plt.subplots(figsize=(10, 6))
ax.bar(range(24), [hours.get(h, 0) for h in range(24)], color=PALETTE["sky"])
ax.set_xticks(range(0, 24, 2)); ax.set_title("发布时钟"); ax.set_xlabel("小时"); ax.set_ylabel("投稿数量")
style_ax(ax); save(fig, "13_publish_clock.png")

# 14
peak_by_video = sorted([(v, (insights.get("videos", {}).get(v["bvid"]) or {}).get("peaks", [])) for v in videos], key=lambda x: max([p.get("count", 0) for p in x[1]] or [0]), reverse=True)[:20]
fig, ax = plt.subplots(figsize=(10, 8))
labels14 = [f"#{v['no']} {v['title'][:14]}" for v, _ in peak_by_video]
vals14 = [max([p.get("count", 0) for p in ps] or [0]) for _, ps in peak_by_video]
ax.barh(range(20), vals14, color=PALETTE["coral"], height=.6)
ax.set_yticks(range(20)); ax.set_yticklabels(labels14, fontsize=8.5); ax.invert_yaxis()
ax.set_title("弹幕高能峰值 TOP20"); ax.set_xlabel("单分钟最高弹幕数")
ax.grid(axis="x", color=PALETTE["grid"], alpha=.6); ax.grid(axis="y", visible=False)
save(fig, "14_danmaku_peak.png")

# 15
word_counter = Counter()
for v in videos:
    text = (v.get("title", "") + " " + v.get("desc", "")).lower()
    for word in ["怒九", "warma", "游戏", "直播", "画画", "绘画", "手书", "电台", "翻唱", "原创", "联合", "日常", "恐怖", "考试", "undertale", "minecraft", "splatoon", "星露谷"]:
        word_counter[word] += len(re.findall(re.escape(word), text))
top_words = word_counter.most_common(25)
fig, ax = plt.subplots(figsize=(10, 8))
ax.barh([w[0] for w in top_words], [w[1] for w in top_words], color=PALETTE["purple"], height=.6)
ax.invert_yaxis()
for i, (_, val) in enumerate(top_words): ax.text(val + .2, i, str(val), va="center", fontweight="bold")
ax.set_title("标题与简介关键词频率 TOP25"); ax.set_xlabel("出现次数")
ax.grid(axis="x", color=PALETTE["grid"], alpha=.6); ax.grid(axis="y", visible=False)
save(fig, "15_keyword_freq.png")

# 16
type_duration = defaultdict(list)
for v in videos:
    if v.get("duration"): type_duration[simplify(v["type"])].append(v["duration"])
items = sorted(type_duration.items(), key=lambda x: -sum(x[1]))
fig, ax = plt.subplots(figsize=(11, 6))
box = ax.boxplot([x[1] for x in items], patch_artist=True, tick_labels=[x[0] for x in items], showfliers=True, flierprops=dict(markersize=2, alpha=.3))
for patch, color in zip(box["boxes"], COLORS * 3): patch.set_facecolor(color); patch.set_alpha(.72)
plt.xticks(rotation=25, ha="right")
ax.set_title("内容类型 × 视频时长分布"); ax.set_ylabel("时长（秒）"); style_ax(ax)
save(fig, "16_type_duration.png")

stats = {
    "total_videos": len(videos),
    "total_sub_lines": sum(v.get("sub_lines", 0) for v in videos),
    "total_sub_chars": sum(v.get("sub_chars", 0) for v in videos),
    "date_start": sorted_videos[0]["date"] if sorted_videos else None,
    "date_end": sorted_videos[-1]["date"] if sorted_videos else None,
    "yearly": {y: year_counter[y] for y in year_labels},
    "types": dict(type_counter.most_common()),
    "accounts": dict(acct_counter.most_common()),
}
(CHARTS / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
print("All 16 charts generated")
