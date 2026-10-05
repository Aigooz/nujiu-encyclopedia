# -*- coding: utf-8 -*-
"""从 danmaku/all_danmaku.jsonl 计算弹幕洞察：
- 每视频高能时刻（10 秒分桶，取 top 峰值 + 峰值弹幕样本）
- 每视频重复度最高的弹幕（名梗）
- 全站弹幕发送年份分布（考古曲线）
输出: tools/danmaku_insights.json
"""
import json, math, re, sys, time
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "danmaku" / "all_danmaku.jsonl"
OUT = ROOT / "tools" / "danmaku_insights.json"

GENERIC = re.compile(r"^[0-9\W_]+$")


def main():
    t0 = time.time()
    per_video_window = defaultdict(Counter)      # bvid -> {bucket: count}
    per_video_bucket_lines = defaultdict(dict)   # bvid -> {bucket: [(progress, content)]}
    per_video_phrase = defaultdict(Counter)      # bvid -> {phrase: count}
    yearly = Counter()
    total = 0
    with open(SRC, encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except Exception:
                continue
            bvid = r.get("bvid")
            content = (r.get("content") or "").strip()
            if not bvid or not content:
                continue
            total += 1
            prog = r.get("progress")
            if isinstance(prog, (int, float)) and prog >= 0:
                b = int(prog // 10) * 10
                per_video_window[bvid][b] += 1
                if len(per_video_bucket_lines[bvid].setdefault(b, [])) < 30:
                    per_video_bucket_lines[bvid][b].append((prog, content))
            phrase = content
            if 2 <= len(phrase) <= 40 and not GENERIC.match(phrase):
                per_video_phrase[bvid][phrase] += 1
            st = r.get("send_time")
            if isinstance(st, (int, float)) and st > 0:
                yearly[time.strftime("%Y", time.localtime(st))] += 1

    videos = {}
    for bvid, wc in per_video_window.items():
        # 10 秒分桶完整密度曲线（最多 150 个点）
        max_b = max(wc) if wc else 0
        profile = []
        if max_b >= 0:
            n_points = 150
            if max_b + 1 <= n_points:
                profile = [[i * 10, wc.get(i, 0)] for i in range(max_b + 1)]
            else:
                step = math.ceil((max_b + 1) / n_points)
                for start in range(0, max_b + 1, step):
                    bucket_sum = sum(wc.get(i, 0) for i in range(start, min(start + step, max_b + 1)))
                    profile.append([start * 10, bucket_sum])
        profile = [p for p in profile if p[1] > 0]
        peaks = []
        for b, cnt in wc.most_common(3):
            samples = per_video_bucket_lines[bvid].get(b, [])
            samples.sort(key=lambda x: x[0])
            peaks.append({
                "t": b,
                "count": cnt,
                "samples": [c for _, c in samples[:5]],
            })
        top_phrases = [
            {"content": p, "count": c}
            for p, c in per_video_phrase[bvid].most_common(5)
            if c >= 3
        ]
        videos[bvid] = {"peaks": peaks, "top_phrases": top_phrases, "profile": profile}

    out = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        "total_records": total,
        "videos": videos,
        "yearly": dict(sorted(yearly.items())),
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"DONE total={total} videos={len(videos)} elapsed={time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
