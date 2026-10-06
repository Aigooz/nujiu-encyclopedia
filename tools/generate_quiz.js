#!/usr/bin/env node
/**
 * 怒九百科 · 问答数据生成器
 * 从 site/data.js 的已有数据中自动生成测验题目
 * 输出 site/data-quiz.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dataCode = fs.readFileSync(path.join(ROOT, 'site/data.js'), 'utf8');
const RAW = new Function(dataCode + '; return RAW;')();
const videos = RAW.videos;
const commentsCode = fs.readFileSync(path.join(ROOT, 'site/data-comments.js'), 'utf8');
const commentsModule = new Function(commentsCode + '; return { RAW_COMMENTS, RAW_PACKED_COMMENTS };')();
const RAW_COMMENTS = commentsModule.RAW_COMMENTS || {};

// Helpers
const fmtNum = n => {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万';
  return String(n);
};
let randomState = 20261006;
const random = () => {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 4294967296;
};
const shuffle = arr => { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const pick = (arr,n) => shuffle(arr).slice(0,n);
const fmtDur = s => { const m=Math.floor(s/60), sec=s%60; return m>0?`${m}分${sec}秒`:`${sec}秒`; };
const shortTitle = v => v.title.length > 38 ? v.title.slice(0, 38) + '…' : v.title;
const byNo = no => videos.find(v => v.no === no);
const addDays = (dateText, days) => {
  const [y, m, d] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
};
const semanticDistractors = value => {
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return [-2, -5, 11, 21, -11].map(days => addDays(text, days));
  const match = text.match(/^(约\s*)?([\d,]+(?:\.\d+)?)\s*(万|亿)?\s*(.*)$/);
  if (!match) return [];
  const number = Number(match[2].replace(/,/g, ''));
  if (!Number.isFinite(number)) return [];
  const scale = match[3] === '万' ? 10000 : match[3] === '亿' ? 100000000 : 1;
  const raw = number * scale;
  const displayScale = match[3] || (raw >= 1e8 ? '亿' : raw >= 1e4 ? '万' : '');
  const unit = match[4] || '';
  const spacer = displayScale && unit ? ' ' : '';
  const formatLikeAnswer = value => {
    if (displayScale === '亿') return `${(value / 1e8).toFixed(1)} 亿`;
    if (displayScale === '万') return `${(value / 1e4).toFixed(1)} 万`;
    return String(Math.round(value));
  };
  const options = [0.75, 1.25, 1.5, 2, 0.5].map(factor =>
    `${match[1] || ''}${formatLikeAnswer(raw * factor)}${spacer}${unit}`
  );
  if (raw < 10) {
    options.push(...[1, 2, 3, -1, 5, 7].map(delta => raw + delta).filter(n => n > 0).map(String));
  }
  return options;
};
const numericOptionInfo = value => {
  const match = String(value).trim().match(
    /^(约\s*|超过\s*|不到\s*)?[\d,.]+\s*(万|亿)?\s*(%|％|个|部|天|秒|分钟|次|行|字符|小时|人|倍|级|年)?$/
  );
  if (!match) return null;
  return { qualifier: match[1] || '', scale: match[2] || '', unit: match[3] || '' };
};
const sameNumericForm = (a, b) => {
  const left = numericOptionInfo(a);
  const right = numericOptionInfo(b);
  return Boolean(left && right && left.qualifier === right.qualifier && left.scale === right.scale && left.unit === right.unit);
};

// ─── Question Bank ───
const questions = [];
let qid = 0;
const add = (category, difficulty, q, options, answerIdx, explanation, format = 'mc') => {
  // If called in choice-style (correct string + wrongPool array), delegate to choice logic
  if (!Array.isArray(options)) {
    return choiceRaw(category, difficulty, q, options, answerIdx, explanation);
  }
  const correct = options[answerIdx];
  const others = options.filter((_, i) => i !== answerIdx);
  const shuffled = shuffle([correct, ...others]);
  const finalAnswerIdx = shuffled.indexOf(correct);
  const points = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3;
  questions.push({ id: ++qid, category, difficulty, format, points, q, options: shuffled, answer: finalAnswerIdx, explanation });
};
const addTrueFalse = (category, difficulty, statement, isTrue, explanation) => {
  add(category, difficulty, statement, ['正确', '错误'], isTrue ? 0 : 1, explanation, 'tf');
};
const choice = (category, difficulty, q, correct, wrongPool, explanation) => {
  if (Array.isArray(correct)) return add(category, difficulty, q, correct, wrongPool, explanation);
  return choiceRaw(category, difficulty, q, correct, wrongPool, explanation);
};
const choiceRaw = (category, difficulty, q, correct, wrongPool, explanation) => {
  const unique = [String(correct)];
  const seen = new Set(unique);
  let candidates;
  if (numericOptionInfo(correct)) {
    candidates = [
      ...wrongPool.filter(w => sameNumericForm(correct, w)),
      ...semanticDistractors(correct),
    ];
  } else {
    candidates = [
      ...wrongPool.filter(w => !numericOptionInfo(w)),
      ...semanticDistractors(correct),
    ];
  }
  for (const w of candidates) {
    const s = String(w);
    if (s && !seen.has(s)) { seen.add(s); unique.push(s); if (unique.length === 4) break; }
  }
  if (unique.length < 4) {
    console.warn(`Skipped question with too few distractors: ${q}`);
    return null;
  }
  add(category, difficulty, q, unique, 0, explanation);
};

// Auto data
const topBy = key => videos.slice().sort((a,b)=>(b[key]||0)-(a[key]||0));
const tagNames = v => (v.tags || []).map(t => typeof t === 'string' ? t : t.name);
const tagCounter = videos.reduce((acc,v)=>{ for(const t of tagNames(v)) acc[t]=(acc[t]||0)+1; return acc; },{});
const topTags = Object.entries(tagCounter).sort((a,b)=>b[1]-a[1]);
const typeCounter = videos.reduce((acc,v)=>{ acc[v.type]=(acc[v.type]||0)+1; return acc; },{});
const topTypes = Object.entries(typeCounter).sort((a,b)=>b[1]-a[1]);
const yearCounter = videos.reduce((acc,v)=>{ const y=v.date?.substring(0,4); if(y) acc[y]=(acc[y]||0)+1; return acc; },{});
const topYears = Object.entries(yearCounter).sort((a,b)=>b[1]-a[1]);
const flatComments = [];
for (const [bvid, comments] of Object.entries(RAW_COMMENTS)) {
  for (const c of comments || []) flatComments.push({ bvid, ...c });
}
const gaps = videos.filter(v => Number.isFinite(v.gap_days));
const maxGap = gaps.slice().sort((a,b)=>b.gap_days-a.gap_days)[0];
const main = videos.filter(v => v.account_short === '主号');
const small = videos.filter(v => v.account_short === '小号');
const sum = (rows, key) => rows.reduce((s,v)=>s+(Number(v[key])||0),0);
const mainProfile = Object.values(RAW.profiles || {}).find(p=>p.mid==='14751040') || {};
const smallProfile = Object.values(RAW.profiles || {}).find(p=>p.mid==='693485501') || {};
const topMemes = RAW.top_memes || [];
const yearlyDanmaku = Object.entries(RAW.yearly_danmaku || {}).sort((a,b)=>b[1]-a[1]);
const typeViews = Object.entries(videos.reduce((acc,v)=>{ acc[v.type]=(acc[v.type]||0)+(v.view||0); return acc; },{})).sort((a,b)=>b[1]-a[1]);

// ═══ 数据之最 ═══
const t = no => { const v = byNo(no); return v ? shortTitle(v) : ''; };

choice('数据之最', 'easy', '以下哪部视频的播放量最高？', t(169), [t(111), t(90), t(70)],
  '《双影奇境》播放约 791 万，是怒九播放量最高的视频；第二名的《绝对不许关灯！》约 493 万。');
choice('数据之最', 'medium', '以下哪部视频的点赞数最高？', t(117), [t(169), t(111), t(93)],
  '《让我们快乐地搬家吧！》获赞约 35.4 万，是全站点赞最高的视频——点赞王是翻唱/音乐类作品，并不是播放王《双影奇境》。');
choice('数据之最', 'medium', '以下哪部视频的投币数最高？', t(93), [t(136), t(117), t(169)],
  '《姐妹俩打打闹闹的日常【电台】》投币约 15.2 万，领先《去逛古怪的摆摊市集》（约 14.1 万）和《让我们快乐地搬家吧！》（约 13.1 万）。');
choice('数据之最', 'easy', '以下哪部视频的评论数最多？', t(131), [t(117), t(46), t(69)],
  '《淦！你们的爱好…好帅啊！！》收到 11999 条评论，是评论数最高的视频。');
choice('数据之最', 'hard', '以下哪部视频被分享的次数最多？', t(62), [t(136), t(117), t(169)],
  '分享最高的不是合作大爆款，而是"撩到我算我输"系列的《玛丽苏用力过猛的游戏》，被分享 12182 次；《去逛古怪的摆摊市集》以 11924 次紧随其后。');
choice('数据之最', 'medium', '以下哪部视频的收藏数最高？', t(169), [t(139), t(120), t(126)],
  '《双影奇境》被收藏约 17.2 万次，领先《气到缺氧》（约 14.3 万）和《绝对不许关灯！》（约 12.9 万）。');
choice('数据之最', 'medium', '以下哪部视频的时长最长？', t(169), [t(71), t(203), t(30)],
  '《双影奇境》合集时长约 744 分钟，比《逃出生天》（约 372 分钟）和《轨道双子星》（约 340 分钟）长得多。');
choice('数据之最', 'hard', '以下哪部视频的点赞率（点赞÷播放）最高？', t(135), [t(204), t(68), t(131)],
  '《这些怪故事太占脑内存了》点赞率约 14.4%，是全部视频中最高的，领先《出国！去逛全球最大的游戏展吧！》（约 11.2%）。');
choice('数据之最', 'hard', '以下哪部视频的弹幕数最多？', t(169), [t(69), t(111), t(93)],
  '《双影奇境》弹幕 37919 条，只比第二名《人类迷惑行为》（37572 条）多三百多条，是险胜的弹幕冠军。');
add('数据之最', 'hard', '怒九最长的一次连续拖更大约持续了多少天？', ['约245天', '约120天', '约60天', '约30天'], 0,
  '最长一次断更约 245 天，发生在小号投稿《笨徒弟摸鱼王之旅》（2022-07-06）之前。');

// ═══ 考古与里程碑 ═══
choice('考古与里程碑', 'easy', '怒九在 B 站的第一部投稿是哪部视频？', t(1), [t(2), t(8), t(12)],
  '第一部投稿是 2017-08-25 的《【守望先锋手书】因为我们是男英雄啊！》，全长只有 1 分钟左右，类型是绘画/手书。');
choice('考古与里程碑', 'medium', '怒九的第一部游戏实况是哪部视频？', t(2), [t(1), t(46), t(111)],
  '2018-01-13 的《【Undertale】某地下的御茶会议》是收录记录里最早的游戏实况，也是 UT 系列的开端。');
choice('考古与里程碑', 'medium', '怒九的第一部知识科普类视频是？', t(8), [t(24), t(34), t(44)],
  '2018-04-30 的《【论高考】送给美术生的一个小视频》是第一部知识科普，专门做给美术高考生打气。');
choice('考古与里程碑', 'medium', '小号"怒九摸鱼馆"的第一部投稿是？', t(88), [t(101), t(116), t(149)],
  '小号首投是 2021-01-01 的《【TWO TIME※】上课摸的鱼》，全长只有 70 秒，类型是翻唱/音乐，拿到了约 69 万播放。');
choice('考古与里程碑', 'medium', '"生活日常"类的第一部视频是？', t(101), [t(102), t(136), t(117)],
  '《沃玛正在看怒九的新视频……》（2021-10-05，小号）是生活日常类的起点，内容就是 Warma 观看怒九新视频的反应。');
choice('考古与里程碑', 'medium', '"爆炸电台"的第一期是哪部视频？', t(93), [t(182), t(204), t(205)],
  '2021-04-02 的《姐妹俩打打闹闹的日常【电台】》是爆炸电台第一期，它至今仍是全站投币数最高的视频。');
choice('考古与里程碑', 'hard', '怒九目前收录的唯一一部"直播录像"是？', t(44), [t(2), t(30), t(68)],
  '2019-03-17 的《【国产良心像素游戏】惊艳！残酷而美丽的童话故事！》是唯一一部直播录像，时长约 122 分钟。');

// ═══ 系列与内容 ═══
choice('系列与内容', 'easy', '《星露谷！田园开荒生活》目前更新到哪个季节？', ['第一年 秋', '第一年 冬', '第二年 春', '第一年 夏'], 0,
  '目前更新到《第一年 秋》（2024-12-27，小号），冬天的部分还没有出。');
choice('系列与内容', 'easy', '《星露谷！田园开荒生活》的三集都发在哪个账号？', ['小号（怒九摸鱼馆）', '主号（怒九笑）', 'Warma的账号', '两个账号都发过'], 0,
  '春、夏、秋三集全部发在小号"怒九摸鱼馆"。');
choice('系列与内容', 'medium', '星露谷春、夏、秋三季中哪一季播放量最高？', ['第一年 春', '第一年 夏', '第一年 秋', '三季差不多'], 0,
  '《春》约 153 万、《夏》约 84 万、《秋》约 82 万，第一季明显领先。');
choice('系列与内容', 'medium', '"全国统一的人类共同行为记录"第④期是哪部视频？', t(105), [t(85), t(89), t(95)],
  '④是《你的牙痒吗？》（2021-11-06）；①每日の痛、②每日一气、③论文！燃尽！。');
choice('系列与内容', 'hard', '以下哪部视频不属于"全国统一"①–④编号系列？', t(119), [t(85), t(89), t(105)],
  '《全国统一的军训吐槽！》（2022-09-03）标题里没有编号，是独立于①–④之外的一期，类型还是绘画/手书。');
choice('系列与内容', 'easy', '《爆米花电台02》主要聊的是什么？', ['开水烫伤后的养伤生活', '高考备考经验', '出国逛游戏展', '搬家装修心得'], 0,
  '小号 2025-09-10 的《【warma/怒九】我被开水烫伤后的养伤生活【爆米花电台02】》，标题里就写明了主题。');
choice('系列与内容', 'medium', '以下哪部视频属于"爆炸电台"系列？', t(205), [t(201), t(202), t(203)],
  '《我们俩第一次出国！》（2026-10-03）是爆炸电台第 4 期；同期的《轨道双子星》是游戏实况，不属于电台系列。');
choice('系列与内容', 'easy', '"撩到我算我输"系列是怒九在玩哪一类游戏？', ['乙女/恋爱游戏', '恐怖游戏', '音乐节奏游戏', '模拟经营游戏'], 0,
  '该系列是怒九单人吐槽各类乙女/恋爱游戏的合集，玛丽苏、渣男桥段都是固定素材。');
choice('系列与内容', 'medium', '"怒九的脑洞日常"系列里讲"南方人第一次去澡堂"的是哪部视频？', t(46), [t(69), t(57), t(131)],
  '2019-04-14 的《南方人第一次去澡堂是什么样的？》是脑洞日常系列的名场面之一，播放约 234 万。');

// ═══ 合作专题 ═══
choice('合作专题', 'easy', '《初次参加面试就直接通过的三人！》的三位主角是谁？', ['Warma、怒九笑、捏碳', 'Warma、怒九笑、兴儿哥', '捏碳、兴儿哥、怒九笑', 'Warma、捏碳、兴儿哥'], 0,
  '标题写明【Warma/怒九笑/捏碳】，视频发布于 2020-02-29，播放约 361 万。');
choice('合作专题', 'medium', '《我们的新游戏发布？！》的剧本是谁写的？', ['Warma', '怒九', '捏碳', '三人轮流执笔'], 0,
  'Warma 在 3.4 万赞的高赞评论里说明：大家讨论出各种点子之后，由她把点子统合写成了这次的剧本。');
choice('合作专题', 'easy', '《伪人超市》的嘉宾"碳碳"的大号叫什么？', ['捏碳碳碳碳', 'Warma', '兴儿哥', '碳碳花花'], 0,
  '简介写明"嘉宾：碳碳——大号：捏碳碳碳碳"，视频发布于 2026-08-16 的小号。');
choice('合作专题', 'medium', '按《双影奇境》简介的分工，插画/封面是谁画的？', ['怒九', 'Warma', '捏碳', '游戏官方'], 0,
  '简介写明"剪辑：warma，插画/封面：怒九"——剪辑是 Warma，封面插画是怒九自己画的。');
choice('合作专题', 'medium', '《轨道双子星》是在什么平台上游玩的？', ['Switch 2', 'PS5', 'PC', 'Xbox Series'], 0,
  '简介写明"轨道双子星（平台：Switch 2）"，另外封面/剪辑是怒九，外置字幕是 Warma。');
choice('合作专题', 'medium', '《去逛古怪的摆摊市集！》里两人逛的是哪里的集市？', ['大理', '上海', '成都', '长沙'], 0,
  '简介写明"用一周的时间和怒九一起把大理的好多个集市都逛了一圈"，摄像/剪辑是 Warma，插画是怒九。');
choice('合作专题', 'medium', '在本百科收录的台账里，以下哪款游戏没有出现在怒九和 Warma 的合作实况标题中？', ['塞尔达传说', '双影奇境', 'REANIMAL', 'Subnautica2'], 0,
  '台账里能找到《双影奇境》《REANIMAL（生灵重塑）》《Subnautica2：异星水域》等合作实况，但没有塞尔达传说。');
choice('合作专题', 'hard', '《线下见面★ 宅人终于出去玩啦！！》被归为什么类型？', ['知识科普', '游戏实况', '生活日常', '搞笑娱乐'], 0,
  '这部 2021-02-04 的线下出游视频被归入"知识科普"类，播放约 328 万——分类和内容反差很大。');
choice('合作专题', 'medium', 'Warma 在《我们的新游戏发布？！》评论里说"时隔两年终于再次联动"，两年前的三人合作是哪部？', t(70), [t(93), t(169), t(202)],
  '2020-02-29 的《初次参加面试》是三人的合作短剧，到 2022-03-26 的《新游戏发布》正好隔了约两年。');

// ═══ 评论区 ═══
choice('评论区', 'medium', '在《让我们快乐地搬家吧！》评论区，怒九笑本人获赞最高的评论是什么？', ['好～', '真的会谢', '哈哈哈哈哈', '谢谢有被感动到'], 0,
  '怒九笑只回了一个"好～"，拿下约 6.05 万赞。');
choice('评论区', 'hard', '"果然内置空调，看的我后背好凉快"这条 3.3 万赞评论出自哪部视频？', t(117), [t(46), t(131), t(135)],
  '来自《让我们快乐地搬家吧！》评论区（兴儿哥，约 3.32 万赞）。');
choice('评论区', 'medium', '"澡堂，一个让你横空出柜的地方"这条名场面评论出自哪部视频？', t(46), [t(69), t(57), t(131)],
  '来自 2019 年的《南方人第一次去澡堂是什么样的？》，获赞约 2.48 万。');
choice('评论区', 'easy', 'Warma 在《有个亲哥是什么体验？》评论区是怎么称呼怒九的？', ['怒九妹妹！', '怒九宝！', '九妹！', '小怒九！'], 0,
  'Warma 的高赞评论只有一句"怒九妹妹！[害羞]"，获赞约 4.21 万。');
choice('评论区', 'medium', '"我超靠谱的对吧！"是 Warma 在哪部视频评论区的发言？', t(90), [t(70), t(111), t(93)],
  '来自《线下见面★ 宅人终于出去玩啦！！》评论区，获赞约 4.02 万。');
choice('评论区', 'medium', '"你的房间很好看，我的了！"是 Warma 在哪部视频评论区的发言？', t(102), [t(117), t(136), t(90)],
  '来自《搬家Vlog 进行一个工作间的装饰！》评论区，获赞约 3.51 万。');
choice('评论区', 'hard', 'Warma 在《我画了一本书！》评论区炫耀了什么？', ['她收藏了怒九全世界限量的绘本之一', '她也画过一本书', '她把书借给了图书馆', '她收到了十本签名版'], 0,
  '原话是"哈哈！怒九全世界限量的绘本之一在我这里"，获赞约 3.17 万。');
choice('评论区', 'medium', '在《甲方：你好像在玩一种很新的索尼电视广告……》评论区互动的官方账号是？', ['索尼中国', '索尼互动娱乐', '微软 Xbox', '任天堂'], 0,
  '索尼中国官方号留言"这确实是一种很新的形式呢[doge]看到时，就连阿索自己都没猜出来~"，获赞约 4514。');
choice('评论区', 'hard', '在《出国！去逛全球最大的游戏展吧！》评论区，Warma 提到自己高考哪一科接近满分？', ['英语', '数学', '语文', '理综'], 0,
  'Warma 的高赞评论写道"以防你们不知道当年沃玛高考英语接近满分"。');
choice('评论区', 'medium', '在《双影奇境》评论区，Warma 向观众承诺会怎样更新？', ['超快速更新完', '每周准时更新', '看心情慢慢更', '直接鸽掉'], 0,
  '原话"喜欢的话欢迎三连呀，我们会超快速更新完～"，获赞约 4251。');

// ═══ 梗与弹幕 ═══
add('梗与弹幕', 'hard', '全部弹幕里出现次数最多的梗是？', ['啊？', '真实', '俺也一样', '好耶'], 0,
  '"啊？"以 5424 次登顶，领先"真实"（3587 次）和"俺也一样"（3524 次）。');
add('梗与弹幕', 'medium', '《伪人超市来了两个神人店员》40 秒附近的弹幕高峰里，刷得最多的是哪个颜文字？', ['^q^', '哈哈哈', '6', '笑死'], 0,
  '40 秒处出现 492 条的峰值，满屏都是"^q^"。');
add('梗与弹幕', 'medium', '《进来被我表白！！》哪个位置的弹幕最密集？', ['开播 20 秒附近', '视频开头', '视频中段', '结尾附近'], 0,
  '开播 20 秒处出现 1027 条的弹幕峰值，观众刷的是"炽焰天穹be like："等梗。');

// ═══ 账号档案 ═══
choice('账号档案', 'easy', '怒九主号简介里留的微博账号是？', ['@怒九今天爆肝了吗', '@怒九今天更新了吗', '@怒九爆肝日记', '@怒九笑超话'], 0,
  '主号签名写着"微博@怒九今天爆肝了吗"，还留了合作邮箱 chickenfish@vip.qq.com。');
add('账号档案', 'easy', '主号"怒九笑"的粉丝数大约是多少？', ['约214万', '约60万', '约500万', '约100万'], 0,
  '主号粉丝约 214.3 万，小号"怒九摸鱼馆"约 60 万。');
add('账号档案', 'medium', '主号"怒九笑"账号主页显示的累计获赞大约是多少？', ['约1377万', '约137万', '约6000万', '约500万'], 0,
  '主号获赞约 1377 万，小号约 132 万。');
choice('账号档案', 'easy', '小号"怒九摸鱼馆"的简介说开小号是为了什么？', ['投些开心摸鱼的视频', '发自拍和日常照片', '直播打游戏', '转发大号动态'], 0,
  '签名原文："这是怒九小号，打算投些开心摸鱼的视频！"');

// ═══ 真假判断 ═══
addTrueFalse('真假判断', 'medium', '《双影奇境》既是播放量最高的视频，也是时长最长的视频。', true,
  '播放约 791 万、合集时长约 744 分钟，两项纪录都属于它。');
addTrueFalse('真假判断', 'easy', '"爆炸电台"系列目前一共有 4 期。', true,
  '《姐妹俩打打闹闹的日常》《爆米花电台02》《出国逛游戏展》《我们俩第一次出国》正好 4 期。');
addTrueFalse('真假判断', 'medium', '《星露谷！田园开荒生活》已经把春夏秋冬四季更新完了。', false,
  '目前只更到《第一年 秋》，冬天的部分还没有出。');
addTrueFalse('真假判断', 'medium', '小号的第一部投稿是游戏实况。', false,
  '小号首投《【TWO TIME※】上课摸的鱼》是翻唱/音乐类。');
addTrueFalse('真假判断', 'medium', '索尼中国的官方账号在怒九的视频评论区留过言。', true,
  '在《甲方：你好像在玩一种很新的索尼电视广告……》下留言，获赞约 4514。');
addTrueFalse('真假判断', 'easy', '怒九的主号和小号都是 B 站 6 级。', true, '两个账号等级都是 6 级。');
addTrueFalse('真假判断', 'medium', '《让我们快乐地搬家吧！》被归类为游戏实况。', false,
  '虽然标题提到搬家，它其实是翻唱/音乐类，而且是全站点赞最高的视频。');
addTrueFalse('真假判断', 'hard', '《我画了一本书！》被归类为绘画/手书。', false,
  '尽管标题说"画了一本书"，它被归入翻唱/音乐类（有声读物形式）。');
addTrueFalse('真假判断', 'hard', '全站被分享最多的视频来自"撩到我算我输"系列。', true,
  '《【撩到我 算我输】玛丽苏用力过猛的游戏》被分享 12182 次，排名第一。');
addTrueFalse('真假判断', 'easy', '小号的粉丝数比主号多。', false, '小号约 60 万，主号约 214.3 万。');
addTrueFalse('真假判断', 'easy', '小号简介里说打算投些"开心摸鱼的视频"。', true,
  '签名原文："这是怒九小号，打算投些开心摸鱼的视频！"');
addTrueFalse('真假判断', 'medium', '《初次参加面试》和《我们的新游戏发布？！》都是 Warma、怒九、捏碳的三人合作。', true,
  '两部标题都写着三人，分别是 2020 年和 2022 年的两次合作。');
addTrueFalse('真假判断', 'medium', '怒九发过很多部"直播录像"类视频。', false,
  '台账里直播录像只有 1 部：2019 年的《国产良心像素游戏》。');
addTrueFalse('真假判断', 'medium', '《伪人超市来了两个神人店员》发布在小号。', true,
  '2026-08-16 发布在小号"怒九摸鱼馆"。');
addTrueFalse('真假判断', 'medium', '"bilibili 知名UP主"官方认证两个账号都有。', false,
  '只有主号"怒九笑"带知名UP主认证。');

// ═══ Output ═══
const titleCandidates = new Set(videos.map(v => shortTitle(v)));
const knownTypes = new Set(topTypes.map(([type]) => type));
const invalidAnswerPlaceholders = new Set(['不知道', '未知', '无法判断', '没有']);
const qualityIssue = question => {
  if (!question.q || !Array.isArray(question.options) || !question.explanation) return 'shape';
  const options = question.options.map(String);
  if (question.format === 'mc') {
    if (options.length !== 4 || new Set(options).size !== 4) return 'shape';
    if (options.some(option => !option.trim())) return 'blank';
    const correct = options[question.answer];
    if (!correct?.trim()) return 'shape';
    const stem = question.q;
    const mechanicalStemPatterns = [
      /第\s*\d+\s*(?:高|低|位)/,
      /弹幕名梗榜第/,
      /发布于哪一年|发布在哪一年|在哪一年玩/,
      /发布在哪个账号|发布在小号还是主号/,
      /属于哪个内容类型|属于什么内容类型|属于什么类型|属于哪个类型/,
      /是什么类型的内容|是什么类型的合作/,
      /标签.*出现了多少次/,
      /(?:名梗|弹幕).*(?:共重复多少次|出现了多少次)/,
      /(?:年)\s*怒九发布了多少部视频/,
      /(?:大约)?发了多少条评论/,
      /当前台账共收录|收录了多少部视频|主号 \+ 小号总共发了|当前台账共抓取到|当前累计抓取到|当前共有多少部视频有字幕数据|技巧台账总共覆盖|技巧台账总共抓取|总共发了多少个视频|在当前台账中/,
      /当前收录记录中，最早的|收录记录中的第一部视频|类收录视频里时长最长/,
      /是什么类型(?:的游戏)?？|这是什么类型？/,
    ];
    if (mechanicalStemPatterns.some(pattern => pattern.test(stem))) return 'mechanical';
    if (/哪一年|发布于哪一年|发布在哪一年/.test(stem)) {
      if (!options.every(option => /^(?:约\s*)?\d{4}(?:年)?$/.test(option.trim()))) return 'year-form';
    }
    if (/(?:发布于|发布在|发布).*(?:什么时候|哪一天|哪一月)/.test(stem)) {
      if (!options.every(option => /^\d{4}-\d{2}-\d{2}$/.test(option.trim()))) return 'date-form';
    }
    if (/属于哪个内容类型|属于哪个类型|属于什么内容类型|是什么内容类型/.test(stem)) {
      if (!options.every(option => knownTypes.has(option))) return 'type-domain';
    }
    if (/哪个账号|发布在哪个账号/.test(stem)) {
    if (!options.every(option => /主号|小号|两者完全一样|两者一样|完全一样|无法比较|两个账号都发过|两边都发布|两个都发了|都没发|没有收录|没有发过|未在怒九账号发布|Warma的账号/.test(option))) return 'account-domain';
    }
    if (/多少|几个|几部|几次|几条|几行|约是多少|大约是多少|多少倍/.test(stem) && !/哪一年|年份|什么时候|哪一天/.test(stem)) {
      const info = numericOptionInfo(correct);
      if (!info || !options.every(option => sameNumericForm(correct, option))) return 'numeric-form';
      if (/%|％|率/.test(stem) && !options.every(option => /%|％/.test(option))) return 'percent-form';
    }
    if (/哪一部视频|哪个视频|出自哪部视频|哪一视频/.test(stem)) {
      const recognizable = option => titleCandidates.has(option) || videos.some(v => v.title.includes(option.replace(/…$/, '')));
      if (!options.every(recognizable)) return 'title-domain';
    }
    if (/是谁|谁发的|和谁|合作对象/.test(stem)) {
      if (options.some(option => invalidAnswerPlaceholders.has(option))) return 'invalid-distractor';
    }
  }
  return '';
};

const finalQuestions = [];
const seenQuestion = new Set();
const rejectedQuestions = [];
for (const question of questions) {
  const reason = qualityIssue(question);
  if (reason) {
    rejectedQuestions.push({ id: question.id, reason, question });
    console.warn(`Quality gate rejected #${question.id} [${reason}]: ${question.q}`);
    continue;
  }
  if (seenQuestion.has(question.q)) continue;
  seenQuestion.add(question.q);
  finalQuestions.push({ ...question, id: finalQuestions.length + 1 });
}

const output = {
  version: 3,
  total: finalQuestions.length,
  categories: [...new Set(finalQuestions.map(q=>q.category))],
  questions: finalQuestions,
};

fs.writeFileSync(
  path.join(ROOT, 'site', 'data-quiz.js'),
  '// Auto-generated by generate_quiz.js\nconst QUIZ_DATA = ' + JSON.stringify(output.questions, null, 0) + ';\n',
  'utf8',
);
console.log(`Generated ${output.total} questions across ${output.categories.length} categories`);
console.log(`Quality gate rejected ${rejectedQuestions.length} questions`);
console.log('Categories:', output.categories.join(', '));
