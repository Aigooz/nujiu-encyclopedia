# 🎬 怒九百科

<div align="center">

**B站UP主 [怒九笑](https://space.bilibili.com/14751040)（主号）× [怒九摸鱼馆](https://space.bilibili.com/693485501)（小号）**

视频数据 · 可视化 · 弹幕分析 · 自动更新

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Videos](https://img.shields.io/badge/videos-205-orange)
![Python](https://img.shields.io/badge/python-3.10+-yellow?logo=python&logoColor=white)

**[🌐 在线预览](https://aigooz.github.io/nujiu-encyclopedia/)** · **[📖 使用说明](#-使用)** · **[🛠 项目结构](#-项目结构)**

</div>

---

## 📊 可视化网站

用浏览器打开 `site/index.html` 即可，包含 **20+ 交互式图表**：

| 模块 | 内容 |
|------|------|
| 📈 年度趋势 | 投稿频率、时长变化、年度对比 |
| 🍩 类型分布 | 内容类型占比与演变 |
| 🔥 弹幕分析 | 峰值时间、热词、互动率 |
| 🕐 发布时钟 | 各时段投稿习惯 |
| 🏷 关键词网络 | 标题关键词共现关系 |
| 🖼 封面画廊 | 按类型/年份浏览封面 |
| 📐 算法分析 | 间隔预测、趋势拟合 |
| 🎯 百科问答 | 互动知识挑战 · 分类 × 难度 |

![预览](site/preview.png)

## 🛠 项目结构

```
nujiu-encyclopedia/
├── site/                       # 🌐 可视化网站
│   ├── index.html              #    主页面
│   ├── app.js                  #    ECharts 图表逻辑
│   ├── data.js                 #    首屏视频数据
│   ├── data-comments.js        #    评论数据
│   ├── style.css               #    样式
│   └── vendor/                 #    第三方库
├── tools/                      # ⚙️ 自动化工具
│   ├── update.py               #    全自动更新入口
│   ├── build_site_data.py      #    生成 data.js
│   ├── build_xlsx.py           #    Excel 生成
│   ├── build_docx.py           #    Word 生成
│   ├── fetch_danmaku.py        #    弹幕抓取
│   ├── bili_api.py             #    B站 API 封装
│   ├── login.py                #    扫码登录
│   └── ...
├── charts/                     # 📊 静态图表
├── subtitles/                  # 📝 字幕 JSON
├── registry.json               # 视频注册表
├── config.ini                  # 配置（不入库）
│
├── 一键更新百科.bat              # 交互式更新
├── 一键更新表格.bat              # Excel 同步
├── 同步到GitHub.bat             # 手动推送
└── 使用说明.md
```

## 🚀 使用

### 一键更新
```bash
# 交互式菜单（全自动 / 字幕导入 / 查看状态）
一键更新百科.bat

# 同步 Excel 表格
一键更新表格.bat
```

### 手动更新
```bash
python tools/update.py run      # 全自动更新
python tools/update.py ingest   # 从 Inbox 导入字幕
python tools/update.py status   # 查看当前状态
```

### 配置
编辑 `config.ini`，填入 B站 Cookie（至少 `SESSDATA` + `buvid3`）：
```ini
[bili]
uid_main = 14751040
uid_alt = 693485501
cookie = SESSDATA=xxx; buvid3=xxx
```

> 💡 也可运行 `python tools/login.py` 扫码自动获取。

## 数据总览

| 指标 | 数量 |
|---|---:|
| 收录视频 | 205 |
| 主号视频 | 166 |
| 小号视频 | 39 |
| AI/CC 字幕行数 | 38,744 |
| 有字幕分析的视频 | 79 |
| 弹幕记录 | 488,947 |
| 热门评论缓存 | 12,194 |
| Word 内嵌图表 | 18 |
| Word 表格 | 257 |
| 互动问答 | 1196 |

最新 Word 百科是 `nujiu-encyclopedia-v7.docx`，Word 表格 257 张。正文包括概览、创作年表、类型分析、电台、生活/Vlog、游戏实况、音乐、绘画/手书、科普/配音、合作关系、熟悉度测试、小号专题、205 部视频词条、1196 道互动问答和统计附录。

## 成品

| 文件 | 说明 |
|---|---|
| `nujiu-encyclopedia-v7.docx` | Word 百科 |
| `site/index.html` | 交互式可视化网站 |
| `@怒九笑 相关.xlsx` | 主号视频数据库（位于上级目录） |
| `@怒九摸鱼馆 相关.xlsx` | 小号视频数据库（位于上级目录） |
| `registry.json` | 视频注册表 |
| `charts/` | 可视化图表源文件 |
| `subtitles/` | 字幕原始数据 |
| `danmaku/` | 弹幕原始数据 |
| `tools/bili_comments_cache.json` | 热门评论缓存 |

双击 `site/index.html` 可直接浏览。若浏览器限制本地脚本，可在本目录执行：

```powershell
python -m http.server 8765 --directory site
```

然后访问 [http://127.0.0.1:8765](http://127.0.0.1:8765)。

## 更新

双击 `一键更新百科.bat` 会依次执行投稿同步、字幕合并、评论与弹幕补抓、洞察分析、图表、Excel、网站数据、问答和 Word 重建。只重建成品可双击 `一键重建成品.bat`。

手动更新：

```powershell
python tools/fetch_data.py
python tools/rebuild_registry_from_subtitles.py
python tools/fetch_bili_comments.py --pages 2 --pace 2.0
python tools/fetch_danmaku.py --workers 4
python tools/analyze_danmaku_insights.py
python tools/gen_charts.py
python tools/build_xlsx.py
python tools/build_site_data.py
python tools/enrich_xlsx_insights.py
node tools/generate_quiz.js
python tools/build_docx.py
```

## 数据口径

- 视频列表、详情、互动数据、封面和标签来自 B 站公开接口。
- 字幕来自 B 站 AI/CC 字幕，不是人工逐字校对稿。
- 弹幕包含最近 XML 与历史分段接口记录，受平台缓存限制，不承诺全站历史完整。
- 热门评论按点赞排序，缓存每视频公开评论。
- Excel 位于上级目录；`tools/build_xlsx.py` 会自动生成主号、小号两级数据表。

## 数据增强

### B 站分区 + 标签分类

- `tools/fetch_bili_tags.py` 抓取全部视频的 B 站标签并缓存到 `tools/bili_tags_cache.json`。
- `tools/classify_videos.py` 按「电台 → 直播 → 游戏 → 音乐 → 科普 → 绘画/配音 → 搞笑 → 生活」优先级重分类，重跑即可更新 `registry.json` 的「类型」。

### 弹幕全量数据

- `tools/fetch_danmaku.py` 拉取最近弹幕与历史分段记录，`danmaku/raw/` 保存抓取缓存。
- `danmaku/all_danmaku.jsonl`、`danmaku/all_danmaku.csv` 和 `danmaku/per_video_summary.csv` 是全量聚合产物。

### 弹幕洞察与热评

- `tools/analyze_danmaku_insights.py` 本地计算每视频高能时刻、名梗、密度曲线和全站年度活跃，结果写入 `tools/danmaku_insights.json`。
- `tools/fetch_bili_comments.py` 抓取每个视频的热门评论，支持断点续传。
- 两者更新后运行 `python tools/build_site_data.py` 重建 `site/data.js`。

### 网站新增功能

- 「弹幕考古」区块：弹幕年度活跃曲线 + 全站名梗榜，名梗可一键搜索相关视频。
- 视频详情弹层：封面、互动数据、B 站标签、弹幕密度曲线、高能时刻、本视频名梗、热门评论和荣誉徽章。
- 搜索范围扩展到评论与名梗内容。
- 本地预览：`python -m http.server 8765 --directory site`。

## UP 主档案与荣誉数据

- `tools/up_profiles.json` 保存主号和小号的头像、签名、等级与粉丝数。
- 荣誉数据合并到每个视频的 `honors` 字段，包括全站排行榜、每周必看、热门和入站必录等。
- 站点总览展示 UP 主档案卡片；视频详情弹窗显示金橙色荣誉徽章。
