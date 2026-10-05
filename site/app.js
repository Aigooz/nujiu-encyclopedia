'use strict';

window.addEventListener('error', event => {
  const banner = document.createElement('pre');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#7f1d1d;color:#fecaca;padding:10px 14px;font-size:12px;white-space:pre-wrap;max-height:40vh;overflow:auto';
  banner.textContent = 'JS 错误: ' + event.message + '\n文件: ' + event.filename + ':' + event.lineno + ':' + event.colno;
  document.body.appendChild(banner);
});

const PALETTE = ['#ff6b8a', '#7c5cff', '#2b8cff', '#00b894', '#ffab2e', '#00b8d9', '#f765a3', '#9ee493', '#d7c4ff'];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function numberFormat(n) {
  return Number(n || 0).toLocaleString('zh-CN');
}

function formatChineseNumber(n) {
  n = Number(n || 0);
  if (n >= 100000000) return (n / 100000000).toFixed(1) + ' 亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
  return n.toLocaleString('zh-CN');
}

function countBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function sumBy(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function average(list) {
  if (!list.length) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function accountLabel(value) {
  // 怒九摸鱼馆是怒九的小号，统计上并入小号，不单独分类。
  return value.includes('小号') ? '小号' : '主号';
}

function eraLabel(date) {
  const year = Number(date.slice(0, 4));
  if (year <= 2017) return '2015–2017';
  if (year <= 2020) return '2018–2020';
  if (year <= 2023) return '2021–2023';
  return '2024–2026';
}

function toEra(value) {
  const parts = value.split('–');
  return Number(parts[0]);
}

function extractTitleKeywords(title) {
  const text = title.toLowerCase();
  const keywords = [];
  const tests = [
    ['Warma', /warma|沃玛/], ['怒九', /怒九/], ['捏碳', /捏碳/], ['合作视频', /warma|沃玛|捏碳|四迹|双人|合作/],
    ['直播录像', /直播录像/], ['游戏实况', /实况|游戏|试玩/], ['爆炸电台', /爆炸电台/], ['爆米花电台', /爆米花电台/],
    ['电台', /电台/], ['翻唱', /翻唱|合唱|唱歌/], ['配音', /配音|中文配音/], ['手书', /手书/], ['小剧场', /小剧场/],
    ['绘画', /画画|绘画|手绘/], ['自制游戏', /自制游戏|游戏介绍/], ['星露谷物语', /星露谷/], ['Splatoon', /splatoon/],
    ['塞尔达', /塞尔达|旷野之息/], ['Undertale', /undertale/], ['Celeste', /celeste/], ['奥里', /奥里/],
    ['双影奇境', /双影奇境/], ['双人实况', /双影奇境|双人/], ['恐怖游戏', /恐怖/], ['恋爱', /恋爱|情侣|告白/],
    ['生活日常', /日常|生活|做饭|种田|旅行|老家/], ['鬼畜', /鬼畜/], ['动森', /动物森|岛上/], ['Subnautica', /subnautica|异星水域/],
    ['Minecraft', /minecraft|我的世界/], ['Party', /party|派对/], ['音乐游戏', /音游|音乐游戏/]
  ];
  for (const [name, pattern] of tests) if (pattern.test(text)) keywords.push(name);
  return keywords;
}

const state = {
  rows: [],
  page: 1,
  pageSize: 30,
  sort: { key: 'no', direction: 'desc' },
  theme: 'dark',
  charts: new Map()
};

function initRows() {
  state.rows = RAW.videos.map((v, i, arr) => {
    const date = new Date(v.date + 'T00:00:00');
    const prev = i > 0 ? arr[i - 1] : null;
    const daysSinceLast = prev ? Math.round((date - new Date(prev.date + 'T00:00:00')) / 86400000) : null;
    return {
      ...v,
      dateObj: date,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      weekday: date.getDay(),
      daysSinceLast,
      accountShort: accountLabel(v.account),
      era: eraLabel(v.date),
      keywords: extractTitleKeywords(v.title)
    };
  });
}

function applyFilters() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const account = document.getElementById('account').value;
  const type = document.getElementById('type').value;
  const yearRange = document.getElementById('yearRange').value;
  const minLines = Number(document.getElementById('minLines').value);
  const activeChip = document.querySelector('#quickChips .chip.on')?.dataset.filter || 'all';
  const maxYear = 2026;

  let rows = state.rows.filter(row => {
    const tagText = (row.tags || []).map(t => t.name).join(' ');
    const commentText = (row.comments || []).map(c => c.message).join(' ');
    const memeText = (row.memes || []).map(m => m.content).join(' ');
    if (q && !`${row.title} ${row.type} ${row.account} ${row.bvid} ${tagText} ${commentText} ${memeText}`.toLowerCase().includes(q)) return false;
    if (account !== 'all' && row.accountShort !== account) return false;
    if (type !== 'all' && row.type !== type) return false;
    if (minLines > 0 && row.sub_lines < minLines) return false;

    if (yearRange !== 'all') {
      if (yearRange === 'last1y' && row.date < '2025-10-01') return false;
      if (yearRange === 'last3y' && row.date < '2023-10-01') return false;
      if (yearRange === 'last5y' && row.date < '2021-10-01') return false;
      if (yearRange === '2020-2026' && row.year < 2020) return false;
      if (yearRange === '2018-2022' && (row.year < 2018 || row.year > 2022)) return false;
      if (yearRange === '2016-2019' && (row.year < 2016 || row.year > 2019)) return false;
    }

    if (activeChip === 'game' && row.type !== '游戏实况') return false;
    if (activeChip === 'radio' && !row.type.includes('电台')) return false;
    if (activeChip === 'music' && row.type !== '翻唱/音乐') return false;
    if (activeChip === 'long' && row.sub_lines < 1000) return false;
    if (activeChip === 'big' && row.sub_chars < 10000) return false;
    if (activeChip === 'main' && row.accountShort !== '主号') return false;
    if (activeChip === 'small' && row.accountShort === '主号') return false;
    return true;
  });

  const sort = getSort();
  rows.sort((a, b) => {
    let av = a[sort.key];
    let bv = b[sort.key];
    if (sort.key === 'title') { av = av || ''; bv = bv || ''; }
    if (sort.key === 'date') { av = a.date; bv = b.date; }
    if (sort.key === 'daysSinceLast') { av = av ?? -1; bv = bv ?? -1; }
    if (typeof av === 'string' && typeof bv === 'string') return sort.direction === 'asc' ? av.localeCompare(bv, 'zh-CN') : bv.localeCompare(av, 'zh-CN');
    return sort.direction === 'asc' ? av - bv : bv - av;
  });
  state.rowsFiltered = rows;
  state.page = 1;
  return rows;
}

function getSort() {
  const sortField = document.getElementById('sortField').value;
  if (sortField === 'date-desc') return { key: 'no', direction: 'desc' };
  if (sortField === 'date-asc') return { key: 'no', direction: 'asc' };
  const [key, direction] = sortField.split('-');
  return { key, direction };
}

function fillFilters() {
  const accounts = [...new Set(state.rows.map(row => row.accountShort))];
  const types = [...new Set(state.rows.map(row => row.type))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const accountSel = document.getElementById('account');
  const typeSel = document.getElementById('type');
  for (const account of accounts) accountSel.insertAdjacentHTML('beforeend', `<option value="${account}">${account}</option>`);
  for (const type of types) typeSel.insertAdjacentHTML('beforeend', `<option value="${type}">${type}</option>`);
  const allChip = document.querySelector('#quickChips .chip[data-filter="all"]');
  if (allChip) allChip.textContent = `全部 ${state.rows.length}`;
}

function updateStats(rows) {
  const dates = rows.map(row => row.date).sort();
  const intervals = rows.map(row => row.daysSinceLast).filter(value => value !== null && value >= 0);
  const last = rows[0] || null;
  const setStat = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  const setStatCount = (id, raw) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.hasAttribute('data-countup')) animateCountUp(el, raw);
    else el.textContent = formatChineseNumber(raw);
  };
  setStatCount('statVideos', rows.length);
  setStatCount('statViews', sumBy(rows, 'view'));
  setStatCount('statLikes', sumBy(rows, 'like'));
  setStatCount('statLines', sumBy(rows, 'sub_lines'));
  setStatCount('statChars', sumBy(rows, 'sub_chars'));
  setStatCount('statYears', new Set(rows.map(row => row.year)).size);
  setStat('statInterval', Math.round(average(intervals)) + ' 天');
  setStat('statLast', last ? last.date : '—');
  setStat('statLastTitle', last ? (last.title.length > 18 ? last.title.slice(0, 18) + '…' : last.title) : '—');
  document.getElementById('docVersion').textContent = `数据 ${RAW.docx_version}`;
  document.getElementById('footVersion').textContent = RAW.docx_version;
}

function baseOption(title) {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif', color: cssVar('--text') },
    tooltip: {
      trigger: 'item',
      backgroundColor: cssVar('--panel2'),
      borderColor: cssVar('--line'),
      textStyle: { color: cssVar('--text') }
    },
    legend: { textStyle: { color: cssVar('--muted') }, pageIconColor: cssVar('--pink'), pageTextStyle: { color: cssVar('--muted') } }
  };
}

function axisStyle() {
  return {
    axisLine: { lineStyle: { color: cssVar('--line') } },
    axisLabel: { color: cssVar('--muted') },
    splitLine: { lineStyle: { color: cssVar('--line'), type: 'dashed' } }
  };
}

function getChart(id, option) {
  let chart = state.charts.get(id);
  if (!chart) {
    chart = echarts.init(document.getElementById(id), null, { renderer: 'canvas' });
    state.charts.set(id, chart);
  }
  chart.setOption(option, true);
  return chart;
}

function renderEmptyChart(id) {
  getChart(id, {
    backgroundColor: 'transparent',
    title: { text: '当前筛选无数据', left: 'center', top: 'middle', textStyle: { color: cssVar('--muted'), fontSize: 14, fontWeight: 500 } }
  });
}

function renderAnnual(rows) {
  const byYear = new Map();
  rows.forEach(row => byYear.set(row.year, (byYear.get(row.year) || 0) + 1));
  const years = [...byYear.keys()].sort();
  let cumulative = 0;
  const cumulativeData = years.map(year => {
    cumulative += byYear.get(year);
    return [String(year), cumulative];
  });
  const option = {
    ...baseOption(),
    color: [PALETTE[0], PALETTE[2]],
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    grid: { left: 60, right: 60, top: 55, bottom: 40 },
    xAxis: { type: 'category', data: years, ...axisStyle() },
    yAxis: [
      { type: 'value', name: '投稿数', ...axisStyle() },
      { type: 'value', name: '累计', ...axisStyle(), splitLine: { show: false } }
    ],
    series: [
      { name: '年度投稿', type: 'bar', data: years.map(year => byYear.get(year)), barMaxWidth: 34, itemStyle: { borderRadius: [8, 8, 0, 0] } },
      { name: '累计视频', type: 'line', yAxisIndex: 1, smooth: true, symbolSize: 8, lineStyle: { width: 3 }, areaStyle: { opacity: 0.18 } }
    ]
  };
  getChart('chartAnnual', option);
}

function renderAccount(rows) {
  const data = countBy(rows, row => row.accountShort);
  const option = {
    ...baseOption(),
    color: [PALETTE[2], PALETTE[4], PALETTE[6]],
    tooltip: { trigger: 'item', formatter: '{b}<br>{c} 条 · {d}%' },
    series: [{ type: 'pie', radius: ['45%', '72%'], center: ['50%', '52%'], itemStyle: { borderColor: cssVar('--bg2'), borderWidth: 2, borderRadius: 6 }, label: { color: cssVar('--muted') }, data: data.map(([name, value]) => ({ name, value })) }]
  };
  getChart('chartAccount', option);
}

function renderType(rows) {
  const data = countBy(rows, row => row.type);
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 110, right: 45, top: 25, bottom: 40 },
    xAxis: { type: 'value', ...axisStyle() },
    yAxis: { type: 'category', data: data.map(([type]) => type).reverse(), ...axisStyle() },
    series: [{ type: 'bar', name: '视频数', data: data.map(([, value]) => value).reverse(), barMaxWidth: 22, itemStyle: { borderRadius: 8, color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: PALETTE[0] }, { offset: 1, color: PALETTE[1] }]) } }]
  };
  getChart('chartType', option);
}

function renderCumulative(rows) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  let lines = 0, chars = 0;
  const data = sorted.map(row => {
    lines += row.sub_lines;
    chars += row.sub_chars;
    return [row.date, lines, chars];
  });
  const option = {
    ...baseOption(),
    color: [PALETTE[3], PALETTE[2]],
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 65, top: 55, bottom: 60 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 10, borderColor: cssVar('--line') }],
    xAxis: { type: 'time', ...axisStyle() },
    yAxis: [
      { type: 'value', name: '字幕行', ...axisStyle() },
      { type: 'value', name: '字符', ...axisStyle(), splitLine: { show: false } }
    ],
    series: [
      { name: '累计字幕行', type: 'line', smooth: true, showSymbol: false, lineStyle: { width: 3 }, areaStyle: { opacity: .16 }, data: data.map(x => [x[0], x[1]]) },
      { name: '累计字符', type: 'line', yAxisIndex: 1, smooth: true, showSymbol: false, lineStyle: { width: 2, type: 'dashed' }, data: data.map(x => [x[0], x[2]]) }
    ]
  };
  getChart('chartCumulative', option);
}

function renderTypeStack(rows) {
  const years = [...new Set(rows.map(row => row.year))].sort();
  const counts = countBy(rows, row => row.type);
  const top = counts.slice(0, 8).map(([type]) => type);
  const series = top.map((type, index) => {
    const data = years.map(year => rows.filter(row => row.year === year && row.type === type).length);
    return { name: type, type: 'bar', stack: 'total', emphasis: { focus: 'series' }, barMaxWidth: 38, data, itemStyle: { color: PALETTE[index % PALETTE.length] } };
  });
  const otherData = years.map(year => rows.filter(row => row.year === year && !top.includes(row.type)).length);
  if (counts.length > 8) series.push({ name: '其他', type: 'bar', stack: 'total', data: otherData, itemStyle: { color: '#7d8aa0' } });
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 60, right: 35, top: 65, bottom: 40 },
    xAxis: { type: 'category', data: years.map(String), ...axisStyle() },
    yAxis: { type: 'value', ...axisStyle() },
    series
  };
  getChart('chartTypeStack', option);
}

function renderCalendar(rows) {
  if (!rows.length) { renderEmptyChart('chartCalendar'); return; }
  const maxDate = rows.map(row => row.date).sort().at(-1);
  const endDate = new Date(maxDate + 'T00:00:00');
  endDate.setDate(endDate.getDate() - 364);
  const range = [endDate.toISOString().slice(0, 10), maxDate];
  const data = countBy(rows.filter(row => row.date >= range[0]), row => row.date);
  const option = {
    ...baseOption(),
    tooltip: { formatter: p => `${p.value[0]}<br>投稿 ${p.value[1]} 条` },
    visualMap: {
      min: 0, max: Math.max(1, ...data.map(([, value]) => value)), calculable: true, orient: 'horizontal', left: 25, bottom: 10,
      inRange: { color: ['#1f2933', PALETTE[1], PALETTE[0], PALETTE[4]] }, textStyle: { color: cssVar('--muted') }
    },
    calendar: {
      top: 42, left: 45, right: 35, cellSize: ['auto', 12], range, splitLine: { show: false },
      itemStyle: { color: 'transparent', borderColor: cssVar('--line'), borderWidth: 1 },
      yearLabel: { show: true, color: cssVar('--text') }, monthLabel: { color: cssVar('--muted') },
      dayLabel: { firstDay: 1, nameMap: 'ZH', color: cssVar('--muted') }
    },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: data.map(([date, value]) => [date, value]) }]
  };
  getChart('chartCalendar', option);
}

function renderMonth(rows) {
  const data = new Array(12).fill(0);
  rows.forEach(row => data[row.month - 1]++);
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 25, top: 35, bottom: 40 },
    xAxis: { type: 'category', data: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'], ...axisStyle(), axisLabel: { rotate: 35, color: cssVar('--muted') } },
    yAxis: { type: 'value', ...axisStyle() },
    series: [{ type: 'bar', data, barMaxWidth: 28, itemStyle: { borderRadius: [8, 8, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: PALETTE[2] }, { offset: 1, color: PALETTE[6] }]) } }]
  };
  getChart('chartMonth', option);
}

function renderWeekday(rows) {
  const data = new Array(7).fill(0);
  rows.forEach(row => data[row.weekday]++);
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 25, top: 35, bottom: 40 },
    xAxis: { type: 'category', data: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'], ...axisStyle() },
    yAxis: { type: 'value', ...axisStyle() },
    series: [{ type: 'bar', data, barMaxWidth: 30, itemStyle: { borderRadius: [8, 8, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: PALETTE[1] }, { offset: 1, color: PALETTE[0] }]) } }]
  };
  getChart('chartWeekday', option);
}

function renderInterval(rows) {
  const byYear = new Map();
  rows.forEach(row => {
    if (row.daysSinceLast === null || row.daysSinceLast < 0) return;
    if (!byYear.has(row.year)) byYear.set(row.year, []);
    byYear.get(row.year).push(row.daysSinceLast);
  });
  const years = [...byYear.keys()].sort();
  const option = {
    ...baseOption(),
    color: [PALETTE[4], PALETTE[3]],
    tooltip: { trigger: 'axis' },
    grid: { left: 55, right: 30, top: 55, bottom: 40 },
    xAxis: { type: 'category', data: years.map(String), ...axisStyle() },
    yAxis: { type: 'value', name: '天', ...axisStyle() },
    series: [
      { name: '平均间隔', type: 'bar', data: years.map(year => Math.round(average(byYear.get(year)))), barMaxWidth: 30, itemStyle: { borderRadius: [8, 8, 0, 0] } },
      { name: '中位数', type: 'line', smooth: true, symbolSize: 8, data: years.map(year => Math.round(median(byYear.get(year)))) }
    ]
  };
  getChart('chartInterval', option);
}

function renderSunburst(rows) {
  const accountMap = new Map();
  for (const row of rows) {
    const account = row.accountShort;
    if (!accountMap.has(account)) accountMap.set(account, new Map());
    const typeMap = accountMap.get(account);
    typeMap.set(row.type, (typeMap.get(row.type) || 0) + 1);
  }
  const data = [...accountMap.entries()].map(([account, typeMap], index) => ({
    name: account,
    itemStyle: { color: PALETTE[index % PALETTE.length] },
    children: [...typeMap.entries()].map(([type, value]) => ({
      name: type, value,
      itemStyle: { color: PALETTE[(index + 2) % PALETTE.length] }
    }))
  }));
  const option = {
    ...baseOption(),
    tooltip: { formatter: p => `${p.name}<br>${p.value} 条` },
    series: [{
      type: 'sunburst', radius: ['16%', '88%'], center: ['50%', '52%'], sort: undefined,
      emphasis: { focus: 'ancestor' }, data,
      label: { color: '#fff', fontSize: 10, rotate: 'radial' }, itemStyle: { borderColor: cssVar('--bg2'), borderWidth: 1 }
    }]
  };
  getChart('chartSunburst', option);
}

function renderTreemap(rows) {
  const data = countBy(rows, row => row.type).map(([name, value], index) => ({ name, value, itemStyle: { color: PALETTE[index % PALETTE.length] } }));
  const option = {
    ...baseOption(),
    series: [{
      type: 'treemap', roam: false, nodeClick: 'zoomToNode', breadcrumb: { show: false }, itemStyle: { borderColor: cssVar('--bg2'), borderWidth: 2, gapWidth: 2 },
      label: { show: true, fontSize: 11, color: '#fff' }, upperLabel: { show: true, height: 22, color: '#fff' },
      levels: [{ itemStyle: { borderColor: cssVar('--bg2'), borderWidth: 4, gapWidth: 4 } }, { colorSaturation: [0.32, 0.55], itemStyle: { borderColorSaturation: 0.62, gapWidth: 2, borderWidth: 2 } }],
      data
    }]
  };
  getChart('chartTreemap', option);
}

function renderRadar(rows) {
  const topTypes = countBy(rows, row => row.type).slice(0, 5).map(([type]) => type);
  if (!topTypes.length) { renderEmptyChart('chartRadar'); return; }
  const metrics = topTypes.map(type => {
    const subset = rows.filter(row => row.type === type);
    return {
      type,
      avgLines: average(subset.map(row => row.sub_lines)),
      avgChars: average(subset.map(row => row.sub_chars)),
      count: subset.length,
      longRatio: subset.filter(row => row.sub_lines >= 1000).length / subset.length * 100,
      variety: new Set(subset.map(row => row.accountShort)).size
    };
  });
  const indicators = [
    { name: '平均字幕行', max: Math.ceil(Math.max(...metrics.map(x => x.avgLines)) / 100) * 100 || 1 },
    { name: '平均字符', max: Math.ceil(Math.max(...metrics.map(x => x.avgChars)) / 1000) * 1000 || 1 },
    { name: '视频数', max: Math.ceil(Math.max(...metrics.map(x => x.count)) / 5) * 5 || 1 },
    { name: '长字幕占比%', max: 100 },
    { name: '账号多样性', max: 3 }
  ];
  const data = metrics.map((metric, index) => ({
    name: metric.type,
    value: [Math.round(metric.avgLines), Math.round(metric.avgChars), metric.count, Math.round(metric.longRatio), metric.variety],
    areaStyle: { opacity: .14 }, lineStyle: { width: 2.5 }, itemStyle: { color: PALETTE[index % PALETTE.length] }
  }));
  const option = {
    ...baseOption(),
    radar: {
      indicator: indicators, radius: '62%', center: ['50%', '54%'],
      axisName: { color: cssVar('--muted'), fontSize: 10 }, splitLine: { lineStyle: { color: cssVar('--line') } },
      splitArea: { areaStyle: { color: ['transparent'] } }, axisLine: { lineStyle: { color: cssVar('--line') } }
    },
    series: [{ type: 'radar', data }]
  };
  getChart('chartRadar', option);
}

function renderSankey(rows) {
  const nodes = new Set();
  const links = new Map();
  function addLink(source, target) {
    if (!source || !target) return;
    nodes.add(source); nodes.add(target);
    const key = source + '→' + target;
    links.set(key, (links.get(key) || 0) + 1);
  }
  rows.forEach(row => {
    addLink(row.accountShort, row.type);
    addLink(row.type, row.era);
  });
  const nodeList = [...nodes];
  const option = {
    ...baseOption(),
    color: PALETTE,
    tooltip: { trigger: 'item' },
    series: [{
      type: 'sankey', left: 15, right: 125, top: 15, bottom: 15, emphasis: { focus: 'adjacency' },
      data: nodeList.map(name => ({ name })), lineStyle: { color: 'gradient', curveness: .55, opacity: .3 },
      label: { color: cssVar('--text'), fontSize: 11 },
      links: [...links.entries()].map(([key, value]) => { const [source, target] = key.split('→'); return { source, target, value }; })
    }]
  };
  getChart('chartSankey', option);
}

function renderScatter(rows) {
  const groups = countBy(rows, row => row.type);
  const series = groups.map(([type], index) => {
    const data = rows.filter(row => row.type === type).map(row => [row.date, row.sub_lines, row.sub_chars, row.title]);
    return {
      name: type, type: 'scatter', data, symbolSize: value => Math.max(7, Math.min(28, Math.sqrt(value[2]) / 3.2)),
      itemStyle: { color: PALETTE[index % PALETTE.length], opacity: .82 }, emphasis: { focus: 'series' }
    };
  });
  const option = {
    ...baseOption(),
    tooltip: {
      formatter: p => `${p.value[3]}<br>日期：${p.value[0]}<br>字幕：${numberFormat(p.value[1])} 行<br>字符：${numberFormat(p.value[2])}`
    },
    grid: { left: 65, right: 35, top: 65, bottom: 60 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 10, borderColor: cssVar('--line') }],
    xAxis: { type: 'time', name: '投稿时间', ...axisStyle() },
    yAxis: { type: 'value', name: '字幕行', ...axisStyle() },
    series
  };
  getChart('chartScatter', option);
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value = (value + 0x6D2B79F5) >>> 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function standardizeMatrix(matrix) {
  const dimensions = matrix[0].length;
  const means = Array(dimensions).fill(0);
  const deviations = Array(dimensions).fill(0);
  matrix.forEach(row => row.forEach((value, index) => { means[index] += value / matrix.length; }));
  matrix.forEach(row => row.forEach((value, index) => { deviations[index] += (value - means[index]) ** 2 / matrix.length; }));
  return matrix.map(row => row.map((value, index) => (value - means[index]) / Math.sqrt(deviations[index] || 1e-8)));
}

function pcaProject(matrix) {
  const normalized = standardizeMatrix(matrix);
  const dimensions = normalized[0].length;
  const covariance = Array.from({ length: dimensions }, () => Array(dimensions).fill(0));
  normalized.forEach(row => {
    for (let i = 0; i < dimensions; i++) {
      for (let j = 0; j < dimensions; j++) covariance[i][j] += row[i] * row[j] / normalized.length;
    }
  });

  const principalVector = (source) => {
    let vector = Array.from({ length: dimensions }, (_, index) => Math.sin(index + 1) + 0.18);
    for (let iteration = 0; iteration < 90; iteration++) {
      const next = Array(dimensions).fill(0);
      for (let i = 0; i < dimensions; i++) {
        for (let j = 0; j < dimensions; j++) next[i] += source[i][j] * vector[j];
      }
      const length = Math.sqrt(next.reduce((total, value) => total + value * value, 0)) || 1;
      vector = next.map(value => value / length);
    }
    return vector;
  };

  const firstVector = principalVector(covariance);
  const quadratic = (vector) => {
    let value = 0;
    for (let i = 0; i < dimensions; i++) {
      let product = 0;
      for (let j = 0; j < dimensions; j++) product += covariance[i][j] * vector[j];
      value += vector[i] * product;
    }
    return value;
  };
  const firstValue = quadratic(firstVector);
  const residual = covariance.map((row, i) => row.map((value, j) => value - firstValue * firstVector[i] * firstVector[j]));
  const secondVector = principalVector(residual);
  const secondValue = Math.max(0, residual.reduce((total, row, i) => total + row[i] * secondVector[i], 0));
  const points = normalized.map(row => [
    row.reduce((total, value, index) => total + value * firstVector[index], 0),
    row.reduce((total, value, index) => total + value * secondVector[index], 0)
  ]);
  const variance = covariance.reduce((total, row, index) => total + row[index], 0) || 1;
  return { points, explained: [firstValue / variance * 100, secondValue / variance * 100] };
}

function kMeansClusters(matrix, clusterCount = 4) {
  if (matrix.length <= clusterCount) return matrix.map((_, index) => index % Math.max(1, matrix.length));
  const normalized = standardizeMatrix(matrix);
  const distance = (a, b) => a.reduce((total, value, index) => total + (value - b[index]) ** 2, 0);
  let best = null;
  for (let restart = 0; restart < 8; restart++) {
    const random = mulberry32(2026 + restart * 97);
    const centers = [normalized[Math.floor(random() * normalized.length)]];
    while (centers.length < clusterCount) {
      const distances = normalized.map(point => Math.min(...centers.map(center => distance(point, center))));
      const total = distances.reduce((sum, value) => sum + value, 0);
      if (!total) { centers.push(normalized[Math.floor(random() * normalized.length)]); continue; }
      let cursor = random() * total;
      let selected = 0;
      while (cursor > distances[selected] && selected < distances.length - 1) cursor -= distances[selected++];
      centers.push(normalized[selected]);
    }
    const assignments = Array(normalized.length).fill(0);
    for (let iteration = 0; iteration < 30; iteration++) {
      let changed = false;
      normalized.forEach((point, index) => {
        let target = 0;
        for (let cluster = 1; cluster < centers.length; cluster++) {
          if (distance(point, centers[cluster]) < distance(point, centers[target])) target = cluster;
        }
        if (assignments[index] !== target) { assignments[index] = target; changed = true; }
      });
      for (let cluster = 0; cluster < clusterCount; cluster++) {
        const members = normalized.filter((_, index) => assignments[index] === cluster);
        if (members.length) centers[cluster] = members[0].map((_, dimension) => members.reduce((total, point) => total + point[dimension], 0) / members.length);
      }
      if (!changed && iteration > 0) break;
    }
    const inertia = normalized.reduce((total, point, index) => total + distance(point, centers[assignments[index]]), 0);
    if (!best || inertia < best.inertia) best = { inertia, assignments };
  }
  return best.assignments;
}

function renderAlgorithmClusters(rows) {
  if (rows.length < 5) { renderEmptyChart('chartAlgorithmClusters'); return; }
  const matrix = rows.map(row => [
    Math.log1p(row.view || 0), Math.log1p(row.like || 0), Math.log1p(row.danmaku || 0),
    Math.log1p(row.reply || 0), Math.log1p(row.favorite || 0), Math.log1p(row.coin || 0),
    Math.log1p(row.share || 0), Math.log1p(row.duration || 0),
    Math.log1p(row.sub_lines || 0), Math.log1p(row.sub_chars || 0)
  ]);
  const { points, explained } = pcaProject(matrix);
  const normalizedMatrix = standardizeMatrix(matrix);
  const assignments = kMeansClusters(matrix, Math.min(4, rows.length));
  const clusterCount = new Set(assignments).size;
  const profiles = Array.from({ length: clusterCount }, (_, cluster) => {
    const members = normalizedMatrix.filter((_, index) => assignments[index] === cluster);
    return {
      popularity: average(members.map((point, index) => point.slice(0, 7).reduce((sum, value) => sum + value, 0) / 7)),
      density: average(members.map(point => (point[8] + point[9]) / 2)),
      duration: average(members.map(point => point[7]))
    };
  });
  const remaining = new Set(Array.from({ length: clusterCount }, (_, index) => index));
  const clusterNames = Array(clusterCount).fill('均衡型');
  const takeTop = (scoreKey, label) => {
    if (!remaining.size) return;
    const target = [...remaining].sort((a, b) => profiles[b][scoreKey] - profiles[a][scoreKey])[0];
    clusterNames[target] = label;
    remaining.delete(target);
  };
  takeTop('popularity', '高热度型');
  takeTop('density', '字幕密集型');
  takeTop('duration', '长内容型');
  [...remaining].sort((a, b) => profiles[b].popularity - profiles[a].popularity).forEach((cluster, index) => {
    clusterNames[cluster] = index ? `均衡型 ${index + 1}` : '均衡型';
  });
  const series = Array.from({ length: clusterCount }, (_, cluster) => ({
    name: clusterNames[cluster],
    type: 'scatter',
    data: points.map((point, index) => assignments[index] === cluster ? {
      value: [point[0], point[1], rows[index].view],
      name: rows[index].title,
      row: rows[index]
    } : null).filter(Boolean),
    symbolSize: value => Math.max(8, Math.min(26, Math.sqrt(value[2] || 1) / 22)),
    itemStyle: { color: PALETTE[cluster % PALETTE.length], opacity: .82 },
    emphasis: { focus: 'series' }
  }));
  const option = {
    ...baseOption(),
    tooltip: {
      formatter: p => `${p.data.name}<br>${p.data.row.date} · ${p.data.row.type}<br>播放 ${formatChineseNumber(p.data.row.view)}<br>字幕 ${numberFormat(p.data.row.sub_lines)} 行<br>算法：PCA(${explained.map(value => value.toFixed(1) + '%').join(' / ')})`
    },
    grid: { left: 55, right: 28, top: 58, bottom: 42 },
    xAxis: { type: 'value', name: `主成分 1 · ${explained[0].toFixed(0)}%`, ...axisStyle() },
    yAxis: { type: 'value', name: `主成分 2 · ${explained[1].toFixed(0)}%`, ...axisStyle() },
    series
  };
  getChart('chartAlgorithmClusters', option);
}

function renderSimilarFinder(rows) {
  const sourceSelect = document.getElementById('similarSource');
  const targetBox = document.getElementById('similarList');
  if (!sourceSelect || !targetBox || !rows.length) { if (targetBox) targetBox.innerHTML = '<p class="mini">当前筛选无数据</p>'; return; }
  if (!rows.some(row => row.bvid === state.similarBvid)) state.similarBvid = rows[0].bvid;
  sourceSelect.innerHTML = rows.map(row => `<option value="${row.bvid}" ${row.bvid === state.similarBvid ? 'selected' : ''}>${row.no}. ${esc(row.title.slice(0, 42))}</option>`).join('');

  const documents = rows.map(row => {
    const tokens = new Set([row.type, ...row.keywords, ...(row.tags || []).map(tag => '标签:' + tag.name)]);
    Array.from(row.title.toLowerCase().matchAll(/[a-z0-9]{2,}/g)).forEach(match => tokens.add('词:' + match[0]));
    Array.from(row.title).forEach((_, index, chars) => {
      if (index < chars.length - 1) {
        const pair = chars.slice(index, index + 2).join('');
        if (/[\u4e00-\u9fff]{2}/.test(pair)) tokens.add('二元:' + pair);
      }
    });
    return [...tokens].filter(Boolean);
  });
  const documentFrequency = new Map();
  documents.forEach(document => document.forEach(token => documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1)));
  const vectors = documents.map(document => {
    const vector = new Map();
    document.forEach(token => vector.set(token, (vector.get(token) || 0) + 1));
    let norm = 0;
    vector.forEach((count, token) => {
      const weight = count * Math.log((rows.length + 1) / ((documentFrequency.get(token) || 0) + 1)) + 1;
      vector.set(token, weight);
      norm += weight * weight;
    });
    return { vector, norm: Math.sqrt(norm) || 1 };
  });
  const sourceIndex = Math.max(0, rows.findIndex(row => row.bvid === state.similarBvid));
  const sourceVector = vectors[sourceIndex];
  const scores = rows.map((row, index) => {
    if (index === sourceIndex) return { row, score: -1 };
    let dot = 0;
    vectors[index].vector.forEach((weight, token) => { if (sourceVector.vector.has(token)) dot += weight * sourceVector.vector.get(token); });
    return { row, score: dot / (vectors[index].norm * sourceVector.norm) };
  }).sort((a, b) => b.score - a.score).slice(0, 8);
  const source = rows[sourceIndex];
  targetBox.innerHTML = `
    <div class="similarity-source"><b>基准视频</b><span>${esc(source.title)}</span></div>
    ${scores.map((item, index) => {
      const percent = Math.max(0, Math.min(100, item.score * 100));
      const tags = (item.row.tags || []).slice(0, 3).map(tag => esc(tag.name)).join(' · ');
      return `<button type="button" class="similarity-item" data-bvid="${item.row.bvid}">
        <span class="rank">${index + 1}</span>
        <span class="title">${esc(item.row.title)}</span>
        <span class="meta">${item.row.date} · ${tags || item.row.type}</span>
        <span class="bar"><i style="width:${percent.toFixed(1)}%;background:${PALETTE[index % PALETTE.length]}"></i></span>
        <span class="score">${percent.toFixed(1)}%</span>
      </button>`;
    }).join('')}`;
}

function renderTagAffinity(rows) {
  const counts = new Map();
  rows.forEach(row => (row.tags || []).forEach(tag => {
    const name = tag.name.trim();
    if (!name || /^(怒九|怒九笑|怒九摸鱼馆)$/i.test(name)) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  }));
  const names = [...counts.entries()].filter(([, value]) => value >= 3).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([name]) => name);
  if (names.length < 5) { renderEmptyChart('chartTagAffinity'); return; }
  const nameSet = new Set(names);
  const pairCounts = new Map();
  rows.forEach(row => {
    const tags = [...new Set((row.tags || []).map(tag => tag.name.trim()).filter(name => nameSet.has(name)))];
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = [tags[i], tags[j]].sort().join('→');
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  });
  const data = [];
  names.forEach((first, x) => names.forEach((second, y) => {
    if (x === y) return;
    const joint = pairCounts.get([first, second].sort().join('→')) || 0;
    if (!joint) return;
    const pmi = Math.log2((joint * rows.length) / (counts.get(first) * counts.get(second)));
    data.push([x, y, pmi, joint]);
  }));
  const values = data.map(item => item[2]);
  const option = {
    ...baseOption(),
    tooltip: {
      formatter: p => `${names[p.value[0]]} × ${names[p.value[1]]}<br>共同出现 ${numberFormat(p.value[3])} 次<br>PMI ${p.value[2].toFixed(2)}<br>提升度 ${(2 ** p.value[2]).toFixed(2)}`
    },
    grid: { left: 112, right: 24, top: 8, bottom: 92 },
    xAxis: { type: 'category', data: names, axisLabel: { rotate: 45, color: cssVar('--muted'), fontSize: 10 }, axisLine: { lineStyle: { color: cssVar('--line') } } },
    yAxis: { type: 'category', data: names, axisLabel: { color: cssVar('--muted'), fontSize: 10 }, axisLine: { lineStyle: { color: cssVar('--line') } } },
    visualMap: {
      min: Math.min(...values), max: Math.max(...values), calculable: true, orient: 'horizontal', left: 'center', bottom: 4,
      textStyle: { color: cssVar('--muted') }, inRange: { color: ['#7c5cff', '#ff6b8a', '#ffab2e'] }
    },
    series: [{ type: 'heatmap', data, itemStyle: { borderWidth: 2, borderColor: cssVar('--panel'), borderRadius: 4 }, emphasis: { itemStyle: { shadowBlur: 8 } } }]
  };
  getChart('chartTagAffinity', option);
}

function renderKeywordEvolution(rows) {
  const counts = new Map();
  rows.forEach(row => [...new Set(row.keywords)].forEach(keyword => counts.set(keyword, (counts.get(keyword) || 0) + 1)));
  const keywords = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
  if (!keywords.length) { renderEmptyChart('chartKeywordEvolution'); return; }
  const years = [...new Set(rows.map(row => row.year))].sort();
  const series = keywords.map((keyword, index) => {
    const data = years.map(year => {
      const yearRows = rows.filter(row => row.year === year);
      const hits = yearRows.filter(row => row.keywords.includes(keyword)).length;
      return [String(year), yearRows.length ? hits / yearRows.length * 100 : 0];
    });
    return { name: keyword, type: 'line', smooth: true, symbolSize: 6, data, lineStyle: { width: 2.5, color: PALETTE[index % PALETTE.length] }, itemStyle: { color: PALETTE[index % PALETTE.length] }, emphasis: { focus: 'series' } };
  });
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', backgroundColor: cssVar('--panel2'), borderColor: cssVar('--line'), textStyle: { color: cssVar('--text') }, valueFormatter: value => Number(value).toFixed(1) + '%' },
    legend: { type: 'scroll', top: 2, textStyle: { color: cssVar('--muted') }, pageIconColor: cssVar('--pink'), pageTextStyle: { color: cssVar('--muted') } },
    grid: { left: 48, right: 24, top: 58, bottom: 38 },
    xAxis: { type: 'category', boundaryGap: false, data: years.map(String), ...axisStyle() },
    yAxis: { type: 'value', name: '年度视频占比', ...axisStyle() },
    series
  };
  getChart('chartKeywordEvolution', option);
}

function renderGraph(rows) {
  const counts = new Map();
  rows.forEach(row => row.keywords.forEach(keyword => {
    if (keyword !== '怒九') counts.set(keyword, (counts.get(keyword) || 0) + 1);
  }));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 26);
  if (!top.length) { renderEmptyChart('chartGraph'); return; }
  const topSet = new Set(top.map(([name]) => name));
  const names = top.map(([name]) => name);
  const adjacency = new Map(names.map(name => [name, new Map()]));
  const pairs = new Map();
  rows.forEach(row => {
    const keywords = [...new Set(row.keywords)].filter(keyword => topSet.has(keyword));
    for (let i = 0; i < keywords.length; i++) {
      for (let j = i + 1; j < keywords.length; j++) {
        const key = [keywords[i], keywords[j]].sort().join('→');
        pairs.set(key, (pairs.get(key) || 0) + 1);
        const [first, second] = key.split('→');
        adjacency.get(first).set(second, (adjacency.get(first).get(second) || 0) + 1);
        adjacency.get(second).set(first, (adjacency.get(second).get(first) || 0) + 1);
      }
    }
  });

  let labels = names.map((_, index) => index);
  for (let iteration = 0; iteration < 18; iteration++) {
    const next = [...labels];
    names.forEach((name, index) => {
      const votes = new Map();
      adjacency.get(name).forEach((weight, neighbor) => {
        const label = labels[names.indexOf(neighbor)];
        votes.set(label, (votes.get(label) || 0) + weight);
      });
      let bestLabel = labels[index];
      let bestScore = 0;
      votes.forEach((score, label) => {
        if (score > bestScore) { bestScore = score; bestLabel = label; }
      });
      if (bestScore > 0) next[index] = bestLabel;
    });
    if (next.every((label, index) => label === labels[index])) break;
    labels = next;
  }
  for (let round = 0; round < 3; round++) {
    const groupMembers = new Map();
    labels.forEach((label, index) => {
      if (!groupMembers.has(label)) groupMembers.set(label, []);
      groupMembers.get(label).push(index);
    });
    let merged = false;
    for (const [label, members] of [...groupMembers]) {
      if (members.length >= 3 || groupMembers.size <= 5) continue;
      const contacts = new Map();
      members.forEach(index => adjacency.get(names[index]).forEach((weight, neighbor) => {
        const target = labels[names.indexOf(neighbor)];
        if (target !== label) contacts.set(target, (contacts.get(target) || 0) + weight);
      }));
      if (!contacts.size) continue;
      const target = [...contacts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      members.forEach(index => labels[index] = target);
      merged = true;
    }
    if (!merged) break;
  }
  const labelMap = new Map();
  const nodeCluster = labels.map(label => {
    if (!labelMap.has(label)) labelMap.set(label, labelMap.size);
    return labelMap.get(label);
  });

  let rank = names.map(() => 1 / names.length);
  for (let iteration = 0; iteration < 32; iteration++) {
    const next = names.map(() => 0.15 / names.length);
    names.forEach((name, index) => {
      let total = 0;
      adjacency.get(name).forEach(value => total += value);
      if (!total) return;
      adjacency.get(name).forEach((weight, neighbor) => next[names.indexOf(neighbor)] += 0.85 * rank[index] * weight / total);
    });
    rank = next;
  }
  const maxRank = Math.max(...rank);
  const maxCount = Math.max(1, ...top.map(([, value]) => value));
  const maxPair = Math.max(1, ...pairs.values());
  const categories = Array.from(labelMap.values()).map((_, index) => ({
    name: `主题群 ${index + 1}`,
    itemStyle: { color: PALETTE[index % PALETTE.length] }
  }));
  const nodes = names.map((name, index) => {
    const value = top[index][1];
    const influence = (value / maxCount) * 0.58 + (rank[index] / maxRank) * 0.42;
    return {
      name, value, category: nodeCluster[index],
      symbolSize: 13 + Math.sqrt(influence) * 42,
      label: { show: value > maxCount / 3 || rank[index] > maxRank * .68, color: cssVar('--text'), fontSize: 10 }
    };
  });
  const links = [...pairs.entries()].map(([key, value]) => {
    const [source, target] = key.split('→');
    return { source, target, value, lineStyle: { width: 1 + (value / maxPair) * 6, color: cssVar('--line'), opacity: .75 } };
  });
  const option = {
    ...baseOption(),
    tooltip: { formatter: p => p.dataType === 'edge' ? `${p.data.source} × ${p.data.target}<br>共现 ${p.data.value} 次` : `${p.name}<br>出现 ${p.value} 次<br>PageRank ${(rank[names.indexOf(p.name)] / maxRank * 100).toFixed(0)}%` },
    legend: { type: 'scroll', top: 0, data: categories.map(item => item.name), textStyle: { color: cssVar('--muted') }, pageIconColor: cssVar('--pink'), pageTextStyle: { color: cssVar('--muted') } },
    series: [{
      type: 'graph', layout: 'force', roam: true, draggable: true,
      force: { repulsion: 340, edgeLength: [52, 132], gravity: .12, friction: .18 },
      categories, nodes, links,
      labelLayout: { hideOverlap: true },
      emphasis: { focus: 'adjacency', lineStyle: { opacity: 1 } },
      scaleLimit: { min: .45, max: 3.2 }
    }]
  };
  getChart('chartGraph', option);
}

function renderTagCloud(rows) {
  const counts = new Map();
  rows.forEach(row => {
    (row.tags || []).forEach(tag => {
      const name = tag.name;
      if (!name || /^(怒九|怒九笑|怒九摸鱼馆)$/i.test(name)) return;
      counts.set(name, (counts.get(name) || 0) + 1);
    });
  });
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 36);
  const max = Math.max(1, ...list.map(([, value]) => value));
  const cloud = document.getElementById('tagCloud');
  cloud.innerHTML = list.map(([keyword, value], index) => {
    const scale = 12 + (value / max) * 16;
    return `<span class="tag" style="font-size:${scale.toFixed(0)}px;background:${PALETTE[index % PALETTE.length]}22;color:${PALETTE[index % PALETTE.length]}" title="${keyword}：${value} 次">${keyword}</span>`;
  }).join('');
}

function renderTop(rows) {
  const top = [...rows].sort((a, b) => b.sub_lines - a.sub_lines).slice(0, 20).reverse();
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: params => { const p = params[0]; const row = top[p.dataIndex]; return `${row.title}<br>${numberFormat(row.sub_lines)} 行 · ${numberFormat(row.sub_chars)} 字符`; } },
    grid: { left: 250, right: 50, top: 25, bottom: 40 },
    xAxis: { type: 'value', ...axisStyle() },
    yAxis: { type: 'category', data: top.map(row => row.title.length > 18 ? row.title.slice(0, 18) + '…' : row.title), ...axisStyle(), axisLabel: { fontSize: 10, color: cssVar('--muted') } },
    series: [{
      type: 'bar', name: '字幕行', data: top.map(row => row.sub_lines), barMaxWidth: 18,
      itemStyle: { borderRadius: 9, color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: PALETTE[1] }, { offset: 1, color: PALETTE[0] }]) }
    }]
  };
  getChart('chartTop', option).off('click');
}

function renderTopViews(rows) {
  const top = [...rows].filter(r => r.view).sort((a, b) => b.view - a.view).slice(0, 15).reverse();
  if (!top.length) { renderEmptyChart('chartTopViews'); return; }
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: params => { const p = params[0]; const row = top[p.dataIndex]; return `${row.title}<br>${numberFormat(row.view)} 次播放<br>${numberFormat(row.like)} 点赞 · ${numberFormat(row.danmaku)} 弹幕`; } },
    grid: { left: 250, right: 60, top: 25, bottom: 40 },
    xAxis: { type: 'value', ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, formatter: v => formatChineseNumber(v) } },
    yAxis: { type: 'category', data: top.map(row => row.title.length > 18 ? row.title.slice(0, 18) + '…' : row.title), ...axisStyle(), axisLabel: { fontSize: 10, color: cssVar('--muted') } },
    series: [{
      type: 'bar', name: '播放量', data: top.map(row => row.view), barMaxWidth: 18,
      itemStyle: { borderRadius: 9, color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: PALETTE[4] }, { offset: 1, color: PALETTE[0] }]) }
    }]
  };
  const chart = getChart('chartTopViews', option);
  chart.off('click');
  chart.on('click', params => { const row = top[params.dataIndex]; if (row && row.bvid) window.open(`https://www.bilibili.com/video/${row.bvid}`, '_blank'); });
}

function renderEngageMix(rows) {
  const totals = [
    { name: '点赞', value: sumBy(rows, 'like'), color: PALETTE[0] },
    { name: '投币', value: sumBy(rows, 'coin'), color: PALETTE[4] },
    { name: '收藏', value: sumBy(rows, 'favorite'), color: PALETTE[3] },
    { name: '分享', value: sumBy(rows, 'share'), color: PALETTE[2] },
    { name: '评论', value: sumBy(rows, 'reply'), color: PALETTE[1] },
    { name: '弹幕', value: sumBy(rows, 'danmaku'), color: PALETTE[8] }
  ].filter(x => x.value > 0);
  if (!totals.length) { renderEmptyChart('chartEngageMix'); return; }
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'item', formatter: p => `${p.name}<br>${numberFormat(p.value)}（${p.percent}%）` },
    legend: { bottom: 0, textStyle: { color: cssVar('--muted'), fontSize: 11 } },
    series: [{
      type: 'pie', radius: ['42%', '70%'], center: ['50%', '44%'],
      label: { show: false }, data: totals, itemStyle: { borderColor: cssVar('--panel'), borderWidth: 2 }
    }]
  };
  getChart('chartEngageMix', option);
}

function renderEngageScatter(rows) {
  const data = rows.filter(r => r.view && r.like).map(r => {
    const rate = r.like / r.view;
    return { value: [r.view, Number((rate * 100).toFixed(2)), r.danmaku || 0], title: r.title, bvid: r.bvid, date: r.date };
  });
  if (!data.length) { renderEmptyChart('chartEngageScatter'); return; }
  const option = {
    ...baseOption(),
    tooltip: { formatter: p => `${p.data.title}<br>播放 ${numberFormat(p.data.value[0])}<br>点赞率 ${p.data.value[1]}%<br>弹幕 ${numberFormat(p.data.value[2])}` },
    grid: { left: 70, right: 40, top: 30, bottom: 60 },
    xAxis: { type: 'log', name: '播放量', nameLocation: 'middle', nameGap: 30, ...axisStyle() },
    yAxis: { type: 'value', name: '点赞率 %', ...axisStyle() },
    series: [{
      type: 'scatter', data,
      symbolSize: (raw, params) => {
        const item = data[params.dataIndex];
        const danmaku = item ? (item.value[2] || 0) : 0;
        return Math.max(6, Math.min(30, Math.sqrt(danmaku) / 6));
      },
      itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 1, [{ offset: 0, color: PALETTE[0] }, { offset: 1, color: PALETTE[1] }]), opacity: 0.75 }
    }]
  };
  const chart = getChart('chartEngageScatter', option);
  chart.off('click');
  chart.on('click', params => { if (params.data.bvid) window.open(`https://www.bilibili.com/video/${params.data.bvid}`, '_blank'); });
}

function renderYearViews(rows) {
  const byYear = new Map();
  for (const r of rows) {
    const y = r.year;
    if (!y) continue;
    byYear.set(y, (byYear.get(y) || 0) + (r.view || 0));
  }
  const years = [...byYear.keys()].sort();
  if (!years.length) { renderEmptyChart('chartYearViews'); return; }
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', formatter: p => `${p[0].name} 年<br>${formatChineseNumber(p[0].value)} 次播放` },
    grid: { left: 60, right: 30, top: 30, bottom: 40 },
    xAxis: { type: 'category', data: years, ...axisStyle() },
    yAxis: { type: 'value', ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, formatter: v => formatChineseNumber(v) } },
    series: [{
      type: 'bar', data: years.map(y => byYear.get(y)), barMaxWidth: 28,
      itemStyle: { borderRadius: 8, color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: PALETTE[2] }, { offset: 1, color: PALETTE[3] }]) }
    }]
  };
  getChart('chartYearViews', option);
}

function renderTypeViews(rows) {
  const byType = new Map();
  for (const r of rows) {
    const t = r.type || '其他';
    byType.set(t, (byType.get(t) || 0) + (r.view || 0));
  }
  const list = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (!list.length) { renderEmptyChart('chartTypeViews'); return; }
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', formatter: p => `${p[0].name}<br>${formatChineseNumber(p[0].value)} 次播放` },
    grid: { left: 130, right: 40, top: 25, bottom: 40 },
    xAxis: { type: 'value', ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, formatter: v => formatChineseNumber(v) } },
    yAxis: { type: 'category', data: list.map(x => x[0]).reverse(), ...axisStyle() },
    series: [{
      type: 'bar', data: list.map(x => x[1]).reverse(), barMaxWidth: 20,
      itemStyle: { borderRadius: 8, color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: PALETTE[5] }, { offset: 1, color: PALETTE[6] }]) }
    }]
  };
  getChart('chartTypeViews', option);
}

// ── 新增分析模块 ─────────────────────────────────────────────

function renderPubClock(rows) {
  const hours = new Array(24).fill(0);
  rows.forEach(row => {
    const h = Number((row.pubdate_iso || '').split(' ')[1]?.split(':')[0]);
    if (!isNaN(h) && h >= 0 && h < 24) hours[h]++;
  });
  const total = hours.reduce((a, b) => a + b, 0);
  if (!total) { renderEmptyChart('chartPubClock'); return; }
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'item', formatter: p => `${p.name}:00<br><b>${p.value}</b> 个视频<br>占比 ${(p.value / total * 100).toFixed(1)}%` },
    polar: { radius: ['18%', '78%'], center: ['50%', '52%'] },
    angleAxis: {
      type: 'category', data: hours.map((_, i) => i + ':00'), startAngle: 90,
      axisLine: { lineStyle: { color: cssVar('--line') } },
      axisLabel: { color: cssVar('--muted'), fontSize: 10 },
      splitLine: { show: false }
    },
    radiusAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
    series: [{
      type: 'bar', coordinateSystem: 'polar', roundCap: true,
      data: hours.map((value, index) => ({
        value,
        itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: index < 6 || index >= 20 ? PALETTE[1] : PALETTE[0] },
          { offset: 1, color: index < 6 || index >= 20 ? PALETTE[3] : PALETTE[4] }
        ]), borderRadius: 4 }
      })),
      emphasis: { itemStyle: { shadowBlur: 12, shadowColor: 'rgba(124,92,255,.5)' } }
    }]
  };
  getChart('chartPubClock', option);
}

function renderPubWeekday(rows) {
  const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const matrix = [];
  rows.forEach(row => {
    const h = Number((row.pubdate_iso || '').split(' ')[1]?.split(':')[0]);
    if (isNaN(h) || h < 0 || h >= 24) return;
    // JS getDay: 0=Sun … 6=Sat → 映射到 周一=0
    const wd = (row.weekday + 6) % 7;
    matrix.push([h, wd, 1]);
  });
  // 聚合
  const agg = new Map();
  matrix.forEach(([h, w]) => { const key = `${h}-${w}`; agg.set(key, (agg.get(key) || 0) + 1); });
  const data = [...agg.entries()].map(([key, count]) => { const [h, w] = key.split('-').map(Number); return [h, w, count]; });
  if (!data.length) { renderEmptyChart('chartPubWeekday'); return; }
  const maxVal = Math.max(...data.map(d => d[2]));
  const option = {
    ...baseOption(),
    tooltip: { formatter: p => `${weekdayNames[p.value[1]]} ${p.value[0]}:00–${p.value[0] + 1}:00<br><b>${p.value[2]}</b> 个视频` },
    grid: { left: 65, right: 30, top: 20, bottom: 65 },
    xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, i) => i + ''), axisLabel: { color: cssVar('--muted'), fontSize: 10 }, axisLine: { show: false }, splitArea: { show: true, areaStyle: { color: ['rgba(128,128,128,.04)', 'transparent'] } } },
    yAxis: { type: 'category', data: weekdayNames, axisLabel: { color: cssVar('--muted'), fontSize: 11 }, axisLine: { show: false } },
    visualMap: {
      min: 0, max: Math.max(1, maxVal), calculable: true, orient: 'horizontal', left: 'center', bottom: 4,
      textStyle: { color: cssVar('--muted'), fontSize: 10 },
      inRange: { color: [cssVar('--panel'), '#3b1d5c', PALETTE[1], PALETTE[0], PALETTE[4]] }
    },
    series: [{ type: 'heatmap', data, label: { show: data.length < 200, color: cssVar('--text'), fontSize: 9 }, itemStyle: { borderWidth: 2, borderColor: cssVar('--panel'), borderRadius: 4 } }]
  };
  getChart('chartPubWeekday', option);
}

function renderCommentYear(rows) {
  const byYear = new Map();
  rows.forEach(row => (row.comments || []).forEach(c => {
    const year = new Date(c.ctime * 1000).getFullYear();
    byYear.set(year, (byYear.get(year) || 0) + 1);
  }));
  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (!years.length) { renderEmptyChart('chartCommentYear'); return; }
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', formatter: p => `${p[0].name} 年<br><b>${numberFormat(p[0].value)}</b> 条评论` },
    grid: { left: 65, right: 30, top: 30, bottom: 40 },
    xAxis: { type: 'category', data: years.map(String), ...axisStyle() },
    yAxis: { type: 'value', ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, formatter: v => formatChineseNumber(v) } },
    series: [{
      type: 'bar', data: years.map(y => byYear.get(y)), barMaxWidth: 26,
      itemStyle: { borderRadius: [8, 8, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: PALETTE[7] }, { offset: 1, color: PALETTE[3] }]) }
    }]
  };
  getChart('chartCommentYear', option);
}

function renderCommenterRank(rows) {
  const commenterMap = new Map();
  rows.forEach(row => (row.comments || []).forEach(c => {
    if (!c.name) return;
    if (!commenterMap.has(c.name)) commenterMap.set(c.name, { likes: 0, count: 0 });
    const entry = commenterMap.get(c.name);
    entry.likes += c.like || 0;
    entry.count++;
  }));
  const top = [...commenterMap.entries()]
    .sort((a, b) => b[1].likes - a[1].likes)
    .slice(0, 15);
  if (!top.length) { renderEmptyChart('chartCommenterRank'); return; }
  const rev = [...top].reverse();
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => {
      const [name, d] = rev[p[0].dataIndex];
      return `<b>${esc(name)}</b><br>总获赞 ${numberFormat(d.likes)}<br>评论 ${d.count} 条`;
    } },
    grid: { left: 130, right: 55, top: 20, bottom: 40 },
    xAxis: { type: 'value', ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, formatter: v => formatChineseNumber(v) } },
    yAxis: { type: 'category', data: rev.map(([name]) => name.length > 10 ? name.slice(0, 10) + '…' : name), ...axisStyle(), axisLabel: { fontSize: 10, color: cssVar('--muted') } },
    series: [{
      type: 'bar', data: rev.map(([, d]) => d.likes), barMaxWidth: 16,
      itemStyle: { borderRadius: 8, color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: PALETTE[6] }, { offset: 1, color: PALETTE[0] }]) }
    }]
  };
  getChart('chartCommenterRank', option);
}

function renderHonorTimeline(rows) {
  const items = [];
  rows.forEach(row => (row.honors || []).forEach(h => {
    items.push({ date: row.date, title: row.title, desc: h.desc, type: h.type, bvid: row.bvid });
  }));
  items.sort((a, b) => a.date.localeCompare(b.date));
  if (!items.length) { renderEmptyChart('chartHonorTimeline'); return; }
  // 按年份分组展示，每根柱代表当年荣誉数量
  const byYear = new Map();
  items.forEach(item => {
    const year = Number(item.date.slice(0, 4));
    byYear.set(year, (byYear.get(year) || 0) + 1);
  });
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const typeNames = { 2: '热门', 3: '排行榜', 4: '每周必看', 7: '其他推荐' };
  const seriesNames = [...new Set(items.map(i => typeNames[i.type] || '其他'))];
  const seriesData = seriesNames.map((name, si) => ({
    name,
    type: 'bar', stack: 'honor',
    data: years.map(year => items.filter(i => Number(i.date.slice(0, 4)) === year && (typeNames[i.type] || '其他') === name).length),
    barMaxWidth: 28,
    itemStyle: { borderRadius: si === seriesNames.length - 1 ? [6, 6, 0, 0] : 0, color: PALETTE[si % PALETTE.length] }
  }));
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => {
      const year = years[p[0].dataIndex];
      const yearItems = items.filter(i => Number(i.date.slice(0, 4)) === year);
      return `<b>${year} 年</b> 共 ${yearItems.length} 个荣誉<br>` + p.map(x => `${x.marker}${x.seriesName}: ${x.value}`).join('<br>');
    } },
    legend: { top: 2, textStyle: { color: cssVar('--muted'), fontSize: 11 } },
    grid: { left: 50, right: 30, top: 55, bottom: 40 },
    xAxis: { type: 'category', data: years.map(String), ...axisStyle() },
    yAxis: { type: 'value', name: '荣誉数', ...axisStyle() },
    series: seriesData
  };
  getChart('chartHonorTimeline', option);
}

function renderHonorType(rows) {
  const typeNames = { 2: '热门收录', 3: '全站排行榜', 4: '每周必看', 7: '其他推荐' };
  const counts = new Map();
  rows.forEach(row => (row.honors || []).forEach(h => {
    const name = typeNames[h.type] || '其他';
    counts.set(name, (counts.get(name) || 0) + 1);
  }));
  const data = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!data.length) { renderEmptyChart('chartHonorType'); return; }
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'item', formatter: p => `${p.name}<br><b>${p.value}</b> 次<br>占比 ${p.percent}%` },
    legend: { bottom: 0, textStyle: { color: cssVar('--muted'), fontSize: 11 } },
    series: [{
      type: 'pie', radius: ['42%', '70%'], center: ['50%', '44%'], roseType: 'radius',
      label: { color: cssVar('--text'), fontSize: 11, formatter: '{b}\n{c} 次' },
      data: data.map(([name, value], index) => ({ name, value, itemStyle: { color: PALETTE[index % PALETTE.length], borderColor: cssVar('--panel'), borderWidth: 2 } }))
    }]
  };
  getChart('chartHonorType', option);
}

function renderDurationInsight(rows) {
  const buckets = [
    { label: '<1分钟', min: 0, max: 60 },
    { label: '1–5分钟', min: 60, max: 300 },
    { label: '5–15分钟', min: 300, max: 900 },
    { label: '15–30分钟', min: 900, max: 1800 },
    { label: '30分钟+', min: 1800, max: Infinity }
  ];
  const data = buckets.map(bucket => {
    const subset = rows.filter(r => (r.duration || 0) >= bucket.min && (r.duration || 0) < bucket.max && r.view > 0);
    const avgLikeRate = average(subset.map(r => r.like / r.view * 100));
    const avgCoinRate = average(subset.map(r => r.coin / r.view * 100));
    return { label: bucket.label, likeRate: Number(avgLikeRate.toFixed(2)), coinRate: Number(avgCoinRate.toFixed(2)), count: subset.length };
  });
  if (!data.some(d => d.count)) { renderEmptyChart('chartDurationInsight'); return; }
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', formatter: p => {
      const d = data[p[0].dataIndex];
      return `<b>${d.label}</b><br>样本 ${d.count} 个<br>平均点赞率 ${d.likeRate}%<br>平均投币率 ${d.coinRate}%`;
    } },
    legend: { top: 2, textStyle: { color: cssVar('--muted'), fontSize: 11 } },
    grid: { left: 55, right: 30, top: 55, bottom: 40 },
    xAxis: { type: 'category', data: data.map(d => d.label), ...axisStyle() },
    yAxis: { type: 'value', name: '率 %', ...axisStyle() },
    series: [
      { name: '点赞率%', type: 'bar', data: data.map(d => d.likeRate), barMaxWidth: 30, itemStyle: { borderRadius: [8, 8, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: PALETTE[0] }, { offset: 1, color: PALETTE[1] }]) } },
      { name: '投币率%', type: 'bar', data: data.map(d => d.coinRate), barMaxWidth: 30, itemStyle: { borderRadius: [8, 8, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: PALETTE[4] }, { offset: 1, color: PALETTE[3] }]) } }
    ]
  };
  getChart('chartDurationInsight', option);
}

function renderDescInsight(rows) {
  const buckets = [
    { label: '无简介', min: 0, max: 1 },
    { label: '1–30字', min: 1, max: 31 },
    { label: '31–60字', min: 31, max: 61 },
    { label: '61–100字', min: 61, max: 101 },
    { label: '100字+', min: 101, max: Infinity }
  ];
  const data = buckets.map(bucket => {
    const subset = rows.filter(r => { const len = (r.desc || '').length; return len >= bucket.min && len < bucket.max && r.view > 0; });
    const avgView = average(subset.map(r => r.view));
    const avgLikeRate = average(subset.map(r => r.view > 0 ? r.like / r.view * 100 : 0));
    return { label: bucket.label, avgView: Math.round(avgView), avgLikeRate: Number(avgLikeRate.toFixed(2)), count: subset.length };
  });
  if (!data.some(d => d.count)) { renderEmptyChart('chartDescInsight'); return; }
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', formatter: p => {
      const d = data[p[0].dataIndex];
      return `<b>${d.label}</b><br>样本 ${d.count} 个<br>平均播放 ${formatChineseNumber(d.avgView)}<br>平均点赞率 ${d.avgLikeRate}%`;
    } },
    legend: { top: 2, textStyle: { color: cssVar('--muted'), fontSize: 11 } },
    grid: { left: 65, right: 65, top: 55, bottom: 40 },
    xAxis: { type: 'category', data: data.map(d => d.label), ...axisStyle() },
    yAxis: [
      { type: 'value', name: '平均播放', ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, formatter: v => formatChineseNumber(v) } },
      { type: 'value', name: '点赞率%', ...axisStyle(), splitLine: { show: false } }
    ],
    series: [
      { name: '平均播放', type: 'bar', data: data.map(d => d.avgView), barMaxWidth: 30, itemStyle: { borderRadius: [8, 8, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: PALETTE[2] }, { offset: 1, color: PALETTE[5] }]) } },
      { name: '点赞率%', type: 'line', yAxisIndex: 1, data: data.map(d => d.avgLikeRate), smooth: true, symbolSize: 8, lineStyle: { width: 3, color: PALETTE[0] }, itemStyle: { color: PALETTE[0] } }
    ]
  };
  getChart('chartDescInsight', option);
}

const GALLERY_PAGE_SIZE = 36;
let galleryShown = GALLERY_PAGE_SIZE;

function renderCoverGallery(rows) {
  const el = document.getElementById('coverGallery');
  if (!el) return;
  const accountFilter = document.getElementById('galleryAccount')?.value || 'all';
  const yearFilter = document.getElementById('galleryYear')?.value || 'all';
  let filtered = rows;
  if (accountFilter !== 'all') filtered = filtered.filter(r => r.accountShort === accountFilter);
  if (yearFilter !== 'all') filtered = filtered.filter(r => String(r.year) === yearFilter);
  filtered = filtered.filter(r => r.pic);

  const galleryYear = document.getElementById('galleryYear');
  if (galleryYear && galleryYear.options.length <= 1) {
    const years = [...new Set(state.rows.map(r => r.year))].sort((a, b) => b - a);
    years.forEach(y => galleryYear.insertAdjacentHTML('beforeend', `<option value="${y}">${y}</option>`));
  }

  const countEl = document.getElementById('galleryCount');
  if (countEl) countEl.textContent = `${filtered.length} 个封面`;

  const shown = filtered.slice(0, galleryShown);
  el.innerHTML = shown.map((row, index) => `
    <div class="gallery-item" data-bvid="${row.bvid}" tabindex="0">
      <img src="${esc(row.pic)}" alt="${esc(row.title.slice(0, 30))}" referrerpolicy="no-referrer" loading="lazy" style="--delay:${Math.min(index % 12, 11) * 0.04}s">
      <div class="gallery-overlay">
        <span class="gallery-title">${esc(row.title)}</span>
        <span class="gallery-meta">${row.date} · ${formatChineseNumber(row.view || 0)} 播放</span>
      </div>
      ${(row.honors || []).length ? '<span class="gallery-honor">🏆</span>' : ''}
    </div>`).join('');

  const moreBtn = document.getElementById('galleryMore');
  if (moreBtn) moreBtn.style.display = filtered.length > galleryShown ? 'block' : 'none';
}

function renderDanmakuYearly() {
  const yd = RAW.yearly_danmaku || {};
  const years = Object.keys(yd).sort();
  if (!years.length) { renderEmptyChart('chartDanmakuYearly'); return; }
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', formatter: p => `${p[0].name} 年<br><b>${formatChineseNumber(p[0].value)}</b> 条弹幕` },
    grid: { left: 70, right: 30, top: 30, bottom: 40 },
    xAxis: { type: 'category', data: years, ...axisStyle() },
    yAxis: { type: 'value', ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, formatter: v => formatChineseNumber(v) } },
    series: [{
      type: 'bar', data: years.map(y => yd[y]), barMaxWidth: 30,
      itemStyle: { borderRadius: 8, color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: PALETTE[0] }, { offset: 1, color: PALETTE[1] }]) }
    }]
  };
  getChart('chartDanmakuYearly', option);
}

function renderFollowers() {
  const el = document.getElementById('followerLine');
  if (!el) return;
  const followers = RAW.followers || {};
  const parts = Object.values(followers).map(a => `${a.name} ${formatChineseNumber(a.follower || 0)} 粉`);
  el.textContent = parts.length ? `粉丝：${parts.join(' · ')}` : '';
}

function renderProfiles() {
  const el = document.getElementById('profileCards');
  if (!el) return;
  const profiles = RAW.profiles || {};
  const entries = Object.values(profiles);
  if (!entries.length) { el.innerHTML = '<div class="mini">暂无 UP 主资料</div>'; return; }
  el.innerHTML = entries.map(p => `
    <div class="profile-card">
      <img class="profile-face" src="${esc(p.face || '')}" alt="" referrerpolicy="no-referrer" loading="lazy">
      <div class="profile-info">
        <div class="profile-name">${esc(p.name || '')} <span class="pill lv">Lv.${p.level || '?'}</span></div>
        <div class="profile-sign">${esc((p.sign || '').slice(0, 60))}</div>
        <div class="profile-fans mini">粉丝 ${formatChineseNumber(p.fans || 0)}</div>
      </div>
    </div>`).join('');
}

function renderMemes() {
  const memes = (RAW.top_memes || []).slice(0, 25);
  if (!memes.length) { renderEmptyChart('chartMemes'); return; }
  const rev = [...memes].reverse();
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', formatter: p => { const m = rev[p.dataIndex]; if (!m) return ''; return `${m.content}<br>重复 <b>${numberFormat(m.count)}</b> 次`; } },
    grid: { left: 210, right: 50, top: 20, bottom: 40 },
    xAxis: { type: 'value', ...axisStyle() },
    yAxis: { type: 'category', data: rev.map(m => m.content.length > 15 ? m.content.slice(0, 15) + '…' : m.content), ...axisStyle() },
    series: [{
      type: 'bar', data: rev.map(m => m.count), barMaxWidth: 16,
      itemStyle: { borderRadius: 8, color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: PALETTE[1] }, { offset: 1, color: PALETTE[4] }]) }
    }]
  };
  const chart = getChart('chartMemes', option);
  chart.off('click');
  chart.on('click', params => {
    const m = rev[params.dataIndex];
    if (m) {
      document.getElementById('q').value = m.content;
      document.getElementById('danmaku').scrollIntoView({ behavior: 'smooth' });
      renderAll();
    }
  });
}

function renderSync(rows) {
  const sync = RAW.table_sync || {};
  document.getElementById('syncRecords').textContent = numberFormat(sync.record_count || RAW.videos.length);
  document.getElementById('syncCompleteness').textContent = `${((sync.field_completeness || 0) * 100).toFixed(1)}%`;
  document.getElementById('syncMaxGap').textContent = `${numberFormat(sync.max_gap_days || 0)} 天`;
  document.getElementById('syncAvgGap').textContent = `${numberFormat(sync.avg_gap_days || 0)} 天`;
  document.getElementById('syncStamp').textContent = sync.generated_at || RAW.docx_version;

  const gaps = state.rows
    .filter(row => Number.isFinite(row.gap_days) && row.gap_days > 0)
    .sort((a, b) => b.gap_days - a.gap_days)
    .slice(0, 20);
  if (!gaps.length) { renderEmptyChart('chartGapRank'); } else {
    const option = {
      ...baseOption(),
      tooltip: { trigger: 'axis', formatter: params => {
        const row = gaps[params[0].dataIndex];
        return `<b>${esc(row.title)}</b><br>${row.accountShort} · ${row.date}<br>距上一投：<b>${numberFormat(row.gap_days)} 天</b>`;
      } },
      grid: { left: 230, right: 45, top: 20, bottom: 40 },
      xAxis: { type: 'value', ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, formatter: v => `${v} 天` } },
      yAxis: { type: 'category', data: gaps.map(row => `${row.accountShort} · ${row.date}`).reverse(), ...axisStyle() },
      series: [{
        type: 'bar', data: gaps.map(row => row.gap_days).reverse(), barMaxWidth: 18,
        itemStyle: { borderRadius: 8, color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: PALETTE[0] }, { offset: 1, color: PALETTE[1] }]) }
      }]
    };
    const chart = getChart('chartGapRank', option);
    chart.off('click');
    chart.on('click', params => { const row = gaps[params.dataIndex]; if (row) openVideoModal(row.bvid); });
  }

  const bands = countBy(state.rows, row => row.gap_band);
  const bandLabels = ['≤7天', '≤30天', '≤90天', '>90天'];
  const bandData = bandLabels.map(label => ({ name: label, value: bands.find(([name]) => name === label)?.[1] || 0 }));
  getChart('chartGapBand', {
    ...baseOption(),
    tooltip: { trigger: 'item', formatter: p => `${p.name}<br><b>${numberFormat(p.value)}</b> 个间隔` },
    legend: { bottom: 0, textStyle: { color: cssVar('--muted'), fontSize: 11 } },
    series: [{
      type: 'pie', radius: ['40%', '70%'], center: ['50%', '44%'],
      data: bandData, itemStyle: { borderColor: cssVar('--bg2'), borderWidth: 2 },
      label: { color: cssVar('--text'), fontSize: 11, formatter: '{b}\n{c}' }
    }]
  });

  const summary = sync.accounts || [];
  document.getElementById('syncAccountTable').innerHTML = `
    <div class="sync-table-head">账号</div><div class="sync-table-head">记录</div><div class="sync-table-head">首投</div><div class="sync-table-head">最新</div><div class="sync-table-head">最长</div>
    ${summary.map(item => `
      <div>${esc(item.account?.includes('小号') ? '小号' : '主号')}</div>
      <div class="num">${numberFormat(item.record_count)}</div>
      <div>${esc(item.first_date || '—')}</div>
      <div>${esc(item.last_date || '—')}</div>
      <div class="num">${numberFormat(item.max_gap_days || 0)} 天</div>
    `).join('')}`;

  const typeGaps = [...new Set(rows.map(row => row.type))].map(type => {
    const values = rows.filter(row => row.type === type && Number.isFinite(row.gap_days)).map(row => row.gap_days);
    return { type, value: values.length ? average(values) : 0, count: values.length };
  }).filter(item => item.count >= 3).sort((a, b) => b.value - a.value).slice(0, 12);
  if (!typeGaps.length) { renderEmptyChart('chartTypeGap'); } else {
    const option = {
      ...baseOption(),
      tooltip: { trigger: 'axis', formatter: p => {
        const item = typeGaps[p[0].dataIndex];
        return `${item.type}<br>平均间隔：<b>${item.value.toFixed(1)} 天</b><br>样本：${item.count} 个`;
      } },
      grid: { left: 145, right: 40, top: 20, bottom: 40 },
      xAxis: { type: 'value', ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, formatter: v => `${v} 天` } },
      yAxis: { type: 'category', data: typeGaps.map(item => item.type.length > 11 ? item.type.slice(0, 11) + '…' : item.type).reverse(), ...axisStyle() },
      series: [{ type: 'bar', data: typeGaps.map(item => Number(item.value.toFixed(1))).reverse(), barMaxWidth: 18, itemStyle: { borderRadius: 8, color: PALETTE[2] } }]
    };
    getChart('chartTypeGap', option);
  }

  const sourceRows = countBy(state.rows, row => row.table_source || 'B站用户视频列表');
  const sourceTotal = sourceRows.reduce((total, [, value]) => total + value, 0);
  document.getElementById('sourceStrip').innerHTML = sourceRows.map(([name, value]) => `
    <div class="source-item" title="${esc(name)}：${numberFormat(value)} 条记录">
      <span>${esc(name)}</span><b>${numberFormat(value)}</b><span class="mini">${sourceTotal ? (value / sourceTotal * 100).toFixed(1) : 0}%</span>
    </div>`).join('');
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeLabel(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function closeVideoModal() {
  document.getElementById('videoModal').hidden = true;
  document.body.style.overflow = '';
  if (state.modalChart) { state.modalChart.dispose(); state.modalChart = null; }
}

function openVideoModal(bvid) {
  const row = state.rows.find(r => r.bvid === bvid);
  if (!row) return;
  const modal = document.getElementById('videoModal');
  modal.dataset.bvid = bvid;
  ensureCommentsLoaded();
  const body = document.getElementById('modalBody');
  const stats = [['播放', row.view], ['点赞', row.like], ['投币', row.coin], ['弹幕', row.danmaku], ['评论', row.reply], ['收藏', row.favorite], ['分享', row.share]];
  const tags = (row.tags || []).map(t => `<span class="pill">${esc(t.name)}</span>`).join(' ');
  const peaks = (row.peaks || []).map(p => `
    <div class="peak-item">
      <div class="peak-head"><b>${timeLabel(p.t)}</b><span class="mini">10 秒内 ${numberFormat(p.count)} 条弹幕</span></div>
      <div class="peak-samples">${(p.samples || []).map(s => `<span class="dm">「${esc(s)}」</span>`).join('')}</div>
    </div>`).join('');
  const memes = (row.memes || []).map(m => `<span class="chip small">${esc(m.content)} ×${numberFormat(m.count)}</span>`).join('') || '<span class="mini">暂无明显重复弹幕</span>';
  const comments = (row.comments || []).map((c, i) => `
    <div class="comment">
      <div class="comment-head"><span class="comment-rank">${i + 1}</span><b>${esc(c.name)}</b><span class="mini">👍 ${numberFormat(c.like)}</span></div>
      <div class="comment-msg">${esc(c.message)}</div>
  ${(c.replies || []).map(r => `<div class="comment-sub">↳ <b>${esc(r.name)}</b>：${esc(r.message)}</div>`).join('')}
  </div>`).join('') || (commentsPromise && typeof RAW_COMMENTS === 'undefined' ? '<div class="mini">评论数据正在加载…</div>' : '<div class="mini">暂未抓取到评论</div>');
  body.innerHTML = `
    <div class="modal-hero">
    ${row.pic ? `<img src="${esc(row.pic)}" alt="" referrerpolicy="no-referrer" loading="lazy" decoding="async">` : ''}
      <div class="modal-hero-text">
        <h3>${esc(row.title)}</h3>
        <div class="mini">${esc(row.date || '')} · ${esc(row.type || '')} · ${esc(row.account || '')}${row.duration ? ' · ' + timeLabel(row.duration) : ''}</div>
        <div class="mini table-source-line">表格来源：${esc(row.table_source || 'B站用户视频列表')}${Number.isFinite(row.gap_days) ? ` · 距上一投 ${numberFormat(row.gap_days)} 天` : ''}</div>
        ${(row.honors || []).length ? `<div class="honor-badges">${(row.honors || []).map(h => `<span class="pill honor">${esc(h.desc)}</span>`).join(' ')}</div>` : ''}
        <div class="modal-stats">${stats.map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v ? formatChineseNumber(v) : '—'}</span></div>`).join('')}</div>
        <a class="btn" href="https://www.bilibili.com/video/${row.bvid}" target="_blank" rel="noreferrer">前往 B 站 ↗</a>
      </div>
    </div>
    ${tags ? `<div class="modal-block"><h4>B 站标签</h4><div class="tag-pills">${tags}</div></div>` : ''}
    <div class="modal-block"><h4>弹幕密度曲线（高能时刻）</h4><div id="modalPeakChart" class="modal-chart"></div>
      ${peaks ? `<div class="peaks">${peaks}</div>` : '<div class="mini">暂无弹幕数据</div>'}
    </div>
    <div class="modal-block"><h4>本视频名梗</h4><div class="tag-pills">${memes}</div></div>
    <div class="modal-block"><h4>热门评论</h4>${comments}</div>
  `;
  document.getElementById('videoModal').hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => renderPeakChart(row));
}

function renderPeakChart(row) {
  const profile = row.dm_profile || [];
  const el = document.getElementById('modalPeakChart');
  if (!el || !profile.length) { if (el) el.innerHTML = '<div class="mini" style="padding:20px">该视频暂无带时间戳的弹幕数据</div>'; return; }
  if (state.modalChart) { state.modalChart.dispose(); state.modalChart = null; }
  state.modalChart = echarts.init(el);
  const peaks = (row.peaks || []).map(p => p.t);
  const option = {
    ...baseOption(),
    tooltip: { trigger: 'axis', formatter: p => { const d = profile[p[0].dataIndex]; return `${timeLabel(d[0])} 处 10 秒<br><b>${numberFormat(d[1])}</b> 条弹幕`; } },
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: profile.map(d => timeLabel(d[0])), ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, interval: Math.max(0, Math.floor(profile.length / 8)) } },
    yAxis: { type: 'value', ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, formatter: v => formatChineseNumber(v) } },
    series: [{
      type: 'line', data: profile.map(d => d[1]), smooth: true, symbol: 'none',
      lineStyle: { color: PALETTE[0], width: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: PALETTE[0] }, { offset: 1, color: 'transparent' }]), opacity: .35 },
      markPoint: peaks.length ? {
        data: peaks.map(t => {
          const idx = profile.findIndex(d => d[0] === t);
          if (idx < 0) return null;
          return { coord: [idx, profile[idx][1]], value: profile[idx][1] };
        }).filter(Boolean),
        symbolSize: 42, itemStyle: { color: PALETTE[4] },
        label: { fontSize: 9, formatter: p => { const idx = p.data.coord[0]; return timeLabel(profile[idx][0]); } }
      } : null
    }]
  };
  state.modalChart.setOption(option);
}

function renderTable(rows) {
  const start = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(start, start + state.pageSize);
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  document.getElementById('tableCount').textContent = `${numberFormat(rows.length)} 条`;
  document.getElementById('pageInfo').textContent = `${state.page} / ${pages}`;
  document.getElementById('prevPage').disabled = state.page <= 1;
  document.getElementById('nextPage').disabled = state.page >= pages;
  document.getElementById('videoTable').innerHTML = pageRows.map(row => `
    <tr data-bvid="${row.bvid}" class="clickable">
      <td>${row.no}</td>
      <td class="cover-cell">${row.pic ? `<img class="cover-thumb" src="${esc(row.pic)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : '<div class="cover-empty">—</div>'}</td>
      <td class="title-cell" title="${row.title.replace(/"/g, '&quot;')}">${row.title}</td>
      <td>${row.date}</td>
      <td><span class="pill">${row.type}</span></td>
      <td><span class="pill ${row.accountShort === '主号' ? 'alt' : 'mint'}">${row.accountShort}</span></td>
      <td class="num">${numberFormat(row.sub_lines)}</td>
      <td class="num">${numberFormat(row.sub_chars)}</td>
      <td class="num">${row.view ? formatChineseNumber(row.view) : '—'}</td>
      <td class="num">${row.like ? formatChineseNumber(row.like) : '—'}</td>
      <td class="num">${row.danmaku ? formatChineseNumber(row.danmaku) : '—'}</td>
      <td class="num">${row.coin ? formatChineseNumber(row.coin) : '—'}</td>
      <td class="num">${row.favorite ? formatChineseNumber(row.favorite) : '—'}</td>
      <td><a href="https://www.bilibili.com/video/${row.bvid}" target="_blank" rel="noreferrer">前往 ↗</a></td>
    </tr>`).join('');
}

function renderAll() {
  const rows = applyFilters();
  updateStats(rows);
  const safe = (fn, name) => {
    try { fn(rows); } catch (err) { console.error(`[${name}]`, err); }
  };
  safe(renderAnnual, 'annual');
  safe(renderAccount, 'account');
  safe(renderType, 'type');
  safe(renderCumulative, 'cumulative');
  safe(renderTypeStack, 'typeStack');
  safe(renderCalendar, 'calendar');
  safe(renderMonth, 'month');
  safe(renderWeekday, 'weekday');
  safe(renderInterval, 'interval');
  safe(renderSync, 'sync');
  safe(renderSunburst, 'sunburst');
  safe(renderTreemap, 'treemap');
  safe(renderRadar, 'radar');
  safe(renderSankey, 'sankey');
  safe(renderScatter, 'scatter');
  safe(renderGraph, 'graph');
  safe(renderAlgorithmClusters, 'algorithmClusters');
  safe(renderSimilarFinder, 'similarFinder');
  safe(renderTagAffinity, 'tagAffinity');
  safe(renderKeywordEvolution, 'keywordEvolution');
  safe(renderTagCloud, 'tagCloud');
  safe(renderTop, 'top');
  safe(renderTopViews, 'topViews');
  safe(renderEngageMix, 'engageMix');
  safe(renderEngageScatter, 'engageScatter');
  safe(renderYearViews, 'yearViews');
  safe(renderTypeViews, 'typeViews');
  safe(renderDanmakuYearly, 'danmakuYearly');
  safe(renderMemes, 'memes');
  safe(renderPubClock, 'pubClock');
  safe(renderPubWeekday, 'pubWeekday');
  safe(renderCommentYear, 'commentYear');
  safe(renderCommenterRank, 'commenterRank');
  safe(renderHonorTimeline, 'honorTimeline');
  safe(renderHonorType, 'honorType');
  safe(renderDurationInsight, 'durationInsight');
  safe(renderDescInsight, 'descInsight');
  safe(renderCoverGallery, 'coverGallery');
  safe(renderFollowers, 'followers');
  safe(renderProfiles, 'profiles');
  safe(renderTable, 'table');
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('nujiuVizTheme', theme);
  document.getElementById('themeBtn').textContent = theme === 'dark' ? '☀️ 浅色' : '🌙 暗色';
  requestAnimationFrame(renderAll);
}

function bindEvents() {
  const inputs = ['#q', '#account', '#type', '#yearRange', '#sortField', '#minLines'];
  inputs.forEach(selector => {
    document.querySelector(selector).addEventListener('input', () => {
      if (selector === '#minLines') document.getElementById('minLinesLabel').textContent = document.getElementById('minLines').value;
      renderAll();
    });
    document.querySelector(selector).addEventListener('change', renderAll);
  });

  document.getElementById('quickChips').addEventListener('click', event => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#quickChips .chip').forEach(item => item.classList.remove('on'));
    chip.classList.add('on');
    renderAll();
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    document.getElementById('q').value = '';
    document.getElementById('account').value = 'all';
    document.getElementById('type').value = 'all';
    document.getElementById('yearRange').value = 'all';
    document.getElementById('minLines').value = 0;
    document.getElementById('minLinesLabel').textContent = '0';
    document.getElementById('sortField').value = 'date-desc';
    document.querySelectorAll('#quickChips .chip').forEach((chip, index) => chip.classList.toggle('on', index === 0));
    renderAll();
  });

  document.getElementById('themeBtn').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
  document.getElementById('layoutBtn').addEventListener('click', () => renderGraph(state.rowsFiltered));
  document.getElementById('similarSource').addEventListener('change', event => {
    state.similarBvid = event.target.value;
    renderSimilarFinder(state.rowsFiltered);
  });
  document.getElementById('similarList').addEventListener('click', event => {
    const item = event.target.closest('.similarity-item');
    if (item) openVideoModal(item.dataset.bvid);
  });
  document.getElementById('videoTable').addEventListener('click', event => {
    if (event.target.closest('a')) return;
    const tr = event.target.closest('tr');
    if (tr && tr.dataset.bvid) openVideoModal(tr.dataset.bvid);
  });
  document.getElementById('coverGallery').addEventListener('click', event => {
    const item = event.target.closest('.gallery-item');
    if (item) openVideoModal(item.dataset.bvid);
  });
  document.getElementById('galleryAccount').addEventListener('change', () => { galleryShown = GALLERY_PAGE_SIZE; renderCoverGallery(state.rowsFiltered); });
  document.getElementById('galleryYear').addEventListener('change', () => { galleryShown = GALLERY_PAGE_SIZE; renderCoverGallery(state.rowsFiltered); });
  document.getElementById('galleryMore').addEventListener('click', () => { galleryShown += GALLERY_PAGE_SIZE; renderCoverGallery(state.rowsFiltered); });
  document.getElementById('modalClose').addEventListener('click', closeVideoModal);
  document.getElementById('videoModal').addEventListener('click', event => {
    if (event.target === document.getElementById('videoModal')) closeVideoModal();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.getElementById('videoModal').hidden) closeVideoModal(); });
  document.getElementById('prevPage').addEventListener('click', () => { state.page--; renderTable(state.rowsFiltered); });
  document.getElementById('nextPage').addEventListener('click', () => { state.page++; renderTable(state.rowsFiltered); });
  document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    state.sort = { key, direction: state.sort.key === key && state.sort.direction === 'desc' ? 'asc' : 'desc' };
    const rows = [...state.rowsFiltered].sort((a, b) => {
      let av = a[key]; let bv = b[key];
      if (typeof av === 'string' && typeof bv === 'string') return state.sort.direction === 'asc' ? av.localeCompare(bv, 'zh-CN') : bv.localeCompare(av, 'zh-CN');
      return state.sort.direction === 'asc' ? av - bv : bv - av;
    });
    state.rowsFiltered = rows;
    state.page = 1;
    renderTable(rows);
  }));

  const topBtn = document.getElementById('topBtn');
  window.addEventListener('scroll', () => topBtn.classList.toggle('show', window.scrollY > 420));
  topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  const sections = [...document.querySelectorAll('section[id]')];
  const navLinks = [...document.querySelectorAll('#nav a')];
  const navObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const id = entry.target.id;
      navLinks.forEach(link => link.classList.toggle('active', link.hash === '#' + id));
    });
  }, { rootMargin: '-25% 0px -65% 0px' });
  sections.forEach(section => navObserver.observe(section));

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.charts.forEach(chart => chart.resize()), 120);
  });

  // 滚动显现动画
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('revealed'); revealObserver.unobserve(entry.target); } });
  }, { rootMargin: '0px 0px -40px 0px', threshold: 0.05 });
  document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
}

function animateCountUp(el, target) {
  const start = performance.now();
  const duration = 900;
  const from = Number(el.dataset.currentVal || 0);
  el.dataset.currentVal = target;
  const step = now => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatChineseNumber(Math.round(from + (target - from) * eased));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

initRows();
fillFilters();
const savedTheme = localStorage.getItem('nujiuVizTheme') || 'dark';
applyTheme(savedTheme);
bindEvents();

// ---------- Load 5 MB comment pack only when it is actually needed ----------
let commentsPromise = null;

function applyCommentsData() {
  if (typeof RAW_COMMENTS === 'undefined' || !RAW_COMMENTS) return;
  for (const row of (RAW.videos || [])) {
    if (RAW_COMMENTS[row.bvid]) row.comments = RAW_COMMENTS[row.bvid];
  }
  if (typeof state !== 'undefined' && state.rows) {
    for (const row of state.rows) {
      const src = (RAW.videos || []).find(v => v.bvid === row.bvid);
      if (src) row.comments = src.comments;
    }
  }
  if (typeof renderAll === 'function') requestAnimationFrame(renderAll);

  const modal = document.getElementById('videoModal');
  if (modal && !modal.hidden && modal.dataset.bvid) {
    openVideoModal(modal.dataset.bvid);
  }
  console.log('[Nujiu] Comments loaded: ' + Object.keys(RAW_COMMENTS).length + ' videos');
}

function ensureCommentsLoaded() {
  if (commentsPromise) return commentsPromise;
  commentsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
  script.src = 'data-comments.js?v=42';
    script.async = true;
    script.onload = () => {
      applyCommentsData();
      resolve();
    };
    script.onerror = () => {
      console.warn('[Nujiu] Comments failed to load');
      commentsPromise = null;
      reject(new Error('comments failed to load'));
    };
    document.head.appendChild(script);
  });
  return commentsPromise;
}

(function hideInitialLoader() {
  const loader = document.getElementById('appLoader');
  if (loader) { loader.style.transition = 'opacity .3s'; loader.style.opacity = '0'; setTimeout(() => loader.remove(), 350); }
})();

(function preloadCommentsNearInsights() {
  const target = document.getElementById('insights');
  if (!target) return;
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      ensureCommentsLoaded();
      observer.disconnect();
    }
  }, { rootMargin: '450px 0px' });
  observer.observe(target);
})();

/* ═══════════ 怒九百科问答 ═══════════ */
(function initQuiz() {
  const startScreen = document.getElementById('quizStart');
  const gameScreen  = document.getElementById('quizGame');
  const resultScreen = document.getElementById('quizResult');
  const startBtn    = document.getElementById('quizStartBtn');
  const nextBtn     = document.getElementById('quizNextBtn');
  const retryBtn    = document.getElementById('quizRetryBtn');
  const backBtn     = document.getElementById('quizBackBtn');
  const totalQEl    = document.getElementById('quizTotalQ');
  if (!startScreen || typeof QUIZ_DATA === 'undefined') return;
  const totalCatEl = document.getElementById('quizTotalCat');
  const categoryWrap = document.querySelector('.quiz-cat-select');

  // State
  let allQuestions = [...QUIZ_DATA];
  let pool = [];          // active question pool
  let current = 0;
  let score = 0;
  let answered = false;
  let selectedDiff = 'all';
  let selectedCat = 'all';
  const QUESTIONS_PER_ROUND = 10;

  totalQEl.textContent = allQuestions.length;
  const categories = [...new Set(allQuestions.map(q => q.category))];
  if (totalCatEl) totalCatEl.textContent = categories.length;
  if (categoryWrap) {
    categories.forEach(category => {
      const btn = document.createElement('button');
      btn.className = 'quiz-cat-btn';
      btn.dataset.cat = category;
      btn.textContent = category;
      categoryWrap.appendChild(btn);
    });
  }

  // Difficulty & category filter buttons
  document.querySelectorAll('.quiz-diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.quiz-diff-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      selectedDiff = btn.dataset.diff;
    });
  });
  document.querySelectorAll('.quiz-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.quiz-cat-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      selectedCat = btn.dataset.cat;
    });
  });

  // Start
  startBtn.addEventListener('click', () => {
    pool = allQuestions.filter(q =>
      (selectedDiff === 'all' || q.difficulty === selectedDiff) &&
      (selectedCat === 'all' || q.category === selectedCat)
    );
    // Shuffle & limit
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    pool = pool.slice(0, Math.min(QUESTIONS_PER_ROUND, pool.length));
    if (!pool.length) { alert('该筛选下没有题目'); return; }
    current = 0; score = 0;
    startScreen.style.display = 'none';
    resultScreen.style.display = 'none';
    gameScreen.style.display = 'block';
    showQuestion();
  });

  const diffLabel = { easy: '简单', medium: '中等', hard: '困难' };
  const formatLabel = { mc: '选择题', tf: '判断题' };
  const diffPoints = { easy: 1, medium: 2, hard: 3 };

  function showQuestion() {
    if (current >= pool.length) return showResult();
    const q = pool[current];
    answered = false;
    document.getElementById('quizQNum').textContent = `${current+1} / ${pool.length}`;
    document.getElementById('quizCategory').textContent = q.category;
    document.getElementById('quizDiff').textContent = diffLabel[q.difficulty] || q.difficulty;
    document.getElementById('quizFormat').textContent = formatLabel[q.format] || '选择题';
    document.getElementById('quizPoints').textContent = `${diffPoints[q.difficulty] || 1} 分`;
    document.getElementById('quizScore').innerHTML = `得分: <b>${score}</b>`;
    document.getElementById('quizQuestion').textContent = q.q;
    document.getElementById('quizExplain').style.display = 'none';
    document.getElementById('quizActions').style.display = 'none';
    // Progress bar
    const pct = ((current) / pool.length) * 100;
    document.getElementById('quizProgressFill').style.width = pct + '%';

    // Render options
    const optsEl = document.getElementById('quizOptions');
    optsEl.innerHTML = '';
    const letters = ['A','B','C','D','E'];
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      btn.innerHTML = `<span class="opt-letter">${letters[i]}</span><span>${opt}</span>`;
      btn.addEventListener('click', () => selectAnswer(i, btn));
      optsEl.appendChild(btn);
    });
  }

  function selectAnswer(idx, btnEl) {
    if (answered) return;
    answered = true;
    const q = pool[current];
    const isCorrect = idx === q.answer;
    if (isCorrect) score += q.points || diffPoints[q.difficulty] || 1;

    // Highlight
    const opts = document.querySelectorAll('.quiz-option');
    opts.forEach((opt, i) => {
      opt.disabled = true;
      if (i === q.answer) opt.classList.add('correct');
      else if (i === idx) opt.classList.add('wrong');
    });

    // Show explanation
    const explainEl = document.getElementById('quizExplain');
    explainEl.style.display = 'flex';
    document.getElementById('quizExplainText').textContent = q.explanation;
    document.getElementById('quizActions').style.display = 'flex';
    document.getElementById('quizScore').innerHTML = `得分: <b>${score}</b>`;

    nextBtn.textContent = current + 1 >= pool.length ? '查看结果 →' : '下一题 →';
  }

  nextBtn.addEventListener('click', () => {
    current++;
    showQuestion();
  });

  function showResult() {
    gameScreen.style.display = 'none';
    resultScreen.style.display = 'block';
    const maxScore = pool.reduce((sum, q) => sum + (q.points || diffPoints[q.difficulty] || 1), 0);
    const pct = Math.round((score / Math.max(1, maxScore)) * 100);
    document.getElementById('quizResultScore').textContent = score;
    document.getElementById('quizResultMax').textContent = maxScore;
    document.getElementById('quizResultTotal').textContent = pool.length;
    document.getElementById('quizResultFill').style.width = pct + '%';

    let icon, title, msg;
    if (pct >= 90)      { icon='🏆'; title='百科普级粉丝！'; msg='你对怒九的了解简直出神入化！这波是百科级别的认知！'; }
    else if (pct >= 70) { icon='🎉'; title='铁杆粉丝！'; msg='对怒九的数据了如指掌，看来你经常来百科逛！'; }
    else if (pct >= 50) { icon='😊'; title='合格粉丝'; msg='你对怒九有不错的了解，但还有很多宝藏数据等你发现！'; }
    else if (pct >= 30) { icon='🤔'; title='入门粉丝'; msg='看来你还需要多看看怒九的视频和百科数据！加油！'; }
    else                { icon='🌱'; title='新粉报道'; msg='欢迎来到怒九的世界！从看视频开始，慢慢了解他吧！'; }
    document.getElementById('quizResultIcon').textContent = icon;
    document.getElementById('quizResultTitle').textContent = title;
    document.getElementById('quizResultGrade').textContent = pct >= 90 ? 'S 级 · 百科大师' :
      pct >= 70 ? 'A 级 · 资深粉丝' : pct >= 50 ? 'B 级 · 熟悉怒九' :
      pct >= 30 ? 'C 级 · 初识怒九' : 'D 级 · 萌新驾到';
    document.getElementById('quizResultMsg').textContent = msg;
    setTimeout(() => { document.getElementById('quizResultFill').style.width = pct + '%'; }, 50);
  }

  retryBtn.addEventListener('click', () => {
    resultScreen.style.display = 'none';
    startScreen.style.display = 'block';
  });
  backBtn.addEventListener('click', () => {
    resultScreen.style.display = 'none';
    startScreen.style.display = 'block';
  });
})();

