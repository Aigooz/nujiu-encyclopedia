# -*- coding: utf-8 -*-
"""字幕启发式分析：生成百科词条所需的各区块内容。"""
import re
from collections import Counter

TOPIC_MAP = {
    '音乐': ['歌', '唱', '曲', '音乐', '旋律', '副歌', '编曲', '伴奏', '翻唱', '原创', '录音', '高音', '音准', '节奏', '调'],
    '游戏': ['游戏', '实况', '关卡', 'boss', '血量', '存档', '地图', '角色', '装备', '道具', '操作', '手残', '通关', 'steam', 'switch', '塞尔达', '马力欧', 'splatoon'],
    '恐怖': ['恐怖', '吓', '鬼', '惊悚', '可怕', '阴森', '诡异', '尖叫', '细思极恐'],
    '美食': ['吃', '好吃', '美食', '饿', '饭', '菜', '肉', '火锅', '烧烤', '零食', '甜', '辣', '味道', '汉堡', '拉面', '奶茶'],
    '日常生活': ['今天', '昨天', '明天', '学校', '上课', '作业', '考试', '家', '妈', '爸', '妹妹', '姐姐', '睡觉', '起床', '洗澡', '出门', '快递'],
    '童年/回忆': ['小时候', '初中', '高中', '以前', '当年', '童年', '回忆', '那时候', '曾经', '小学'],
    '故事/叙事': ['故事', '传说', '从前', '结局', '剧情', '主角', '开头', '情节', '讲述'],
    '社交/合作': ['朋友', '一起', '我们', '大家', '合作', '队友', '同学', '聊天'],
    '情感': ['喜欢', '爱', '开心', '难过', '感动', '哭', '笑', '伤心', '生气', '委屈', '孤独'],
    '绘画/创作': ['画', '画了', '手书', '投稿', '制作', '素材', '剪辑', '视频', '动画', '渲染', '软件'],
    '学习/知识': ['学习', '知识', '生物', '数学', '英语', '语文', '教材', '课本', '考试', '复习'],
    '直播互动': ['直播', '弹幕', '观众', '礼物', '舰长', '连麦', '提问', '评论'],
}
CATCH_PHRASES = [
    ('诶', r'诶'), ('哇', r'哇'), ('啊啊啊', r'啊啊啊+'), ('哈哈哈', r'哈{3,}'),
    ('噫', r'噫'), ('拜拜', r'拜拜'), ('优雅', r'优雅'), ('心灵鸡汤', r'心灵鸡汤'),
    ('我真棒', r'我真棒'), ('我太棒了', r'我太?棒了'), ('炸了', r'炸了'), ('我的天', r'我的天'),
    ('嘿嘿', r'嘿{2,}'), ('怎么办', r'怎么办'), ('完了', r'完了'), ('芜湖', r'芜?湖'),
    ('nia', r'[Nn]ia'), ('好耶', r'好耶'), ('离谱', r'离谱'), ('救命', r'救命'),
]
FEAR_WORDS = ['怕', '吓', '恐怖', '鬼', '惊悚', '诡异', '毛骨悚然', '细思极恐']
PRAISE_WORDS = ['厉害', '棒', '优秀', '牛', '天才', '完美', '满分']
THANK_WORDS = ['谢谢', '感谢', '多谢']
EMOTION_WORDS = ['喜欢', '开心', '感动', '难过', '伤心', '生气', '委屈', '孤独', '哭', '幸福']
INTERACT_WORDS = ['弹幕', '观众', '大家', '关注', '三连', '点赞', '投币', '评论', '私信', '留言']
INTRO_PATTERNS = [r'我是怒九笑', r'我是怒九摸鱼馆', r'我是怒九', r'我叫怒九笑', r'我叫怒九摸鱼馆', r'我叫怒九', r'这里是怒九笑', r'这里是怒九摸鱼馆', r'这里是怒九']

def _count(text, words):
    if isinstance(words, str):
        return len(re.findall(words, text))
    return sum(text.count(w) for w in words)

def detect_topics(text):
    scores = {}
    low = text.lower()
    for cat, kws in TOPIC_MAP.items():
        c = _count(low, kws)
        if c > 0:
            scores[cat] = c
    return sorted(scores.items(), key=lambda x: -x[1])

def detect_catchphrases(text):
    out = []
    for name, pat in CATCH_PHRASES:
        n = len(re.findall(pat, text))
        if n > 0:
            out.append((name, n))
    return sorted(out, key=lambda x: -x[1])[:8]

def split_sentences(text):
    return [s for s in re.split(r'[。！？!?；;\n]', text) if len(s.strip()) >= 4]

def make_summary(sents, topics):
    if not sents:
        return '（无字幕内容）'
    if not sents:
        return text[:150]
    topic_kws = [k for cat, _ in topics[:3] for k in TOPIC_MAP.get(cat, [])]
    def score(s):
        low = s.lower()
        return sum(low.count(k) for k in topic_kws) + min(len(s), 40) / 40.0
    ranked = sorted(range(len(sents)), key=lambda i: -score(sents[i]))
    keep = sorted(ranked[:3])
    picked = []
    total = 0
    for i in keep:
        s = sents[i].strip()
        if total + len(s) > 170:
            break
        picked.append(s)
        total += len(s)
    if not picked:
        picked = [sents[0][:120]]
    return '。'.join(picked) + ('。' if not picked[-1].endswith('。') else '')

def make_highlights(sents, topics):
    topic_kws = [k for cat, _ in topics[:4] for k in TOPIC_MAP.get(cat, [])]
    out = []
    for s in sorted(set(sents), key=len, reverse=True):
        s = s.strip()
        if not (8 <= len(s) <= 42):
            continue
        if any(s in o for o in out):
            continue
        low = s.lower()
        if '哈哈' in s or '啊啊' in s:
            tag = '搞笑'
        elif any(k in low for k in ['游戏', '关卡', 'boss', 'steam', 'switch', '塞尔达', '马力欧']):
            tag = '游戏相关'
        elif any(k in low for k in ['歌', '唱', '曲', '音乐']):
            tag = '音乐相关'
        elif any(k in low for k in FEAR_WORDS):
            tag = '恐怖相关'
        elif any(k in low for k in INTERACT_WORDS):
            tag = '互动'
        elif any(k in low for k in EMOTION_WORDS):
            tag = '情感表达'
        elif any(k in low for k in topic_kws):
            tag = topics[0][0] if topics else '内容'
        else:
            continue
        out.append(f'{s} [{tag}]')
        if len(out) >= 5:
            break
    return out

def atmosphere(text):
    laugh = len(re.findall(r'哈{2,}|嘿{2,}|嘻{2,}', text))
    exclaim = text.count('！') + text.count('!')
    wonder = _count(text, ['哇', '天哪', '天啊', '我靠', '卧槽', '好家伙', '惊']) + len(re.findall(r'啊{3,}', text))
    question = text.count('？') + text.count('?')
    fear = _count(text, FEAR_WORDS)
    praise = _count(text, PRAISE_WORDS)
    thanks = _count(text, THANK_WORDS)
    emotion = _count(text, EMOTION_WORDS)
    m = []
    if laugh >= 3: m.append('搞笑欢乐')
    if fear >= 3: m.append('紧张惊叫')
    if wonder >= 8: m.append('惊奇赞叹')
    if emotion >= 5: m.append('感性抒情')
    if thanks >= 2: m.append('感恩温情')
    if question >= 10: m.append('好奇探索')
    if not m: m = ['平实叙述']
    ind = []
    if exclaim: ind.append(f'感叹{exclaim}次')
    if laugh: ind.append(f'笑声{laugh}次')
    if wonder: ind.append(f'惊叹词{wonder}个')
    if question: ind.append(f'疑问{question}次')
    if fear: ind.append(f'恐惧相关词{fear}次')
    if praise: ind.append(f'赞美词{praise}次')
    if thanks: ind.append(f'致谢{thanks}次')
    if emotion: ind.append(f'情感词{emotion}次')
    total = laugh + exclaim + wonder + question + fear
    stars = 2 + min(3, total // max(20, len(text) // 200))
    stars = max(1, min(5, stars))
    return ('整体氛围：' + '、'.join(m[:3]), '情绪指标：' + ('、'.join(ind) if ind else '无明显情绪波动'),
            '能量等级：' + '★' * stars + '☆' * (5 - stars))

def language_features(text, n_lines):
    n_chars = len(re.sub(r'\s', '', text))
    avg = round(n_chars / max(1, n_lines))
    style = '短句碎语多，反应迅速' if avg <= 8 else ('短句为主，节奏明快' if avg <= 12 else '叙述性长句，语速平缓')
    intros = sum(len(re.findall(p, text)) for p in INTRO_PATTERNS)
    inter = _count(text, INTERACT_WORDS)
    feats = [f'字数{n_chars}字，{n_lines}个语段，平均每段{avg}字', f'语言风格：{style}']
    if intros:
        feats.append(f'自我介绍{intros}次')
    if inter:
        feats.append(f'与观众互动{inter}次')
    # 高频用语
    counter = Counter()
    for name, pat in CATCH_PHRASES:
        n = len(re.findall(pat, text))
        if n >= 2:
            counter[name] = n
    top = counter.most_common(5)
    if top:
        feats.append('高频用语：' + '、'.join(f'「{n}」{c}次' for n, c in top))
    extra = '；'.join(feats[1:])
    return f'字数{n_chars}字，{n_lines}个语段，平均每段{avg}字\n' + extra

def merge_lines(lines, width=60):
    """把字幕行合并为段落（与原百科的“合并为N段”一致）。"""
    paras, buf, size = [], [], 0
    for l in lines:
        buf.append(l)
        size += len(l)
        if size >= width:
            paras.append(''.join(buf))
            buf, size = [], 0
    if buf:
        paras.append(''.join(buf))
    return paras

def analyze(title, lines, desc=''):
    text = ''.join(lines)
    topics = detect_topics(text)
    topic_str = '、'.join(f'{c}({n}次)' for c, n in topics[:6]) if topics else '（关键词不明显）'
    catch = detect_catchphrases(text)
    catch_str = '、'.join(f'「{n}」×{c}' for n, c in catch) if catch else None
    sents = [l.strip() for l in lines if len(l.strip()) >= 4] or split_sentences(text)
    summary = make_summary(sents, topics)
    highlights = make_highlights(sents, topics)
    atmo = atmosphere(text)
    lang = language_features(text, len(lines))
    intro_count = sum(len(re.findall(p, text)) for p in INTRO_PATTERNS)
    reading = None
    if re.search(r'我是怒九笑|我叫怒九笑|这里是怒九笑', text):
        reading = '怒九笑'
    elif re.search(r'我是怒九摸鱼馆|我叫怒九摸鱼馆|这里是怒九摸鱼馆', text):
        reading = '怒九摸鱼馆'
    elif re.search(r'我是怒九|我叫怒九|这里是怒九', text):
        reading = '怒九'
    return {'topic_str': topic_str, 'catch_str': catch_str, 'summary': summary,
            'highlights': highlights, 'atmo': atmo, 'lang': lang,
            'intro_count': intro_count, 'reading': reading, 'merged': merge_lines(lines)}

