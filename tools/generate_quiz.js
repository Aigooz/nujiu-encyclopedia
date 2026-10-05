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
const shuffle = arr => { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
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
  const suffix = match[4] ? ` ${match[4]}` : '';
  const options = [0.75, 1.25, 1.5, 2, 0.5].map(factor =>
    `${match[1] || ''}${fmtNum(Math.round(raw * factor))}${suffix}`
  );
  if (raw < 10) {
    options.push(...[1, 2, 3, -1, 5, 7].map(delta => raw + delta).filter(n => n > 0).map(String));
  }
  return options;
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
  return choiceRaw(category, difficulty, q, correct, wrongPool, explanation);
};
const choiceRaw = (category, difficulty, q, correct, wrongPool, explanation) => {
  const unique = [String(correct)];
  const seen = new Set(unique);
  const candidates = [...wrongPool, ...semanticDistractors(correct)];
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
for (const [key, label] of [
  ['view','播放量'], ['like','点赞数'], ['danmaku','弹幕数'],
  ['coin','投币数'], ['favorite','收藏数'], ['share','分享数'], ['reply','评论数'],
]) {
  const sorted = topBy(key);
  choice('数据之最', 'easy', `怒九${label}最高的视频是哪一部？`, shortTitle(sorted[0]),
    videos.filter(v => v.bvid !== sorted[0].bvid).slice(0,30).map(v=>shortTitle(v)), `《${shortTitle(sorted[0])}》的${label}是 ${fmtNum(sorted[0][key])}。`);
}
const durationSorted = topBy('duration');
const longestDurationVideo = durationSorted[0];
const shortestDurationVideo = durationSorted[durationSorted.length - 1];
choice('数据之最', 'medium', '哪一部视频的时长最长？', shortTitle(longestDurationVideo), durationSorted.slice(1,10).map(v=>shortTitle(v)), `最长视频时长约 ${fmtDur(longestDurationVideo.duration)}。`);
choice('数据之最', 'medium', '哪一部视频的时长最短？', shortTitle(shortestDurationVideo), durationSorted.slice(-10,-1).reverse().map(v=>shortTitle(v)), `最短视频时长约 ${fmtDur(shortestDurationVideo.duration)}。`);
add('数据之最', 'medium', '哪一部视频的字幕行数最多？', shortTitle(topBy('sub_lines')[0]), topBy('sub_lines').slice(1,10).map(shortTitle), `该视频共 ${fmtNum(topBy('sub_lines')[0].sub_lines)} 行字幕。`);
add('数据之最', 'hard', '最长一次连续拖更间隔是多少天？', `${maxGap.gap_days}天`, [`${maxGap.gap_days+1}天`,`${maxGap.gap_days+3}天`,`${Math.max(1,maxGap.gap_days-3)}天`], `出现在《${shortTitle(maxGap)}》之前。`);
add('数据之最', 'easy', '当前台账共收录多少部视频？', String(videos.length), [String(videos.length+10),String(videos.length-10),String(videos.length+50)], `主号 ${main.length} 部，小号 ${small.length} 部。`);
add('数据之最', 'easy', '当前台账累计播放量约为多少？', fmtNum(Math.round(RAW.stats?.view/10000)*10000), [fmtNum(Math.round(RAW.stats?.view*0.9/10000)*10000),fmtNum(Math.round(RAW.stats?.view*1.1/10000)*10000),fmtNum(Math.round(RAW.stats?.view*0.5/10000)*10000)], `累计播放约 ${fmtNum(RAW.stats?.view)}。`);
add('数据之最', 'medium', '怒九有多个视频播放量突破了 300 万？', ['约 30 个','约 15 个','约 50 个','约 10 个'], 0, `播放量 300 万以上的视频约有 ${videos.filter(v=>v.view>=3000000).length} 个。`);
const lowestViewVideo = topBy('view')[topBy('view').length - 1];
choice('数据之最', 'hard', '怒九播放量最低的视频属于哪个内容类型？', lowestViewVideo.type, topTypes.map(x=>x[0]).filter(t=>t!==lowestViewVideo.type), `该视频类型是 ${lowestViewVideo.type}。`);
choice('数据之最', 'medium', '怒九总投币数大约是多少？', fmtNum(Math.round(RAW.stats?.coin/10000)*10000), [fmtNum(Math.round(RAW.stats?.coin*0.5/10000)*10000),fmtNum(Math.round(RAW.stats?.coin*2/10000)*10000),fmtNum(Math.round(RAW.stats?.coin*0.1/10000)*10000)], `总投币数约 ${fmtNum(RAW.stats?.coin)}。`);
choice('数据之最', 'medium', '怒九总收藏数大约是多少？', fmtNum(Math.round(RAW.stats?.favorite/10000)*10000), [fmtNum(Math.round(RAW.stats?.favorite*0.5/10000)*10000),fmtNum(Math.round(RAW.stats?.favorite*2/10000)*10000),fmtNum(Math.round(RAW.stats?.favorite*0.1/10000)*10000)], `总收藏数约 ${fmtNum(RAW.stats?.favorite)}。`);
choice('数据之最', 'hard', '怒九总分享数大约是多少？', fmtNum(Math.round(RAW.stats?.share/10000)*10000), [fmtNum(Math.round(RAW.stats?.share*0.5/10000)*10000),fmtNum(Math.round(RAW.stats?.share*2/10000)*10000),fmtNum(Math.round(RAW.stats?.share*0.1/10000)*10000)], `总分享数约 ${fmtNum(RAW.stats?.share)}。`);
choice('数据之最', 'medium', '怒九总评论数大约是多少？', fmtNum(Math.round(RAW.stats?.reply/10000)*10000), [fmtNum(Math.round(RAW.stats?.reply*0.5/10000)*10000),fmtNum(Math.round(RAW.stats?.reply*2/10000)*10000),fmtNum(Math.round(RAW.stats?.reply*0.1/10000)*10000)], `总评论数约 ${fmtNum(RAW.stats?.reply)}。`);
choice('数据之最', 'medium', '怒九总弹幕数大约是多少？', fmtNum(Math.round(RAW.stats?.danmaku/10000)*10000), [fmtNum(Math.round(RAW.stats?.danmaku*0.5/10000)*10000),fmtNum(Math.round(RAW.stats?.danmaku*2/10000)*10000),fmtNum(Math.round(RAW.stats?.danmaku*0.1/10000)*10000)], `总弹幕数约 ${fmtNum(RAW.stats?.danmaku)}。`);

// ═══ 发布规律 ═══
add('发布规律', 'easy', '怒九发布视频最多的是哪一年？', `${topYears[0][0]}年`, topYears.slice(1,7).map(([y])=>`${y}年`), `${topYears[0][0]} 年共有 ${topYears[0][1]} 部投稿。`);
add('发布规律', 'medium', '第一部收录视频发布于哪一年？', `${videos[0].date.slice(0,4)}年`, ['2015年','2016年','2018年'].filter(x=>x!==`${videos[0].date.slice(0,4)}年`), `第一部是《${shortTitle(videos[0])}》。`);
add('发布规律', 'medium', '小号"怒九摸鱼馆"收录了多少部视频？', String(small.length), [String(small.length+5),String(small.length-5),String(small.length*2)], `主号另收录 ${main.length} 部。`);
add('发布规律', 'easy', '主号"怒九笑"收录了多少部视频？', String(main.length), [String(main.length+10),String(main.length-10),String(main.length+30)], `小号另收录 ${small.length} 部。`);
add('发布规律', 'easy', '主号 + 小号总共发了多少个视频？', ['约 200 个','约 300 个','约 150 个','约 250 个'], 0, `共收录了 ${videos.length} 个视频（主号 ${main.length} + 小号 ${small.length}）。`);
choice('发布规律', 'medium', '怒九在 B 站的第一个视频发布于什么时候？', videos[0].date, ['2017-06-25','2017-10-25','2018-01-25'], `第一个视频《${shortTitle(videos[0])}》发布于 ${videos[0].date}。`);
for (const year of Object.keys(yearCounter).filter(y=>Number(y)>=2022)) {
  choice('发布规律', 'medium', `${year} 年怒九发布了多少部视频？`, String(yearCounter[year]), [String(yearCounter[year]+1),String(Math.max(1,yearCounter[year]-1)),String(yearCounter[year]+5)], `按当前抓取记录，${year} 年共 ${yearCounter[year]} 部。`);
}
{
  const hourCount = {};
  videos.forEach(v=>{ if(v.pubdate_iso){ const h=parseInt(v.pubdate_iso.split(' ')[1]?.split(':')[0]); if(!isNaN(h)) hourCount[h]=(hourCount[h]||0)+1; }});
  const topHour = Object.entries(hourCount).sort((a,b)=>b[1]-a[1])[0];
  if (topHour) {
    add('发布规律', 'easy', '怒九最常在什么时间发布视频？',
      [`${topHour[0]} 点`, `${(Number(topHour[0])+4)%24} 点`, `${(Number(topHour[0])+8)%24} 点`, `${(Number(topHour[0])+12)%24} 点`], 0,
      `${topHour[0]} 点是最高频的发布时间，共 ${topHour[1]} 个视频在此时发布。`);
  }
}
{
  const wd = ['周日','周一','周二','周三','周四','周五','周六'];
  const wdCount = {};
  videos.forEach(v=>{ if(v.date){ const d=new Date(v.date+'T12:00:00'); wdCount[wd[d.getDay()]]=(wdCount[wd[d.getDay()]]||0)+1; }});
  const topDay = Object.entries(wdCount).sort((a,b)=>b[1]-a[1])[0];
  if (topDay) {
    add('发布规律', 'easy', '怒九最常在星期几发布视频？',
      [topDay[0], ...wd.filter(x=>x!==topDay[0]).slice(0,3)], 0,
      `${topDay[0]}是最高频的发布日，共 ${topDay[1]} 个视频。`);
  }
}
{
  const newest = [...videos].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
  choice('发布规律', 'medium', '最新收录的视频发布于哪一天？', newest.date, [newest.date.replace(/\d{2}$/,'01'),newest.date.replace(/\d{4}$/,'0101'),'2026-01-01'], `最新视频是《${shortTitle(newest)}》发布于 ${newest.date}。`);
}
{
  const gapBands = {};
  videos.forEach(v=>{ if(v.gap_band) gapBands[v.gap_band]=(gapBands[v.gap_band]||0)+1; });
  const topBand = Object.entries(gapBands).sort((a,b)=>b[1]-a[1])[0];
  if (topBand) {
    choice('发布规律', 'hard', '最常见的投稿间隔等级是什么？', topBand[0], Object.keys(gapBands).filter(x=>x!==topBand[0]), `${topBand[0]} 等级共有 ${topBand[1]} 部视频。`);
  }
}

// ═══ 标签与分类 ═══
choice('标签与分类', 'easy', '使用次数最多的标签是什么？', topTags[0][0], topTags.slice(1,10).map(x=>x[0]), `标签统计里"${topTags[0][0]}"出现 ${topTags[0][1]} 次。`);
choice('标签与分类', 'easy', '数量最多的视频类型是什么？', topTypes[0][0], topTypes.slice(1,10).map(x=>x[0]), `${topTypes[0][0]} 共有 ${topTypes[0][1]} 部。`);
choice('标签与分类', 'medium', '第二多的视频类型是什么？', topTypes[1][0], [topTypes[0][0],...topTypes.slice(2,9).map(x=>x[0])], `${topTypes[1][0]} 共有 ${topTypes[1][1]} 部。`);
choice('标签与分类', 'medium', '哪一类内容的播放量贡献最高？', typeViews[0][0], typeViews.slice(1,10).map(x=>x[0]), `${typeViews[0][0]} 累计播放 ${fmtNum(typeViews[0][1])}。`);
choice('标签与分类', 'hard', `"${topTags[1][0]}"标签出现了多少次？`, String(topTags[1][1]), [String(topTags[1][1]+1),String(Math.max(1,topTags[1][1]-1)),String(topTags[1][1]+5)], `仅低于"${topTags[0][0]}"。`);
choice('标签与分类', 'medium', '怒九的"绘画/手书"类视频大约有多少部？', String(typeCounter['绘画/手书']), [String(typeCounter['绘画/手书']+10),String(typeCounter['绘画/手书']-5),'50'], `绘画/手书类共有 ${typeCounter['绘画/手书']} 部。`);
choice('标签与分类', 'medium', '怒九的"搞笑娱乐"类视频大约有多少部？', String(typeCounter['搞笑娱乐']), [String(typeCounter['搞笑娱乐']+5),String(typeCounter['搞笑娱乐']-3),'30'], `搞笑娱乐类共有 ${typeCounter['搞笑娱乐']} 部。`);
choice('标签与分类', 'medium', '怒九的"爆炸电台"类视频有多少部？', String(typeCounter['爆炸电台']), [String(typeCounter['爆炸电台']+2),String(typeCounter['爆炸电台']-1),'10'], `爆炸电台类共有 ${typeCounter['爆炸电台']} 部。`);
choice('标签与分类', 'hard', '怒九的"直播录像"类视频有多少部？', String(typeCounter['直播录像']), ['2','3','0'], `直播录像类只有 ${typeCounter['直播录像']} 部。`);
choice('标签与分类', 'hard', '怒九的"知识科普"类视频大约有多少部？', String(typeCounter['知识科普']), [String(typeCounter['知识科普']+5),String(typeCounter['知识科普']-3),'20'], `知识科普类共有 ${typeCounter['知识科普']} 部。`);

// ═══ 梗与弹幕 ═══
choice('梗与弹幕', 'easy', '怒九视频中弹幕出现次数最高的名梗是什么？', topMemes[0]?.content || '啊？', topMemes.slice(1,10).map(x=>x.content), `"${topMemes[0]?.content}"重复 ${fmtNum(topMemes[0]?.count)} 次。`);
choice('梗与弹幕', 'medium', '弹幕名梗榜第二名是什么？', topMemes[1]?.content || '真实', [topMemes[0]?.content,...topMemes.slice(2,10).map(x=>x.content)].filter(Boolean), `"${topMemes[1]?.content}"重复 ${fmtNum(topMemes[1]?.count)} 次。`);
choice('梗与弹幕', 'medium', '哪一年的弹幕最活跃？', `${yearlyDanmaku[0]?.[0]}年`, yearlyDanmaku.slice(1,7).map(([y])=>`${y}年`), `${yearlyDanmaku[0]?.[0]} 年弹幕量高达 ${fmtNum(yearlyDanmaku[0]?.[1])}。`);
choice('梗与弹幕', 'hard', `"${topMemes[0]?.content}"共重复多少次？`, fmtNum(topMemes[0]?.count), [fmtNum(topMemes[0]?.count*2),fmtNum(Math.round(topMemes[0]?.count*0.5)),fmtNum(topMemes[0]?.count+100)], `全站弹幕聚合结果为 ${fmtNum(topMemes[0]?.count)}。`);
choice('梗与弹幕', 'medium', '"俺也一样"弹幕大约出现了多少次？', fmtNum(topMemes[2]?.count), [fmtNum(topMemes[2]?.count*2),fmtNum(Math.round(topMemes[2]?.count*0.5)),fmtNum(topMemes[2]?.count+500)], `约 ${fmtNum(topMemes[2]?.count)} 次。`);
choice('梗与弹幕', 'easy', '"好耶"弹幕大约出现了多少次？', fmtNum(topMemes[3]?.count), [fmtNum(topMemes[3]?.count*2),fmtNum(Math.round(topMemes[3]?.count*0.5)),fmtNum(topMemes[3]?.count+500)], `约 ${fmtNum(topMemes[3]?.count)} 次。`);
choice('梗与弹幕', 'hard', '当前台账共抓取到多少条弹幕原始记录？', fmtNum(RAW.stats?.danmaku_records || 0), [fmtNum(Math.round((RAW.stats?.danmaku_records||0)*0.5)),fmtNum((RAW.stats?.danmaku_records||0)+50000),fmtNum(Math.round((RAW.stats?.danmaku_records||0)*2))], `当前台账记录约 ${fmtNum(RAW.stats?.danmaku_records)} 条。`);
choice('梗与弹幕', 'hard', '弹幕中出现次数第五高的名梗是什么？', topMemes[4]?.content || '新年快乐！', [topMemes[0]?.content,topMemes[1]?.content,topMemes[2]?.content], `"${topMemes[4]?.content}"重复 ${fmtNum(topMemes[4]?.count)} 次。`);

// ═══ 字幕探索 ═══
choice('字幕探索', 'easy', '当前累计抓取到多少行字幕？', fmtNum(RAW.stats?.sub_lines || 0), [fmtNum(Math.round((RAW.stats?.sub_lines||0)*0.8)),fmtNum(Math.round((RAW.stats?.sub_lines||0)*1.2)),fmtNum(Math.round((RAW.stats?.sub_lines||0)*0.5))], `覆盖 ${videos.filter(v=>v.sub_lines>0).length} 部有字幕视频。`);
choice('字幕探索', 'medium', `《${shortTitle(topBy('sub_chars')[0])}》在字幕分析中的字幕量是多少？`, `${fmtNum(topBy('sub_chars')[0].sub_chars)} 字符`, [`${fmtNum(topBy('sub_chars')[0].sub_chars*2)} 字符`,`${fmtNum(Math.round(topBy('sub_chars')[0].sub_chars*0.5))} 字符`,`${fmtNum(topBy('sub_chars')[0].sub_chars+100)} 字符`], `它也是字幕字符最多的视频之一。`);
{
  const quoted = videos.filter(v => (v.merged || []).length && v.title);
  for (const video of shuffle(quoted).slice(0, 10)) {
    const quote = (video.merged[0] || '').replace(/\s+/g, ' ').slice(0, 55);
    if (!quote) continue;
    choice('字幕探索', 'medium', `"${quote}……"这段字幕最可能出自哪部视频？`, shortTitle(video), quoted.filter(v=>v.bvid!==video.bvid).map(shortTitle), `来自 ${video.date} 的《${shortTitle(video)}》。`);
  }
}
choice('字幕探索', 'hard', '当前共有多少部视频有字幕数据？', String(videos.filter(v=>v.sub_lines>0).length), [String(videos.filter(v=>v.sub_lines>0).length+10),String(videos.filter(v=>v.sub_lines>0).length-10),String(videos.filter(v=>v.sub_lines>0).length*2)], `有字幕 ${videos.filter(v=>v.sub_lines>0).length} 部，无字幕 ${videos.filter(v=>!v.sub_lines).length} 部。`);
choice('字幕探索', 'medium', '怒九总字幕字符数大约是多少？', fmtNum(videos.reduce((s,v)=>s+(v.sub_chars||0),0)), [fmtNum(Math.round(videos.reduce((s,v)=>s+(v.sub_chars||0),0)*0.5)),fmtNum(Math.round(videos.reduce((s,v)=>s+(v.sub_chars||0),0)*2)),fmtNum(Math.round(videos.reduce((s,v)=>s+(v.sub_chars||0),0)*0.1))], `总字幕字符约 ${fmtNum(videos.reduce((s,v)=>s+(v.sub_chars||0),0))}。`);

// ═══ 评论区 ═══
choice('评论区', 'easy', '当前共抓取到多少条前台热门评论？', fmtNum(flatComments.length), [fmtNum(flatComments.length+1000),fmtNum(Math.round(flatComments.length*0.5)),fmtNum(flatComments.length+100)], `覆盖 ${Object.keys(RAW_COMMENTS).length} 部视频。`);
{
  const topComment = flatComments.slice().sort((a,b)=>(b.like||0)-(a.like||0))[0];
  if (topComment) {
    const topVideo = videos.find(v=>v.bvid===topComment.bvid);
    choice('评论区', 'medium', '当前抓取到的点赞最高的评论来自哪个视频？',
      topVideo ? shortTitle(topVideo) : '未知', videos.filter(v=>v.bvid!==topComment.bvid).slice(0,20).map(shortTitle),
      `原视频是《${topVideo ? shortTitle(topVideo) : '未知'}》，点赞 ${fmtNum(topComment.like)}。`);
  }
}
{
  const commentAuthor = flatComments.reduce((acc,c)=>{ if(c.name) acc[c.name]=(acc[c.name]||0)+1; return acc; },{});
  const topCommenters = Object.entries(commentAuthor).sort((a,b)=>b[1]-a[1]);
  if (topCommenters.length > 3) {
    choice('评论区', 'hard', '在当前抓取样本中，出现评论最多的是谁？', topCommenters[0][0], topCommenters.slice(1,12).map(x=>x[0]), `共抓到 ${topCommenters[0][1]} 条评论。`);
    choice('评论区', 'medium', '评论区第二活跃的用户大约发了多少条评论？', String(topCommenters[1][1]), [String(topCommenters[1][1]+5),String(Math.max(1,topCommenters[1][1]-3)),String(topCommenters[1][1]*2)], `${topCommenters[1][0]} 共 ${topCommenters[1][1]} 条。`);
  }
}
{
  const warmaComments = flatComments.filter(c => c.name && (c.name.includes('warma') || c.name.includes('Warma')));
  add('评论区', 'hard', 'Warma 在怒九的评论区发过评论吗？',
    ['有', '没有', '不确定', '只发过一条'], 0,
    `Warma 在怒九评论区留下了 ${warmaComments.length} 条评论（含回复），是真实的合作互动记录。`);
}
{
  const topLiked = flatComments.slice().sort((a,b)=>(b.like||0)-(a.like||0)).slice(0,5);
  for (const tc of topLiked.slice(0, 3)) {
    const msg = String(tc.message || '').replace(/\s+/g, ' ').slice(0, 35);
    if (!msg) continue;
    const video = videos.find(v=>v.bvid===tc.bvid);
    choice('评论区', 'hard', `"${msg}……"这条高赞评论出自哪个视频？`,
      video ? shortTitle(video) : '未知', videos.filter(v=>v.bvid!==tc.bvid).slice(0,15).map(shortTitle),
      `来自《${video ? shortTitle(video) : '未知'}》，点赞 ${fmtNum(tc.like)}。`);
  }
}

// ═══ 深度对比 ═══
choice('深度对比', 'medium', '哪个账号收录的视频播放量更高？', '主号（怒九笑）', ['小号（怒九摸鱼馆）','两者完全一样','无法比较'], `主号播放 ${fmtNum(sum(main,'view'))}，小号播放 ${fmtNum(sum(small,'view'))}。`);
add('深度对比', 'medium', '两个账号哪个的点赞量更高？', '主号（怒九笑）', ['小号（怒九摸鱼馆）','两者一样','无法比较'], `主号点赞 ${fmtNum(sum(main,'like'))}，小号点赞 ${fmtNum(sum(small,'like'))}。`);
add('深度对比', 'easy', '主号"怒九笑"的粉丝量更接近哪个数？', fmtNum(mainProfile.fans || 2142890), [fmtNum(smallProfile.fans || 600230), fmtNum(Math.round((mainProfile.fans||2142890)/10)), fmtNum((mainProfile.fans||2142890)*10)], `快照粉丝数 ${fmtNum(mainProfile.fans || 2142890)}。`);
add('深度对比', 'medium', '小号"怒九摸鱼馆"的粉丝量更接近哪个数？', fmtNum(smallProfile.fans || 600230), [fmtNum(mainProfile.fans || 2142890), fmtNum(Math.round((smallProfile.fans||600230)/10)), fmtNum((smallProfile.fans||600230)*2)], `快照粉丝数 ${fmtNum(smallProfile.fans || 600230)}。`);
add('深度对比', 'hard', '哪个账号的平均单部播放量更高？', '主号（怒九笑）', ['小号（怒九摸鱼馆）','完全一样','无法比较'], `主号均播 ${fmtNum(Math.round(sum(main,'view')/main.length))}，小号均播 ${fmtNum(Math.round(sum(small,'view')/small.length))}。`);
add('深度对比', 'medium', '主号和小号加起来粉丝大约有多少？', ['约 270 万','约 150 万','约 500 万','约 100 万'], 0, `主号约 ${fmtNum(mainProfile.fans || 2142890)} + 小号约 ${fmtNum(smallProfile.fans || 600230)} ≈ 275 万总粉丝。`);
add('深度对比', 'medium', '怒九所有视频的总点赞数大约是多少？', ['约 1700 万','约 500 万','约 3000 万','约 800 万'], 0, `总点赞数高达 ${fmtNum(RAW.stats?.like)}！`);
add('深度对比', 'hard', '怒九所有视频的字幕加起来大约有多少行？', ['约 4 万行','约 1 万行','约 8 万行','约 2 万行'], 0, `总字幕行数约 ${fmtNum(RAW.stats?.sub_lines)} 行。`);
add('深度对比', 'hard', '主号总播放量大约是小号的多少倍？', ['约 7 倍','约 3 倍','约 15 倍','约 20 倍'], 0, `主号总播放约 ${fmtNum(sum(main,'view'))}，小号约 ${fmtNum(sum(small,'view'))}。`);
{
  const champ = [...videos].filter(v=>v.view>10000).sort((a,b)=>(b.like/b.view)-(a.like/a.view))[0];
  if (champ) {
    choice('深度对比', 'hard', '点赞率最高（点赞÷播放）的视频是哪一个？',
      shortTitle(champ), videos.filter(v=>v.view>10000 && v.bvid!==champ.bvid).slice(0,15).map(shortTitle),
      `《${shortTitle(champ)}》的点赞率高达 ${(champ.like/champ.view*100).toFixed(1)}%。`);
  }
}
choice('深度对比', 'medium', '怒九主号的 B 站等级是多少？', `${mainProfile.level || 6} 级`, ['5 级','4 级','7 级'], `主号和小号都达到了 B 站 ${mainProfile.level || 6} 级。`);
choice('深度对比', 'hard', '怒九两个账号的等级是否一样？', '一样，都是 6 级', ['不一样','主号 7 级','小号 5 级'], `主号 ${mainProfile.level || 6} 级，小号 ${smallProfile.level || 6} 级。`);

// ═══ 冷知识 ═══
choice('冷知识', 'easy', '主号"怒九笑"的 UID 是多少？', '14751040', ['14751041','693485501','1730275511'], '主号空间链接为 UID 14751040。');
choice('冷知识', 'easy', '小号"怒九摸鱼馆"的 UID 是多少？', '693485501', ['693485502','14751040','53456'], '小号空间链接为 UID 693485501。');
choice('冷知识', 'medium', '主号签名中提到的合作邮箱域名是什么？', 'qq.com', ['163.com','gmail.com','outlook.com'], mainProfile.sign || '签名中写有合作邮箱。');
choice('冷知识', 'medium', '小号的签名如何介绍大号？', '"大号@怒九笑"', ['"我是大号"','"没有大号"','"合作号"'], smallProfile.sign || '小号签名标注了大号。');
add('冷知识', 'easy', '怒九的小号叫什么名字？', '怒九摸鱼馆', ['怒九日常','怒九小号','摸鱼号'], `小号"怒九摸鱼馆"主要发游戏实况和日常碎片。`);
add('冷知识', 'medium', '怒九主号的官方认证是什么？', 'bilibili 知名UP主', ['bilibili 优质UP主','bilibili 知名画师','没有认证'], `主号有"bilibili 知名UP主"认证。`);
add('冷知识', 'medium', '怒九的微博账号是什么？', '@怒九今天爆肝了吗', ['@怒九笑','@怒九official','@nujiu_nujiu'], `主号签名写有"微博@怒九今天爆肝了吗"。`);
add('冷知识', 'hard', '怒九最频繁的合作对象是谁？', 'Warma', ['捏碳','岚少','CB'], `Warma 是怒九最频繁的合作对象，两人一起做了很多双人游戏实况。`);
add('冷知识', 'hard', '怒九和 Warma 是什么关系？', ['兄妹', '朋友', '同学', '同事'], 0, `从"看亲哥玩恐怖游戏"等标题可以看出他们是兄妹关系。`);
add('冷知识', 'medium', '怒九百科技巧台账总共覆盖了多少个视频？', String(videos.length), [String(videos.length+20),String(videos.length-20),'300'], `当前覆盖 ${videos.length} 部视频。`);
add('冷知识', 'hard', '怒九百科技巧台账总共抓取了多少条评论？', fmtNum(flatComments.length), [fmtNum(flatComments.length*2),fmtNum(Math.round(flatComments.length*0.5)),'50000'], `共抓取了 ${fmtNum(flatComments.length)} 条评论。`);
add('冷知识', 'hard', '怒九百科技巧台账总共抓取了多少条弹幕？', fmtNum(RAW.stats?.danmaku_records || 0), [fmtNum(Math.round((RAW.stats?.danmaku_records||0)*0.5)),fmtNum((RAW.stats?.danmaku_records||0)*2)], `共抓取了 ${fmtNum(RAW.stats?.danmaku_records)} 条弹幕。`);
add('冷知识', 'medium', '怒九百科技巧台账的年限跨度大约是多少？', ['约 9 年','约 5 年','约 3 年','约 15 年'], 0, `从 ${videos[0].date} 到 ${videos[videos.length-1].date}，跨度约 9 年。`);

// ═══ 视频内容（手写精品题） ═══
{
  add('视频内容', 'easy', '怒九的第一部视频是什么类型的内容？',
    ['绘画/手书', '游戏实况', '翻唱', '电台'], 0,
    '《【守望先锋手书】因为我们是男英雄啊！》是一部守望先锋手书作品，发布于 2017 年 8 月。');
}
{
  add('视频内容', 'easy', '《双影奇境》是怒九和谁一起合作的游戏实况？',
    ['Warma', '捏碳', '岚少', 'CB'], 0,
    '这是怒九和 Warma 合作的双人游戏实况，播放量高达 790 万，是怒九播放量最高的视频。');
}
{
  add('视频内容', 'easy', '《绝对不许关灯！》是怒九和谁一起合作的？',
    ['Warma', '捏碳', '碳碳', '独自完成的'], 0,
    '这是怒九和 Warma 合作的恐怖游戏实况，播放量约 493 万。');
}
{
  add('视频内容', 'medium', '《REANIMAL》实况的中文名是什么？',
    ['生灵重塑', '动物重生', '生物进化', '重塑纪元'], 0,
    '《REANIMAL（生灵重塑）》是怒九和 Warma 合作的横冲直撞惊险求生游戏实况。');
}
{
  add('视频内容', 'medium', '《Subnautica2》的中文名是什么？',
    ['异星水域', '深海迷航', '美丽水世界', '海底大冒险'], 0,
    'Subnautica 2 的中文翻译是《异星水域》，是一款深海探索游戏。');
}
{
  add('视频内容', 'medium', '《轨道双子星》是什么类型的游戏？',
    ['宇宙冒险', '恐怖生存', '解谜闯关', '竞速赛车'], 0,
    '《轨道双子星》是怒九和 Warma 合作的宇宙冒险游戏实况。');
}
{
  add('视频内容', 'medium', '怒九的"星露谷！田园开荒生活"系列和谁一起合作？',
    ['Warma', '捏碳', '独自完成', '碳碳'], 0,
    '这是怒九和 Warma 合作的星露谷物语田园开荒系列实况。');
}
{
  add('视频内容', 'easy', '怒九的"撩到我算我输"系列玩的是什么类型的游戏？',
    ['乙女/恋爱游戏', '恐怖游戏', '射击游戏', '模拟经营'], 0,
    '"撩到我算我输"是怒九玩各种乙女/恋爱游戏的系列，以吐槽游戏中的套路和渣男为主。');
}
{
  add('视频内容', 'easy', '怒九的"速推荐"系列内容是什么？',
    ['推荐好玩游戏', '推荐动漫', '推荐歌曲', '推荐小说'], 0,
    '"速推荐"是怒九快速推荐各类好玩游戏（尤其是像素游戏）的系列。');
}
{
  add('视频内容', 'easy', '怒九的"恐怖游戏大挑战"系列是什么内容？',
    ['玩恐怖游戏并记录反应', '恐怖故事讲述', '恐怖电影解说', '恐怖场景还原'], 0,
    '这是怒九玩各种恐怖游戏并记录自己被吓到反应的系列。');
}
{
  add('视频内容', 'medium', '怒九的"看亲哥玩恐怖游戏"系列中的"亲哥"是谁？',
    ['Warma', '捏碳', '怒九的哥哥', 'CB'], 0,
    '从内容看，"亲哥"指的是 Warma，怒九会录制 Warma 玩恐怖游戏时的反应。');
}
{
  add('视频内容', 'medium', '怒九的"全国统一的人类共同行为记录"系列目前有几期？',
    ['4 期', '3 期', '5 期', '2 期'], 0,
    '目前有 4 期：①每日の痛、②每日一气、③论文！燃尽！、④你的牙痒吗？');
}
{
  add('视频内容', 'medium', '怒九的"艺术就是___"系列内容是什么？',
    ['赛博绘画创作', '烹饪', '手工制作', '摄影'], 0,
    '这是怒九在电脑上进行赛博绘画创作的系列，标题中的"___"是留空。');
}
{
  add('视频内容', 'medium', '怒九的"这都什么乱七八糟的模拟器"系列玩的是什么？',
    ['各种奇怪模拟器', '正常模拟经营', '赛车模拟器', '飞行模拟器'], 0,
    '这是怒九试玩各种奇怪搞笑的模拟器游戏的系列。');
}
{
  add('视频内容', 'hard', '怒九的 UT（Undertale）手书主要画的是哪组角色？',
    ['人类组', '骷髅组', '怪物组', '全角色'], 0,
    '怒九的 UT 手书主要围绕人类组角色（Frisk、Chara 等）进行创作。');
}
{
  add('视频内容', 'hard', '《【UT手书】我猹就是饿死，也不会吃福你一点东西》中的"猹"是谁？',
    ['Chara', 'Frisk', 'Sans', 'Papyrus'], 0,
    '"猹"是 Chara 的谐音昵称，这是怒九的 Undertale 手书作品。');
}
{
  add('视频内容', 'medium', '怒九的"怒九的脑洞日常"系列是什么类型？',
    ['生活脑洞小剧场', '游戏攻略', '美食评测', '旅行Vlog'], 0,
    '这是怒九分享日常生活脑洞和吐槽的小剧场系列。');
}
{
  add('视频内容', 'medium', '《守望先锋手书》的完整标题是？',
    ['因为我们是男英雄啊！', '我们是英雄！', '守望先锋日常', '英雄集结'], 0,
    '完整标题是《【守望先锋手书】因为我们是男英雄啊！》，是怒九 2017 年的第一部投稿。');
}
{
  add('视频内容', 'medium', '怒九的《【中国式家长】女儿？宠就对了！》中培养了谁？',
    ['女儿', '儿子', '宠物', '自己'], 0,
    '怒九在《中国式家长》中先玩了女儿版，标题是"女儿？宠就对了！"。');
}
{
  add('视频内容', 'medium', '《友尽厨房2》是怒九和谁一起合作的？',
    ['朋友合作', 'Warma', '独自完成', '捏碳'], 0,
    '标题中有"笑爆合作"，是怒九和朋友一起玩的友尽厨房2，互相迫害的乐趣。');
}
{
  add('视频内容', 'hard', '怒九玩过的《底特律：变人》手书角色是？',
    ['汉克', '康纳', '卡拉', '马库斯'], 0,
    '《【底特律 手书】汉克想变得可爱》中画的是汉克。');
}
{
  add('视频内容', 'hard', '怒九的《杀戮天使 手书》的副标题是什么？',
    ['SECURITY CHECK', 'GAME OVER', 'HAPPY END', 'GAME START'], 0,
    '完整标题是《【杀戮天使 手书】SECURITY CHECK 见识下靠谱的成年男性》。');
}
{
  add('视频内容', 'medium', '怒九和 Warma 合作过哪个关于越狱的游戏？',
    ['逃出生天', '逃生2', '双人成行', '分手厨房'], 0,
    '《【逃出生天 衔九】悠闲养老越狱过》是怒九和 Warma 合作的越狱游戏。');
}
{
  add('视频内容', 'medium', '怒九在《Splatoon3》（斯普拉遁3）中的自嘲标题是什么？',
    ['4k狙也太难用了吧！', '我是最强乌贼！', '乌贼天花板！', '喷神驾到！'], 0,
    '标题是《【怒九】4k狙也太难用了吧！玩点不一样的Splatoon3！》。');
}
{
  add('视频内容', 'hard', '怒九和 Warma 合作的《鬼打墙了！！！！》属于什么类型？',
    ['游戏实况', '绘画手书', '翻唱', '电台'], 0,
    '《【warma/怒九】鬼打墙了！！！！》是两人合作的游戏实况，发布在小号。');
}
{
  add('视频内容', 'medium', '怒九的《【自制互动游戏】猜不到下一秒！》发布于哪一年？',
    ['2020', '2019', '2021', '2018'], 0,
    '发布于 2020 年情人节，是一个沙雕互动视频游戏。');
}
{
  add('视频内容', 'hard', '怒九的《我编了个离谱至极的校园故事！！！》属于什么类型？',
    ['游戏实况', '绘画手书', '翻唱', '科普'], 0,
    '虽然标题说的是"编故事"，但分类是游戏实况。');
}
{
  add('视频内容', 'medium', '《【warma/怒九】姐妹俩打打闹闹的日常【电台】》是哪个系列？',
    ['爆炸电台', '翻唱电台', '游戏电台', '吐槽电台'], 0,
    '这是爆炸电台类视频，发布于 2021 年 4 月。');
}
{
  add('视频内容', 'hard', '《【warma/怒九】我被开水烫伤后的养伤生活【爆米花电台02】》中谁被烫伤了？',
    ['Warma', '怒九', '捏碳', '不确定'], 0,
    '从标题看，Warma 被开水烫伤了，在电台中分享了养伤经历。');
}
{
  add('视频内容', 'medium', '怒九的《当恐怖电影套路遇到沙雕会怎么样？》属于什么类型？',
    ['绘画/手书', '游戏实况', '配音', '搞笑娱乐'], 0,
    '分类是绘画/手书，是怒九用绘画方式恶搞恐怖电影套路的作品。');
}
{
  add('视频内容', 'hard', '怒九和 Warma 合作的《去逛古怪的摆摊市集！》是什么类型？',
    ['Vlog', '游戏实况', '手书', '翻唱'], 0,
    '标题明确标注了【Vlog】，是两人线下逛古怪市集的记录。');
}
{
  add('视频内容', 'medium', '怒九的《搬家Vlog 进行一个工作间的装饰！》发布于哪一年？',
    ['2021', '2020', '2022', '2023'], 0,
    '发布于 2021 年 10 月，是怒九搬家后装饰工作间的Vlog。');
}
{
  add('视频内容', 'hard', '《【怒九】好玩到爆肝的像素游戏！》是"速推荐"的第几期？',
    ['第二期', '第一期', '第三期', '第四期'], 0,
    '这是 2018 年 6 月的"速推荐"第二期，推荐了五款好玩到爆肝的像素游戏。');
}
{
  add('视频内容', 'medium', '怒九的《论高考》视频是送给谁的？',
    ['美术生', '理科生', '文科生', '体育生'], 0,
    '标题明确写了"送给美术生的一个小视频"，是给美术高考生的鼓励。');
}
{
  add('视频内容', 'medium', '怒九的《艺术生遭受到了哪些偏见？》属于什么类型？',
    ['知识科普', '搞笑娱乐', '游戏实况', '绘画手书'], 0,
    '这是知识科普类视频，讨论艺术生遭受的偏见和误解。');
}
{
  add('视频内容', 'hard', '怒九在《看门狗2》实况中把游戏玩成了什么？',
    ['旅游团', '射击游戏', '赛车游戏', '潜行游戏'], 0,
    '标题是《我们九某人旅游团！带你游遍旧金山！》，把看门狗2玩成了旧金山旅游。');
}
{
  add('视频内容', 'medium', '《凶宅惊魂》是怒九在哪一年玩的？',
    ['2018', '2017', '2019', '2020'], 0,
    '发布于 2018 年 10 月，恰好在万圣节前夕。');
}
{
  add('视频内容', 'medium', '怒九的《古墓丽影：暗影》实况中的主角是谁？',
    ['劳拉', '奥丁', '雷神', '阿瑞斯'], 0,
    '《古墓丽影：暗影》的主角是劳拉·克劳馥。');
}
{
  add('视频内容', 'hard', '怒九的《怀旧系》视频推荐的是哪类游戏？',
    ['4399单机小游戏', '街机游戏', '掌机游戏', '主机大作'], 0,
    '推荐的是"经典的4399单机小游戏"，满满的童年回忆。');
}
{
  add('视频内容', 'medium', '怒九的《南方人第一次去澡堂是什么样的？》属于什么系列？',
    ['怒九的脑洞日常', '速推荐', '恐怖游戏大挑战', '艺术就是___'], 0,
    '这是"怒九的脑洞日常"系列，分享南方人第一次去澡堂的经历。');
}
{
  add('视频内容', 'hard', '怒九在《Deltarune三角符文》实况中怎么评价这个游戏？',
    ['Toby新作', '神作', '一般', '烂作'], 0,
    '标题称"Deltarune三角符文实况 Toby新作！"。');
}
{
  add('视频内容', 'medium', '《岚少 I AM THE MAN-MeMe》是什么类型的内容？',
    ['MeMe 手书', '翻唱', '游戏实况', '科普'], 0,
    '这是一个以岚少为主角的 MeMe（音乐手书）作品。');
}
{
  add('视频内容', 'hard', '怒九的《【RPG-meme】玩家的抱怨 怪物猎人x守望先锋》是什么？',
    ['跨游戏 MeMe', '游戏攻略', '游戏评测', '游戏新闻'], 0,
    '这是一个跨游戏（怪物猎人 x 守望先锋）的 RPG MeMe 手书。');
}
{
  add('视频内容', 'medium', '怒九的《【MHW】猎人美容院！》玩的是什么游戏？',
    ['怪物猎人世界', '怪物猎人崛起', '怪物猎人物语', '怪物猎人边境'], 0,
    'MHW 是 Monster Hunter World（怪物猎人世界）的缩写。');
}
{
  add('视频内容', 'hard', '怒九的《【寻梦环游记】同一部电影的两种结局》是什么内容？',
    ['对比讨论视频', '翻唱', '游戏实况', '手书'], 0,
    '这是对电影《寻梦环游记》不同结局的对比讨论，属于知识科普类。');
}
{
  add('视频内容', 'medium', '怒九的《你有被自己蠢哭的瞬间吗？！》属于什么类型？',
    ['翻唱/音乐', '搞笑娱乐', '游戏实况', '知识科普'], 0,
    '分类是翻唱/音乐，虽然标题看起来像搞笑话题，实际是音乐类内容。');
}
{
  add('视频内容', 'hard', '怒九和 Warma 的《让我们快乐地搬家吧！》属于什么类型？',
    ['翻唱/音乐', '游戏实况', 'Vlog', '手书'], 0,
    '分类是翻唱/音乐，虽然标题提到搬家，实际是音乐类内容。');
}
{
  add('视频内容', 'hard', '怒九的《我画了一本书！再不进来听就变成黑历史了！！》属于什么类型？',
    ['翻唱/音乐', '绘画手书', '游戏实况', '搞笑'], 0,
    '虽然标题提到"画了一本书"，分类是翻唱/音乐（有声读物）。');
}
{
  add('视频内容', 'medium', '怒九在《我最擅长照顾人了！》中自称擅长什么？',
    ['照顾人', '做饭', '画画', '打游戏'], 0,
    '标题明确说"我最擅长照顾人了"，这是怒九的自嘲式标题。');
}
{
  add('视频内容', 'medium', '怒九的《我！铲车女郎！出道！！》玩的是什么？',
    ['铲车模拟器', '厨房模拟器', '卡车模拟器', '农场模拟器'], 0,
    '这是怒九玩铲车模拟器游戏的实况。');
}
{
  add('视频内容', 'hard', '《【Warma/怒九/捏碳】初次参加面试就直接通过的三人！》有几个人？',
    ['3 人', '2 人', '4 人', '5 人'], 0,
    '从标题看有 Warma、怒九、捏碳三人。');
}
{
  add('视频内容', 'medium', '《【怒九】完蛋了！目标完不成啦啊啊！！》属于什么类型？',
    ['绘画/手书', '游戏实况', '搞笑', '科普'], 0,
    '分类是绘画/手书，是怒九画的关于目标完不成的手书作品。');
}
{
  add('视频内容', 'hard', '怒九和 Warma 合作的《绝对不许关灯！》发布于哪一年？',
    ['2022', '2021', '2023', '2020'], 0,
    '发布于 2022 年 9 月，是一起玩的恐怖游戏实况。');
}
{
  add('视频内容', 'medium', '《【怒九】在破烂堆里当艺术家！》属于什么类型？',
    ['游戏实况', '绘画手书', '搞笑', '翻唱'], 0,
    '这是怒九玩一个在破烂堆中当艺术家的模拟器游戏。');
}
{
  add('视频内容', 'medium', '《【怒九】我毫无节奏感啊！！！》玩的是什么类型的游戏？',
    ['节奏音游', '射击游戏', '恐怖游戏', '模拟经营'], 0,
    '标题提到"毫无节奏感"，说明这是一个节奏/音乐类游戏。');
}
{
  add('视频内容', 'hard', '怒九的《【怒九/碳碳】伪人超市来了两个神人店员》中的"碳碳"是谁？',
    ['捏碳', '碳基生物', '碳碳峡', '不知道'], 0,
    '"碳碳"是捏碳（另一位 UP 主）的昵称。');
}
{
  add('视频内容', 'medium', '《【warma/怒九】超市惊魂夜！！！》发布于哪一年？',
    ['2026', '2025', '2024', '2023'], 0,
    '发布于 2026 年 2 月，是两人合作的恐怖游戏实况。');
}
{
  add('视频内容', 'hard', '怒九的《【怒九】这是真的初音吗？？？》属于什么类型？',
    ['游戏实况', '绘画手书', '翻唱', '科普'], 0,
    '这是怒九玩一个与初音未来相关的游戏的实况。');
}
{
  add('视频内容', 'medium', '《【warma/怒九】合成大脂肪！最胖啦！》玩的是什么游戏？',
    ['合成大西瓜类游戏', '烹饪游戏', '减肥游戏', '运动游戏'], 0,
    '从标题看，这是一个类似"合成大西瓜"的合成类游戏，但主题是"合成大脂肪"。');
}
{
  add('视频内容', 'medium', '《【warma/怒九】找到所有闹鬼的照片！》属于什么类型？',
    ['游戏实况', '绘画手书', '搞笑', '翻唱'], 0,
    '这是两人合作玩找鬼照片类游戏的实况。');
}
{
  add('视频内容', 'hard', '怒九的《【怒九】第一次做面包 会变成什么样？！》发布在小号还是主号？',
    ['小号（摸鱼馆）', '主号（怒九笑）', '两个都发了', '没发过'], 0,
    '发布于小号"怒九摸鱼馆"，属于日常碎片类内容。');
}
{
  add('视频内容', 'hard', '《【warma/怒九】我需要帮助！快来！》是什么类型的合作？',
    ['游戏实况', 'Vlog', '电台', '翻唱'], 0,
    '这是两人合作的游戏实况，标题充满了紧急求助感。');
}
{
  add('视频内容', 'medium', '怒九的《【怒九】来玩胆量测试吧！》是和谁合作的？',
    ['Warma', '捏碳', '独自完成', '碳碳'], 0,
    '这是和 Warma 合作玩胆量测试类游戏的实况。');
}
{
  add('视频内容', 'hard', '《【warma/怒九】整个海域，我是老大！》玩的是什么？',
    ['海盗类游戏', '钓鱼游戏', '海洋生物游戏', '潜水游戏'], 0,
    '从标题看，这是两人合作玩的海盗类或海战类游戏。');
}
{
  add('视频内容', 'medium', '《【warma/怒九】出国！去逛全球最大的游戏展吧！》属于什么类型？',
    ['爆炸电台', 'Vlog', '游戏实况', '科普'], 0,
    '分类是爆炸电台，是两人出国逛游戏展后的电台分享。');
}
{
  add('视频内容', 'hard', '怒九的《【怒九】进来被我表白！！》是什么内容？',
    ['游戏实况', '真正的表白', '翻唱', '手书'], 0,
    '虽然标题写"表白"，实际是游戏实况（可能是表白类小游戏）。');
}

// ═══ 考古与里程碑 ═══
{
  add('考古与里程碑', 'medium', '怒九的第一部视频发布于哪一年？',
    ['2017', '2015', '2016', '2018'], 0,
    '《【守望先锋手书】因为我们是男英雄啊！》发布于 2017 年 8 月 25 日。');
}
{
  add('考古与里程碑', 'medium', '怒九在哪一年发布了最多的视频？',
    ['2018', '2019', '2020', '2021'], 0,
    '2018 年共发布了 33 个视频，是最高产的年份。');
}
{
  add('考古与里程碑', 'easy', '怒九总共发了多少个视频？',
    ['约 200 个', '约 100 个', '约 300 个', '约 50 个'], 0,
    `共收录了 ${videos.length} 个视频。`);
}
{
  add('考古与里程碑', 'medium', '怒九的小号是哪一年开始发视频的？',
    ['2021', '2020', '2019', '2022'], 0,
    '小号"怒九摸鱼馆"的第一个视频发布于 2021 年。');
}
{
  add('考古与里程碑', 'hard', '怒九和 Warma 第一次线下见面是在哪个视频中提到的？',
    ['【怒九/warma】线下见面★ 宅人终于出去玩啦！！', '【warma/怒九】成都旅游短视频合集', '【warma/怒九】双影奇境', '【warma/怒九】让我快乐地搬家吧'], 0,
    '标题《【怒九/warma】线下见面★ 宅人终于出去玩啦！！》记录了他们的线下见面。');
}
{
  add('考古与里程碑', 'hard', '怒九的《2020 你还要我怎样？大学生现状。》属于什么类型？',
    ['搞笑娱乐', '知识科普', '游戏实况', '绘画手书'], 0,
    '这是 2020 年关于大学生现状的搞笑娱乐类视频。');
}
{
  add('考古与里程碑', 'medium', '怒九的《大学毕业有何感想有什么打算？》发布于哪一年？',
    ['2021', '2020', '2022', '2019'], 0,
    '发布于 2021 年 7 月，是关于大学毕业的讨论视频。');
}
{
  add('考古与里程碑', 'hard', '怒九的《LGBT群体遭到了哪些误解？》属于什么类型？',
    ['游戏实况', '知识科普', '搞笑娱乐', '绘画手书'], 0,
    '这是 2019 年关于 LGBT 群体误解的科普类视频。');
}
{
  add('考古与里程碑', 'medium', '怒九在哪个视频中提到了"黑历史"？',
    ['黑历史来了！谁没有中二病和玛丽苏过呢？', '【怒九】完蛋了！', '我编了个离谱至极的校园故事！', '看亲哥玩恐怖游戏'], 0,
    '《黑历史来了！谁没有中二病和玛丽苏过呢？》是怒九自曝黑历史的视频。');
}
{
  add('考古与里程碑', 'hard', '怒九的《有个亲哥是什么体验？兄妹战争！！》中的"亲哥"是谁？',
    ['Warma', '不知名哥哥', '捏碳', 'CB'], 0,
    '从内容看，"亲哥"指的是 Warma，两人是兄妹关系。');
}

// ═══ 合作专题 ═══
{
  add('合作专题', 'easy', '怒九和 Warma 合作过的游戏不包括以下哪个？',
    ['塞尔达传说', '双影奇境', 'REANIMAL', 'Subnautica2'], 0,
    '怒九和 Warma 合作过《双影奇境》《REANIMAL》《Subnautica2》《星露谷》等，但没有合作过《塞尔达传说》。');
}
{
  add('合作专题', 'medium', '怒九和 Warma 合作的《星露谷！田园开荒生活》覆盖了哪些季节？',
    ['春夏秋冬', '只有春天', '只有夏天', '只有春秋'], 0,
    '该系列包含了第一年 春、夏、秋三个季度，加上后续更新。');
}
{
  add('合作专题', 'medium', '怒九和 Warma 合作的《胡乱修改游戏导致的黑暗世界！》发布于哪一年？',
    ['2025', '2024', '2023', '2022'], 0,
    '发布于 2025 年 8 月，是两人合作的游戏实况。');
}
{
  add('合作专题', 'hard', '怒九和 Warma 合作的《人生的陷阱被我们踩了个遍！》发布在哪个账号？',
    ['小号（摸鱼馆）', '主号（怒九笑）', 'Warma的账号', '都没发'], 0,
    '发布于小号"怒九摸鱼馆"。');
}
{
  add('合作专题', 'medium', '怒九和 Warma 合作过几个关于恐怖的游戏？',
    ['超过 5 个', '1 个', '2 个', '3 个'], 0,
    '两人合作过《绝对不许关灯！》《超市惊魂夜！！！》《尖叫就玩完的恐怖游戏！》《鬼打墙了！》等多部恐怖游戏。');
}
{
  add('合作专题', 'medium', '怒九和 Warma 合作过《您的外卖骑手掉沟里了》，这是什么类型？',
    ['游戏实况', '真实Vlog', '搞笑', '科普'], 0,
    '这是两人合作玩的外卖骑手模拟器游戏实况，发布于 2024 年。');
}
{
  add('合作专题', 'hard', '怒九和 Warma 合作的《红色月亮！来赏月聊天吧》属于什么类型？',
    ['生活日常', '游戏实况', '爆炸电台', '翻唱'], 0,
    '这是两人在红色月亮下赏月聊天的日常视频。');
}
{
  add('合作专题', 'medium', '怒九和 Warma 合作过的《拼到我算我输》系列总数大约是多少？',
    ['超过 15 个', '5 个', '8 个', '3 个'], 0,
    '"撩到我算我输"系列（含"拼到我我输了"）总数超过 15 个，是怒九最长系列之一。');
}
{
  add('合作专题', 'hard', '《【Warma/怒九/捏碳】我们的新游戏发布？！》播放量约多少？',
    ['约 470 万', '约 100 万', '约 50 万', '约 200 万'], 0,
    '播放量约 470 万，是怒九播放量第四高的视频。');
}
{
  add('合作专题', 'medium', '怒九和 Warma 合作的《玩个音游差点友情翻车》发布在哪一年？',
    ['2024', '2023', '2025', '2022'], 0,
    '发布于 2024 年 5 月，是两人合作玩的音游。');
}

// ═══ 真假判断 ═══
addTrueFalse('真假判断', 'easy', '怒九的主号叫"怒九笑"。', true, '主号名为"怒九笑"，UID 14751040。');
addTrueFalse('真假判断', 'easy', '怒九的小号叫"怒九摸鱼馆"。', true, '小号名为"怒九摸鱼馆"，UID 693485501。');
addTrueFalse('真假判断', 'medium', '怒九和 Warma 是情侣关系。', false, '怒九和 Warma 是兄妹关系，不是情侣。');
addTrueFalse('真假判断', 'medium', '怒九的粉丝比 Warma 多。', false, 'Warma 主号约 500 万粉丝，怒九主号约 214 万，Warma 更多。');
addTrueFalse('真假判断', 'hard', '怒九的"爆炸电台"超过 10 期。', false, '怒九的爆炸电台只有 4 期。');
addTrueFalse('真假判断', 'medium', '怒九玩过 Undertale（传说之下）相关的手书。', true, '怒九有多部 UT 手书作品，是人类组方向的创作。');
addTrueFalse('真假判断', 'medium', '怒九和 Warma 合作过《星露谷》。', true, '两人合作了"星露谷！田园开荒生活"系列。');
addTrueFalse('真假判断', 'easy', '怒九的总播放量超过了 2 亿。', true, '总播放量约 2.85 亿，远超 2 亿。');
addTrueFalse('真假判断', 'hard', '怒九只有主号一个账号。', false, '怒九有两个账号：主号"怒九笑"和小号"怒九摸鱼馆"。');
addTrueFalse('真假判断', 'medium', '怒九做过手工/绘画相关的视频。', true, '怒九有 23 部绘画/手书类视频。');
addTrueFalse('真假判断', 'medium', '怒九所有视频都是游戏实况。', false, '虽然游戏实况占多数（137 部），但也有绘画、搞笑、翻唱、科普等类型。');
addTrueFalse('真假判断', 'hard', '怒九的小号发的视频比主号多。', false, '主号有 166 部，小号只有 39 部。');
addTrueFalse('真假判断', 'hard', '怒九的"撩到我算我输"系列是和 Warma 一起玩的。', false, '"撩到我算我输"系列是怒九独自玩的乙女游戏系列，不是和 Warma 合作。');
addTrueFalse('真假判断', 'medium', '怒九和 Warma 合作过《双影奇境》。', true, '这是两人最著名的合作作品，播放量高达 790 万。');
addTrueFalse('真假判断', 'easy', '怒九的粉丝主要是男性。', false, '从评论区内容和视频类型（乙女游戏、绘画等）来看，粉丝群体以女性为主。');
addTrueFalse('真假判断', 'medium', '怒九的"全国统一的人类共同行为记录"系列已经完结。', true, '目前出到第 4 期"你的牙痒吗？"，后续暂无更新。');
addTrueFalse('真假判断', 'hard', '怒九翻唱过 JOJO 的 OP。', false, '目前没有找到怒九翻唱 JOJO OP 的记录。');
addTrueFalse('真假判断', 'medium', '怒九和捏碳也是合作搭档。', true, '《【Warma/怒九/捏碳】初次参加面试》《【怒九/碳碳】伪人超市》等证明他们是搭档。');
addTrueFalse('真假判断', 'hard', '怒九的"速推荐"系列超过 10 期。', false, '"速推荐"系列大约有 6-8 期，没有超过 10 期。');
addTrueFalse('真假判断', 'medium', '怒九的总弹幕数超过了 100 万。', true, '总弹幕数约 121 万，超过 100 万。');
addTrueFalse('真假判断', 'hard', '怒九在《中国式家长》中培养了儿子。', false, '怒九培养的是女儿，标题是"女儿？宠就对了！"。');
addTrueFalse('真假判断', 'medium', '怒九的最高播放视频是和 Warma 合作的。', true, '最高播放的《双影奇境》正是和 Warma 合作的作品。');
addTrueFalse('真假判断', 'hard', '怒九的爆炸电台最早一期发布于 2018 年。', false, '怒九的爆炸电台最早一期是 2021 年的《姐妹俩打打闹闹的日常》。');
addTrueFalse('真假判断', 'medium', '怒九的主号和小号等级一样。', true, '两个账号都是 B 站 6 级。');
addTrueFalse('真假判断', 'hard', '怒九总共只发过 100 个视频。', false, '怒九总共发了 205 个视频（主号 166 + 小号 39）。');
addTrueFalse('真假判断', 'medium', '怒九和 Warma 合作过恐怖游戏。', true, '两人合作过《绝对不许关灯！》等多部恐怖游戏。');
addTrueFalse('真假判断', 'hard', '怒九的"艺术就是___"系列全部是绘画手书类型。', false, '该系列有一部（2024年）被分类为"游戏实况"，不全是绘画手书。');
addTrueFalse('真假判断', 'medium', '怒九在 B 站是知名 UP 主。', true, '主号有"bilibili 知名UP主"官方认证。');
addTrueFalse('真假判断', 'hard', '怒九的爆炸电台总共超过 10 期。', false, '只有 4 期。');
addTrueFalse('真假判断', 'easy', '怒九的总点赞数超过了 1000 万。', true, '总点赞数约 1694 万，超过 1000 万。');

// ═══ 深挖补充题（从数据自动生成） ═══
{
  // TOP N 视频
  const views = topBy('view');
  for (let i = 1; i <= 5; i++) {
    if (i >= views.length) break;
    const correct = views[i - 1];
    const wrongs = [views[i], views[i + 1] || views[0], views[i + 2] || views[1]].filter(v=>v.bvid!==correct.bvid).map(shortTitle);
    if (wrongs.length < 3) continue;
    add('数据之最', i <= 3 ? 'easy' : 'medium',
      `怒九播放量第 ${i} 高的视频是哪一部？`,
      [shortTitle(correct), ...wrongs], 0,
      `播放量 ${fmtNum(correct.view)}，发布于 ${correct.date}。`);
  }
}
{
  // Yearly total views
  const yearViews = {};
  videos.forEach(v=>{ const y=v.date?.substring(0,4); if(y) yearViews[y]=(yearViews[y]||0)+(v.view||0); });
  const topYearView = Object.entries(yearViews).sort((a,b)=>b[1]-a[1])[0];
  choice('数据之最', 'hard', '哪一年的视频总播放量最高？', `${topYearView[0]}年`, Object.keys(yearViews).filter(y=>y!==topYearView[0]).slice(0,3).map(y=>`${y}年`), `${topYearView[0]} 年累计播放 ${fmtNum(topYearView[1])}。`);
}
{
  // Longest subtitle
  const subChamp = topBy('sub_lines')[0];
  if (subChamp && subChamp.sub_lines > 0) {
    addTrueFalse('字幕探索', 'hard', `《${shortTitle(subChamp)}》的字幕超过 ${Math.floor(subChamp.sub_lines/2)} 行。`, subChamp.sub_lines > Math.floor(subChamp.sub_lines/2), `实际有 ${subChamp.sub_lines} 行字幕。`);
  }
}
{
  // Category: type most liked
  const typeLikes = Object.entries(videos.reduce((acc,v)=>{ acc[v.type]=(acc[v.type]||0)+(v.like||0); return acc; },{})).sort((a,b)=>b[1]-a[1]);
  choice('标签与分类', 'hard', '哪一类内容的总点赞量最高？', typeLikes[0][0], typeLikes.slice(1,10).map(x=>x[0]), `${typeLikes[0][0]} 总点赞 ${fmtNum(typeLikes[0][1])}。`);
}
{
  // Videos per account type
  for (const [type, count] of Object.entries(typeCounter)) {
    if (count >= 3) {
      choice('标签与分类', 'hard', `"${type}"类视频中主号占多少部？`,
        String(videos.filter(v=>v.type===type && v.account_short==='主号').length),
        [String(videos.filter(v=>v.type===type && v.account_short==='小号').length), String(count), String(count+3)].filter(x=>x!==String(videos.filter(v=>v.type===type && v.account_short==='主号').length)),
        `主号 ${videos.filter(v=>v.type===type && v.account_short==='主号').length} 部，小号 ${videos.filter(v=>v.type===type && v.account_short==='小号').length} 部。`);
    }
  }
}
{
  // Longest gap band
  const gapBands = {};
  videos.forEach(v=>{ if(v.gap_band) gapBands[v.gap_band]=(gapBands[v.gap_band]||0)+1; });
  for (const [band, count] of Object.entries(gapBands).sort((a,b)=>b[1]-a[1]).slice(0,3)) {
    choice('发布规律', 'hard', `"${band}"间隔等级的视频大约有多少部？`, String(count), [String(count+5),String(Math.max(1,count-5)),String(count*2)], `当前有 ${count} 部。`);
  }
}
{
  // Danmaku peak video
  const dmPeakVideo = videos.filter(v=>v.peaks && Object.keys(v.peaks).length > 0).sort((a,b)=>Math.max(...Object.values(b.peaks)) - Math.max(...Object.values(a.peaks)))[0];
  if (dmPeakVideo) {
    const peakVal = Math.max(...Object.values(dmPeakVideo.peaks));
    choice('数据之最', 'hard', '弹幕峰值最高的视频是哪一部？', shortTitle(dmPeakVideo), videos.filter(v=>v.bvid!==dmPeakVideo.bvid && v.view>500000).slice(0,10).map(shortTitle), `该视频弹幕峰值达到 ${fmtNum(peakVal)}。`);
  }
}

// ═══ 大规模自动补充：每部热门视频 × 维度交叉 ═══
{
  // For each top-20 viewed video, ask: which account, which year, which type
  const top20View = topBy('view').slice(0, 20);
  for (const v of top20View) {
    const st = shortTitle(v);
    choice('视频内容', 'medium', `《${st}》发布在哪个账号？`,
      v.account_short === '主号' ? '主号（怒九笑）' : '小号（怒九摸鱼馆）',
      v.account_short === '主号' ? ['小号（怒九摸鱼馆）','两个都发了','没有发过'] : ['主号（怒九笑）','两个都发了','没有发过'],
      `发布于 ${v.account}，日期 ${v.date}。`);
    choice('视频内容', 'easy', `《${st}》属于哪个内容类型？`,
      v.type, topTypes.map(([t])=>t).filter(t=>t!==v.type).slice(0,3),
      `类型是 ${v.type}，发布于 ${v.date}。`);
    choice('视频内容', 'medium', `《${st}》发布于哪一年？`,
      `${v.date.slice(0,4)}年`, ['2018年','2020年','2022年','2024年'].filter(x=>x!==`${v.date.slice(0,4)}年`).slice(0,3),
      `准确日期是 ${v.date}。`);
  }
}
{
  // For each top-15 liked video, ask if collaboration
  const top15Like = topBy('like').slice(0, 15);
  for (const v of top15Like) {
    const isCollab = v.title.includes('warma') || v.title.includes('Warma');
    addTrueFalse('合作专题', 'medium', `《${shortTitle(v)}》是和 Warma 合作的视频。`, isCollab,
      isCollab ? `标题中包含 warma/Warma 标记。` : `标题中没有合作标记，可能是独立创作或与其他人合作。`);
  }
}
{
  // Per-year total video questions
  for (const [year, count] of Object.entries(yearCounter).sort((a,b)=>Number(a[0])-Number(b[0]))) {
    choice('发布规律', 'medium', `${year} 年怒九发布了多少个视频？`,
      String(count), [String(count+3),String(Math.max(1,count-3)),String(count*2)],
      `${year} 年共发布了 ${count} 个视频。`);
  }
}
{
  // Top viewed per type
  for (const [type] of topTypes.slice(0, 6)) {
    const topOfType = videos.filter(v=>v.type===type).sort((a,b)=>b.view-a.view)[0];
    if (!topOfType) continue;
    choice('视频内容', 'hard', `"${type}"类视频中播放量最高的是哪一部？`,
      shortTitle(topOfType),
      videos.filter(v=>v.type===type && v.bvid!==topOfType.bvid).slice(0,5).map(shortTitle),
      `播放量 ${fmtNum(topOfType.view)}，发布于 ${topOfType.date}。`);
  }
}
{
  // Most productive month
  const monthCount = {};
  videos.forEach(v=>{ const m = v.date?.substring(0,7); if(m) monthCount[m]=(monthCount[m]||0)+1; });
  const topMonth = Object.entries(monthCount).sort((a,b)=>b[1]-a[1])[0];
  if (topMonth) {
    choice('发布规律', 'hard', `哪个月发布的视频最多？`,
      topMonth[0], Object.keys(monthCount).filter(m=>m!==topMonth[0]).slice(0,3),
      `${topMonth[0]} 共发布了 ${topMonth[1]} 个视频。`);
  }
}
{
  // Per-type average duration
  for (const [type] of topTypes.slice(0, 5)) {
    const typeVids = videos.filter(v=>v.type===type);
    const avgDur = Math.round(typeVids.reduce((s,v)=>s+(v.duration||0),0)/typeVids.length/60);
    choice('视频内容', 'hard', `"${type}"类视频的平均时长大约是多少分钟？`,
      `约 ${avgDur} 分钟`, [`约 ${avgDur+10} 分钟`,`约 ${Math.max(1,avgDur-10)} 分钟`,`约 ${avgDur*2} 分钟`],
      `该类型共 ${typeVids.length} 部，平均约 ${avgDur} 分钟。`);
  }
}
{
  // Subtitle quote matching - more
  const quoted2 = videos.filter(v => (v.merged || []).length > 2 && v.title);
  for (const video of shuffle(quoted2).slice(0, 10)) {
    const quote = (video.merged[1] || video.merged[0] || '').replace(/\s+/g, ' ').slice(0, 50);
    if (!quote || quote.length < 5) continue;
    choice('字幕探索', 'hard', `"${quote}……"出自哪部视频？`,
      shortTitle(video), quoted2.filter(v=>v.bvid!==video.bvid).map(shortTitle),
      `来自 ${video.date} 的《${shortTitle(video)}》。`);
  }
}
{
  // Top commenter count
  const commentAuthor = flatComments.reduce((acc,c)=>{ if(c.name) acc[c.name]=(acc[c.name]||0)+1; return acc; },{});
  const topCommenters = Object.entries(commentAuthor).sort((a,b)=>b[1]-a[1]);
  for (let i = 0; i < Math.min(5, topCommenters.length); i++) {
    choice('评论区', 'hard', `"${topCommenters[i][0]}"在评论区发了多少条评论？`,
      String(topCommenters[i][1]), [String(topCommenters[i][1]+3),String(Math.max(1,topCommenters[i][1]-2)),String(topCommenters[i][1]*2)],
      `在当前抓取样本中发了 ${topCommenters[i][1]} 条。`);
  }
}
{
  // Which video has most comments
  const videoCommentCount = {};
  for (const [bvid, comments] of Object.entries(RAW_COMMENTS)) {
    videoCommentCount[bvid] = (comments || []).length;
  }
  const topCommentVideo = Object.entries(videoCommentCount).sort((a,b)=>b[1]-a[1])[0];
  if (topCommentVideo) {
    const v = videos.find(v=>v.bvid===topCommentVideo[0]);
    if (v) {
      choice('评论区', 'medium', `哪部视频的评论抓取量最多？`,
        shortTitle(v), videos.filter(x=>x.bvid!==v.bvid && x.view>1000000).slice(0,10).map(shortTitle),
        `《${shortTitle(v)}》抓取到了 ${topCommentVideo[1]} 条评论。`);
    }
  }
}
{
  // Gap band distribution
  const gapBands = {};
  videos.forEach(v=>{ if(v.gap_band) gapBands[v.gap_band]=(gapBands[v.gap_band]||0)+1; });
  for (const [band, count] of Object.entries(gapBands).sort((a,b)=>b[1]-a[1]).slice(0,3)) {
    choice('发布规律', 'hard', `"${band}"间隔等级有多少部视频？`, String(count),
      [String(count+5),String(Math.max(1,count-5)),String(count*2)],
      `当前有 ${count} 部视频属于"${band}"等级。`);
  }
}
{
  // Total duration
  const totalDur = videos.reduce((s,v)=>s+(v.duration||0),0);
  choice('数据之最', 'hard', '怒九所有视频总时长大约是多少小时？',
    `约 ${Math.round(totalDur/3600)} 小时`, [`约 ${Math.round(totalDur/3600)+10} 小时`,`约 ${Math.max(1,Math.round(totalDur/3600)-10)} 小时`,`约 ${Math.round(totalDur/3600/2)} 小时`],
    `总时长约 ${Math.round(totalDur/3600)} 小时。`);
}
{
  // Average video duration
  const avgDur = Math.round(videos.reduce((s,v)=>s+(v.duration||0),0)/videos.length/60);
  choice('数据之最', 'medium', '怒九视频的平均时长大约是多少分钟？',
    `约 ${avgDur} 分钟`, [`约 ${avgDur+5} 分钟`,`约 ${Math.max(1,avgDur-5)} 分钟`,`约 ${avgDur*2} 分钟`],
    `平均约 ${avgDur} 分钟。`);
}
{
  // Intro word count champion
  const introChamp = topBy('intro_count')[0];
  if (introChamp && introChamp.intro_count > 0) {
    choice('数据之最', 'hard', '哪部视频的简介字数最多？',
      shortTitle(introChamp), topBy('intro_count').slice(1,10).map(shortTitle),
      `简介有 ${introChamp.intro_count} 字。`);
  }
}
{
  // Main vs small per-type breakdown
  for (const [type, count] of Object.entries(typeCounter).sort((a,b)=>b[1]-a[1]).slice(0,5)) {
    const mainCount = videos.filter(v=>v.type===type && v.account_short==='主号').length;
    const smallCount = videos.filter(v=>v.type===type && v.account_short==='小号').length;
    if (mainCount > 0 && smallCount > 0) {
      addTrueFalse('深度对比', 'hard', `"${type}"类视频在主号和小号都有发布。`, true,
        `主号 ${mainCount} 部，小号 ${smallCount} 部。`);
    } else if (mainCount > 0) {
      addTrueFalse('深度对比', 'hard', `"${type}"类视频全部发布在主号。`, true,
        `主号 ${mainCount} 部，小号 0 部。`);
    }
  }
}
{
  // Publishing hour distribution - specific hours
  const hourCount = {};
  videos.forEach(v=>{ if(v.pubdate_iso){ const h=parseInt(v.pubdate_iso.split(' ')[1]?.split(':')[0]); if(!isNaN(h)) hourCount[h]=(hourCount[h]||0)+1; }});
  const sortedHours = Object.entries(hourCount).sort((a,b)=>b[1]-a[1]);
  for (let i = 0; i < Math.min(3, sortedHours.length); i++) {
    choice('发布规律', 'medium', `怒九在 ${sortedHours[i][0]} 点发布过多少个视频？`,
      String(sortedHours[i][1]), [String(sortedHours[i][1]+3),String(Math.max(1,sortedHours[i][1]-2)),String(sortedHours[i][1]*2)],
      `${sortedHours[i][0]} 点共发布了 ${sortedHours[i][1]} 个视频。`);
  }
}
{
  // Videos per month-day
  const dayCount = {};
  videos.forEach(v=>{ if(v.date){ const d = v.date.substring(8,10); dayCount[d]=(dayCount[d]||0)+1; }});
  const topDay = Object.entries(dayCount).sort((a,b)=>b[1]-a[1])[0];
  if (topDay) {
    choice('发布规律', 'hard', `每月几号发布视频最多？`,
      `${topDay[0]} 号`, Object.keys(dayCount).filter(d=>d!==topDay[0]).sort(()=>Math.random()-0.5).slice(0,3).map(d=>`${d} 号`),
      `每月 ${topDay[0]} 号发布了 ${topDay[1]} 个视频。`);
  }
}
{
  // Engagement rate per type
  for (const [type] of topTypes.slice(0, 5)) {
    const typeVids = videos.filter(v=>v.type===type && v.view>10000);
    if (typeVids.length < 2) continue;
    const avgRate = typeVids.reduce((s,v)=>s+(v.like/v.view),0)/typeVids.length*100;
    choice('深度对比', 'hard', `"${type}"类视频的平均点赞率大约是多少？`,
      `约 ${avgRate.toFixed(1)}%`, [`约 ${(avgRate*2).toFixed(1)}%`,`约 ${(avgRate/2).toFixed(1)}%`,`约 ${(avgRate+5).toFixed(1)}%`],
      `该类型平均点赞率约 ${avgRate.toFixed(1)}%。`);
  }
}

// ═══ 终极补充：从数据中批量生成更多维度 ═══
{
  // Top 10 by danmaku: which video, what's the count
  const top10Dm = topBy('danmaku').slice(0, 10);
  for (let i = 0; i < top10Dm.length; i++) {
    const v = top10Dm[i];
    choice('数据之最', i < 3 ? 'medium' : 'hard', `弹幕数第 ${i+1} 高的视频是哪一部？`,
      shortTitle(v), top10Dm.filter(x=>x.bvid!==v.bvid).slice(0,3).map(shortTitle),
      `弹幕数 ${fmtNum(v.danmaku)}，播放量 ${fmtNum(v.view)}。`);
  }
}
{
  // Top 10 by coin
  const top10Coin = topBy('coin').slice(0, 10);
  for (let i = 0; i < top10Coin.length; i++) {
    const v = top10Coin[i];
    choice('数据之最', 'hard', `投币数第 ${i+1} 高的视频是哪一部？`,
      shortTitle(v), top10Coin.filter(x=>x.bvid!==v.bvid).slice(0,3).map(shortTitle),
      `投币数 ${fmtNum(v.coin)}。`);
  }
}
{
  // Per-tag count questions
  for (const [tag, count] of topTags.slice(0, 8)) {
    choice('标签与分类', 'medium', `"${tag}"标签出现了多少次？`, String(count),
      [String(count+5),String(Math.max(1,count-5)),String(count*2)],
      `"${tag}"共出现 ${count} 次。`);
  }
}
{
  // More subtitle quotes
  const quoted3 = videos.filter(v => (v.merged || []).length > 4 && v.title);
  for (const video of shuffle(quoted3).slice(0, 8)) {
    const idx = Math.floor(Math.random() * Math.min(video.merged.length, 10));
    const quote = (video.merged[idx] || '').replace(/\s+/g, ' ').slice(0, 45);
    if (!quote || quote.length < 8) continue;
    choice('字幕探索', 'hard', `"${quote}……"这段台词出自哪部视频？`,
      shortTitle(video), quoted3.filter(v=>v.bvid!==video.bvid).map(shortTitle),
      `来自 ${video.date} 的《${shortTitle(video)}》。`);
  }
}
{
  // Type duration comparisons
  for (let i = 0; i < Math.min(topTypes.length-1, 5); i++) {
    const t1 = topTypes[i][0], t2 = topTypes[i+1][0];
    choice('标签与分类', 'hard', `"${t1}"和"${t2}"哪类视频更多？`,
      typeCounter[t1] > typeCounter[t2] ? t1 : t2,
      [typeCounter[t1] > typeCounter[t2] ? t2 : t1, '一样多', '无法比较'],
      `${t1} 有 ${typeCounter[t1]} 部，${t2} 有 ${typeCounter[t2]} 部。`);
  }
}
{
  // Year gap comparisons
  const yearsSorted = Object.keys(yearCounter).sort();
  for (let i = 0; i < yearsSorted.length - 1; i++) {
    const y1 = yearsSorted[i], y2 = yearsSorted[i+1];
    const c1 = yearCounter[y1], c2 = yearCounter[y2];
    choice('发布规律', 'hard', `${y1} 年和 ${y2} 年哪年发布的视频更多？`,
      c1 > c2 ? `${y1} 年` : `${y2} 年`,
      [c1 > c2 ? `${y2} 年` : `${y1} 年`, '一样多', '不知道'],
      `${y1} 年 ${c1} 部，${y2} 年 ${c2} 部。`);
  }
}
{
  // Total favorite/coin/share/reply comparisons
  const totalCoin = videos.reduce((s,v)=>s+(v.coin||0),0);
  const totalFav = videos.reduce((s,v)=>s+(v.favorite||0),0);
  const totalShare = videos.reduce((s,v)=>s+(v.share||0),0);
  const totalReply = videos.reduce((s,v)=>s+(v.reply||0),0);
  const stats = [['投币',totalCoin],['收藏',totalFav],['分享',totalShare],['评论',totalReply]];
  for (const [label, val] of stats) {
    choice('深度对比', 'medium', `怒九总${label}数大约是多少？`,
      fmtNum(Math.round(val/10000)*10000 + '万').replace('万',' 万'),
      [fmtNum(Math.round(val*0.5/10000)*10000+'万').replace('万',' 万'), fmtNum(Math.round(val*2/10000)*10000+'万').replace('万',' 万'), fmtNum(Math.round(val*0.1/10000)*10000+'万').replace('万',' 万')],
      `总${label}数约 ${fmtNum(val)}。`);
  }
}
{
  // Which year did the small account start
  const smallFirst = small.sort((a,b)=>new Date(a.date)-new Date(b.date))[0];
  if (smallFirst) {
    choice('考古与里程碑', 'medium', '小号"怒九摸鱼馆"的第一部视频发布于哪一年？',
      `${smallFirst.date.slice(0,4)}年`, ['2020年','2022年','2023年'].filter(x=>x!==`${smallFirst.date.slice(0,4)}年`),
      `小号第一部视频是《${shortTitle(smallFirst)}》，发布于 ${smallFirst.date}。`);
  }
}
{
  // Collab count
  const collabCount = videos.filter(v => (v.title||'').toLowerCase().includes('warma')).length;
  choice('合作专题', 'medium', '怒九和 Warma 合作的视频大约有多少部？',
    `约 ${collabCount} 部`, [`约 ${collabCount+10} 部`,`约 ${Math.max(1,collabCount-10)} 部`,`约 ${collabCount*2} 部`],
    `标题中包含 warma/Warma 的合作视频约 ${collabCount} 部。`);
}
{
  // Longest subtitle video fact check
  const subTop = topBy('sub_lines').slice(0, 5);
  for (const v of subTop) {
    if (!v.sub_lines) continue;
    addTrueFalse('字幕探索', 'hard', `《${shortTitle(v)}》的字幕超过 ${Math.floor(v.sub_lines*0.8)} 行。`,
      v.sub_lines > Math.floor(v.sub_lines*0.8), `实际有 ${v.sub_lines} 行字幕。`);
  }
}
{
  // Duration comparisons between types
  for (const [type, count] of topTypes.slice(0, 4)) {
    const typeVids = videos.filter(v=>v.type===type);
    const longest = typeVids.sort((a,b)=>b.duration-a.duration)[0];
    if (longest && longest.duration > 60) {
      choice('视频内容', 'hard', `"${type}"类中最长的视频是哪一部？`,
        shortTitle(longest), typeVids.filter(v=>v.bvid!==longest.bvid).slice(0,5).map(shortTitle),
        `时长约 ${fmtDur(longest.duration)}。`);
    }
  }
}

// ═══ 高质量批量扩充：仅使用当前台账已有字段推导 ═══
{
  const metricLabels = {
    view: '播放量', like: '点赞数', danmaku: '弹幕数', coin: '投币数',
    favorite: '收藏数', share: '分享数', reply: '评论数',
    duration: '时长', sub_lines: '字幕行数', sub_chars: '字幕字符数', intro_count: '简介字数',
  };
  const metricDifficulty = metric => ['view', 'like', 'danmaku'].includes(metric) ? 'medium' : 'hard';
  const nearTitleWrongs = (correct, pool, metric = 'view') => {
    const seen = new Set([shortTitle(correct)]);
    const wrongs = [];
    for (const v of pool.slice().sort((a, b) => (b[metric] || 0) - (a[metric] || 0))) {
      if (v.bvid === correct.bvid) continue;
      const title = shortTitle(v);
      if (seen.has(title)) continue;
      seen.add(title);
      wrongs.push(title);
      if (wrongs.length === 3) break;
    }
    return wrongs;
  };

  // 每年 × 每个核心互动指标：年份内的真实冠军。
  for (let year = 2018; year <= 2026; year++) {
    const pool = videos.filter(v => v.date.startsWith(String(year)));
    if (pool.length < 4) continue;
    for (const [metric, label] of Object.entries(metricLabels).slice(0, 6)) {
      const sorted = pool.slice().sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
      const correct = sorted[0];
      if (!correct || !(correct[metric] > 0)) continue;
      const wrongs = nearTitleWrongs(correct, pool, metric);
      if (wrongs.length < 3) continue;
      add('数据之最', metricDifficulty(metric),
        `在 ${year} 年发布的视频里，${label}最高的是哪一部？`,
        [shortTitle(correct), ...wrongs], 0,
        `《${shortTitle(correct)}》发布于 ${correct.date}，${label}为 ${fmtNum(correct[metric])}。`);
    }
  }

  // 全库指标榜：播放、互动、文本规模都拆成排名题。
  for (const [metric, label] of Object.entries(metricLabels)) {
    const sorted = topBy(metric).filter(v => (v[metric] || 0) > 0);
    for (let i = 0; i < Math.min(12, sorted.length); i++) {
      const correct = sorted[i];
      const wrongs = nearTitleWrongs(correct, sorted.slice(i + 1), metric);
      if (wrongs.length < 3) continue;
      add('数据之最', i < 3 ? 'medium' : metricDifficulty(metric),
        `怒九${label}第 ${i + 1} 高的视频是哪一部？`,
        [shortTitle(correct), ...wrongs], 0,
        `《${shortTitle(correct)}》的${label}为 ${fmtNum(correct[metric])}，发布于 ${correct.date}。`);
    }
  }

  // 内容类型内部的记录与时间线。
  const typeRecords = videos.reduce((acc, v) => {
    if (!v.type) return acc;
    (acc[v.type] ||= []).push(v);
    return acc;
  }, {});
  for (const [type, pool] of Object.entries(typeRecords)) {
    if (pool.length < 4) continue;
    for (const metric of ['view', 'like', 'danmaku']) {
      const correct = pool.slice().sort((a, b) => (b[metric] || 0) - (a[metric] || 0))[0];
      const wrongs = nearTitleWrongs(correct, pool, metric);
      if (wrongs.length < 3) continue;
      add('视频内容', metricDifficulty(metric),
        `“${type}”类视频中${metricLabels[metric]}最高的是哪一部？`,
        [shortTitle(correct), ...wrongs], 0,
        `《${shortTitle(correct)}》的${metricLabels[metric]}为 ${fmtNum(correct[metric])}。`);
    }
    const earliest = pool.slice().sort((a, b) => a.date.localeCompare(b.date))[0];
    const latest = pool.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    const longest = pool.slice().sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
    const shortest = pool.slice().sort((a, b) => (a.duration || 0) - (b.duration || 0))[0];
    [
      ['最早', earliest], ['最新', latest], ['最长', longest], ['最短', shortest],
    ].forEach(([label, video]) => {
      if (!video) return;
      const wrongs = nearTitleWrongs(video, pool.filter(v => v.bvid !== video.bvid), label === '最长' ? 'duration' : 'view');
      if (wrongs.length < 3) return;
      const detail = label === '最早' || label === '最新'
        ? `发布日期是 ${video.date}。`
        : `时长约 ${fmtDur(video.duration)}。`;
      add(label === '最早' || label === '最新' ? '考古与里程碑' : '视频内容', 'medium',
        `“${type}”类中${label}的视频是哪一部？`,
        [shortTitle(video), ...wrongs], 0,
        `《${shortTitle(video)}》${detail}`);
    });
  }

  // 两个账号各自的互动冠军，避免只用总量比较。
  for (const accountShort of ['主号', '小号']) {
    const pool = videos.filter(v => v.account_short === accountShort);
    const accountName = accountShort === '主号' ? '主号（怒九笑）' : '小号（怒九摸鱼馆）';
    for (const [metric, label] of Object.entries(metricLabels).slice(0, 9)) {
      const sorted = pool.slice().sort((a, b) => (b[metric] || 0) - (a[metric] || 0)).filter(v => (v[metric] || 0) > 0);
      const correct = sorted[0];
      if (!correct) continue;
      const wrongs = nearTitleWrongs(correct, sorted.slice(1), metric);
      if (wrongs.length < 3) continue;
      add('深度对比', metricDifficulty(metric),
        `在 ${accountName} 的收录视频里，${label}最高的是哪一部？`,
        [shortTitle(correct), ...wrongs], 0,
        `《${shortTitle(correct)}》的${label}为 ${fmtNum(correct[metric])}。`);
    }
  }

  // 年度里程碑：每年首末投稿与各类型首作。
  for (const year of Object.keys(yearCounter).sort()) {
    const pool = videos.filter(v => v.date.startsWith(year));
    if (pool.length < 3) continue;
    const first = pool.slice().sort((a, b) => a.date.localeCompare(b.date))[0];
    const last = pool.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    [
      ['最早', first], ['最晚', last],
    ].forEach(([label, video]) => {
      const wrongs = nearTitleWrongs(video, pool.filter(v => v.bvid !== video.bvid), 'view');
      if (wrongs.length < 3) return;
      add('考古与里程碑', 'medium',
        `${year} 年${label}发布的收录视频是哪一部？`,
        [shortTitle(video), ...wrongs], 0,
        `《${shortTitle(video)}》发布于 ${video.date}。`);
    });
  }
  for (const [type, pool] of Object.entries(typeRecords)) {
    if (pool.length < 4) continue;
    const earliest = pool.slice().sort((a, b) => a.date.localeCompare(b.date))[0];
    const wrongs = nearTitleWrongs(earliest, pool.filter(v => v.bvid !== earliest.bvid), 'view');
    if (wrongs.length >= 3) {
      add('考古与里程碑', 'hard',
        `在当前收录记录中，最早出现的“${type}”内容是哪一部？`,
        [shortTitle(earliest), ...wrongs], 0,
        `《${shortTitle(earliest)}》发布于 ${earliest.date}。`);
    }
  }

  // 标签热度和相邻位次：全部从视频 tags 数组聚合。
  for (const [tag, count] of topTags.slice(0, 25)) {
    const wrongs = topTags.filter(([name]) => name !== tag).slice(0, 18).map(([name]) => name);
    if (wrongs.length < 3) continue;
    add('标签与分类', count > 50 ? 'easy' : 'hard',
      `“${tag}”标签在当前台账中出现了多少次？`,
      String(count), wrongs,
      `“${tag}”共出现 ${count} 次。`);
  }
  for (let i = 0; i < Math.min(24, topTags.length - 1); i++) {
    const [a, ac] = topTags[i];
    const [b, bc] = topTags[i + 1];
    if (!ac || !bc || ac === bc) continue;
    add('标签与分类', 'medium',
      `在当前标签统计里，“${a}”和“${b}”哪一个是更常用的标签？`,
      [a, b, '两者一样', '无法比较'], ac > bc ? 0 : 1,
      `“${a}”出现 ${ac} 次，“${b}”出现 ${bc} 次。`);
  }

  // 弹幕名梗：热度、精确次数和相邻位次。
  const topMemeRows = (RAW.top_memes || []).filter(m => m.content);
  for (let i = 0; i < Math.min(20, topMemeRows.length); i++) {
    const meme = topMemeRows[i];
    const wrongs = topMemeRows.filter(m => m.content !== meme.content).slice(0, 18).map(m => m.content);
    if (wrongs.length < 3) continue;
    add('梗与弹幕', i < 5 ? 'easy' : 'hard',
      `弹幕名梗榜第 ${i + 1} 位是什么？`,
      meme.content, wrongs,
      `“${meme.content}”共出现 ${fmtNum(meme.count)} 次。`);
  }
  for (let i = 0; i < Math.min(18, topMemeRows.length - 1); i++) {
    const a = topMemeRows[i];
    const b = topMemeRows[i + 1];
    if (!a.count || !b.count || a.count === b.count) continue;
    add('梗与弹幕', 'medium',
      `在当前弹幕总榜里，“${a.content}”和“${b.content}”哪一个出现次数更多？`,
      [a.content, b.content, '两者一样', '无法比较'], a.count > b.count ? 0 : 1,
      `“${a.content}”出现 ${fmtNum(a.count)} 次，“${b.content}”出现 ${fmtNum(b.count)} 次。`);
  }
  for (let i = 0; i < Math.min(12, topMemeRows.length); i++) {
    const meme = topMemeRows[i];
    const wrongs = topMemeRows.filter(m => m.content !== meme.content).slice(0, 12).map(m => m.content);
    if (wrongs.length < 3) continue;
    add('梗与弹幕', 'medium',
      `“${meme.content}”这条弹幕大约出现了多少次？`,
      fmtNum(meme.count), wrongs.map((_, index) => fmtNum(Math.max(1, Math.round(meme.count * [0.55, 1.35, 1.8][index % 3])))),
      `当前台账聚合到 ${fmtNum(meme.count)} 次。`);
  }

  // 弹幕峰值：问峰值位置，而不是只问总弹幕量。
  const peakVideos = videos
    .map(v => ({ v, peak: (v.peaks || []).slice().sort((a, b) => b.count - a.count)[0] }))
    .filter(row => row.peak && row.peak.count > 20)
    .sort((a, b) => b.peak.count - a.peak.count)
    .slice(0, 25);
  for (const { v, peak } of peakVideos) {
    const wrongTimes = (v.peaks || []).filter(p => p.t !== peak.t && Number.isFinite(p.t)).slice(0, 12).map(p => `${p.t} 秒`);
    if (wrongTimes.length < 3) continue;
    add('考古与里程碑', 'hard',
      `《${shortTitle(v)}》里弹幕最密集的片段大约从几秒开始？`,
      `${peak.t} 秒`, wrongTimes,
      `按分秒弹幕统计，${peak.t} 秒处最高峰约 ${fmtNum(peak.count)} 条。`);
  }

  // 热门视频三件套：账号、类型、年份。
  const hotVideos = topBy('view').slice(0, 80);
  for (const v of hotVideos) {
    const st = shortTitle(v);
    const isMain = v.account_short === '主号';
    add('视频内容', 'medium', `《${st}》发布在哪个账号？`,
      isMain ? '主号（怒九笑）' : '小号（怒九摸鱼馆）',
      isMain ? ['小号（怒九摸鱼馆）', '两个账号都发过', '没有收录'] : ['主号（怒九笑）', '两个账号都发过', '没有收录'],
      `发布于 ${v.account}，日期 ${v.date}。`);
    const typeWrongs = topTypes.map(([type]) => type).filter(type => type !== v.type).slice(0, 18);
    if (typeWrongs.length >= 3) {
      add('视频内容', 'easy', `《${st}》属于哪个内容类型？`,
        v.type, typeWrongs,
        `类型是 ${v.type}，发布于 ${v.date}。`);
    }
    const yearWrongs = Object.keys(yearCounter).filter(year => year !== v.date.slice(0, 4)).sort(() => Math.random() - 0.5).slice(0, 3).map(year => `${year}年`);
    if (yearWrongs.length >= 3) {
      add('视频内容', 'medium', `《${st}》发布于哪一年？`,
        `${v.date.slice(0, 4)}年`, yearWrongs,
        `准确日期是 ${v.date}。`);
    }
  }

  // 合作专题：标题中带 warma/Warma 的真实合作记录。
  const collabVideos = videos.filter(v => /warma/i.test(v.title)).sort((a, b) => (b.view || 0) - (a.view || 0)).slice(0, 40);
  for (const v of collabVideos) {
    const st = shortTitle(v);
    const isMain = v.account_short === '主号';
    add('合作专题', 'medium', `怒九和 Warma 合作的《${st}》发布在哪个账号？`,
      isMain ? '主号（怒九笑）' : '小号（怒九摸鱼馆）',
      isMain ? ['小号（怒九摸鱼馆）', '未在怒九账号发布', '两边都发布'] : ['主号（怒九笑）', '未在怒九账号发布', '两边都发布'],
      `发布于 ${v.account}。`);
    const typeWrongs = topTypes.map(([type]) => type).filter(type => type !== v.type).slice(0, 18);
    if (typeWrongs.length >= 3) {
      add('合作专题', 'medium', `怒九和 Warma 合作的《${st}》属于哪个内容类型？`,
        v.type, typeWrongs,
        `类型是 ${v.type}，发布于 ${v.date}。`);
    }
    const yearWrongs = Object.keys(yearCounter).filter(year => year !== v.date.slice(0, 4)).sort(() => Math.random() - 0.5).slice(0, 3).map(year => `${year}年`);
    if (yearWrongs.length >= 3) {
      add('合作专题', 'hard', `怒九和 Warma 合作的《${st}》发布于哪一年？`,
        `${v.date.slice(0, 4)}年`, yearWrongs,
        `准确日期是 ${v.date}。`);
    }
  }

  // 字幕溯源：直接引用 merged 中的字幕语段。
  const subtitlePool = videos.filter(v => (v.merged || []).length > 0 && (v.sub_lines || 0) > 0)
    .sort((a, b) => (b.sub_lines || 0) - (a.sub_lines || 0))
    .slice(0, 60);
  for (const video of subtitlePool) {
    const quote = (video.merged[0] || '').replace(/\s+/g, ' ').trim().slice(0, 55);
    if (quote.length < 8) continue;
    const wrongs = subtitlePool.filter(v => v.bvid !== video.bvid).map(shortTitle).slice(0, 30);
    if (wrongs.length < 3) continue;
    add('字幕探索', 'hard',
      `“${quote}……”这段字幕最可能出自哪部视频？`,
      shortTitle(video), wrongs,
      `来自 ${video.date} 的《${shortTitle(video)}》。`);
  }

  // 评论溯源：每个样本视频中的最高赞评论作者与来源视频。
  const commentSources = Object.entries(RAW_COMMENTS)
    .map(([bvid, comments]) => ({ video: videos.find(v => v.bvid === bvid), comments: comments || [] }))
    .filter(row => row.video && row.comments.length >= 4)
    .sort((a, b) => (b.video.reply || 0) - (a.video.reply || 0))
    .slice(0, 35);
  for (const { video, comments } of commentSources) {
    const sorted = comments.slice().sort((a, b) => (b.like || 0) - (a.like || 0));
    const correct = sorted[0];
    if (!correct?.name) continue;
    const seen = new Set([correct.name]);
    const authorWrongs = [];
    for (const comment of sorted.slice(1)) {
      if (comment.name && !seen.has(comment.name)) {
        seen.add(comment.name);
        authorWrongs.push(comment.name);
      }
      if (authorWrongs.length === 3) break;
    }
    if (authorWrongs.length < 3) continue;
    add('评论区', 'hard',
      `《${shortTitle(video)}》当前抓取样本中点赞最高的评论是谁发的？`,
      correct.name, authorWrongs,
      `评论来自 ${correct.name}，获赞 ${fmtNum(correct.like || 0)}。`);
  }

  // 冷知识：总览硬指标做成可校验判断题。
  const statChecks = [
    ['当前台账共收录 200 个视频。', videos.length === 200, `实际共收录 ${videos.length} 个。`],
    ['当前台账共收录 205 个视频。', videos.length === 205, `实际共收录 ${videos.length} 个。`],
    ['主号收录视频多于小号。', main.length > small.length, `主号 ${main.length} 个，小号 ${small.length} 个。`],
    ['当前累计播放量超过 2.8 亿。', (RAW.stats?.view || 0) > 280000000, `累计播放 ${fmtNum(RAW.stats?.view)}。`],
    ['当前累计点赞数超过 1690 万。', (RAW.stats?.like || 0) > 16900000, `累计点赞 ${fmtNum(RAW.stats?.like)}。`],
    ['当前累计投币数超过 500 万。', (RAW.stats?.coin || 0) > 5000000, `累计投币 ${fmtNum(RAW.stats?.coin)}。`],
    ['当前累计收藏数超过 574 万。', (RAW.stats?.favorite || 0) > 5740000, `累计收藏 ${fmtNum(RAW.stats?.favorite)}。`],
    ['当前累计分享数超过 46 万。', (RAW.stats?.share || 0) > 460000, `累计分享 ${fmtNum(RAW.stats?.share)}。`],
    ['当前累计评论/回复数超过 36 万。', (RAW.stats?.reply || 0) > 360000, `累计评论/回复 ${fmtNum(RAW.stats?.reply)}。`],
    ['当前抓取到的弹幕原始记录超过 48 万条。', (RAW.stats?.danmaku_records || 0) > 480000, `弹幕原始记录约 ${fmtNum(RAW.stats?.danmaku_records)} 条。`],
    ['当前有字幕数据的视频超过 79 部。', videos.filter(v => (v.sub_lines || 0) > 0).length > 79, `有字幕视频 ${videos.filter(v => (v.sub_lines || 0) > 0).length} 部。`],
    ['“游戏实况”是数量最多的内容类型。', topTypes[0]?.[0] === '游戏实况', `最多的是“${topTypes[0]?.[0]}”，共 ${topTypes[0]?.[1]} 部。`],
    ['“绘画/手书”是数量第二多的内容类型。', topTypes[1]?.[0] === '绘画/手书', `第二多的是“${topTypes[1]?.[0]}”，共 ${topTypes[1]?.[1]} 部。`],
    ['两个账号的 B 站等级都是 6 级。', (mainProfile.level || 0) === 6 && (smallProfile.level || 0) === 6, `主号 ${mainProfile.level || 0} 级，小号 ${smallProfile.level || 0} 级。`],
    ['主号和小号的合作邮箱一致。', mainProfile.sign?.includes('chickenfish@vip.qq.com') && smallProfile.sign?.includes('chickenfish@vip.qq.com'), '两个账号签名都写有合作邮箱。'],
  ];
  statChecks.forEach(([statement, isTrue, explanation]) => {
    addTrueFalse('冷知识', 'medium', statement, Boolean(isTrue), explanation);
  });
}

// ═══ Output ═══
const finalQuestions = [];
const seenQuestion = new Set();
for (const question of questions) {
  if (seenQuestion.has(question.q)) continue;
  seenQuestion.add(question.q);
  finalQuestions.push(question);
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
console.log('Categories:', output.categories.join(', '));
