# -*- coding: utf-8 -*-
from __future__ import annotations
import json, re, shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
REG=ROOT/'registry.json'
META=ROOT/'tools/bili_meta_cache.json'
TAGS=ROOT/'tools/bili_tags_cache.json'
TID_NAMES=ROOT/'tools/bili_tid_names.json'

GAME_WORDS=[
 '游戏实况','游戏介绍','游戏试玩','游戏攻略','游戏相关','游戏','实况','试玩','独立游戏','电子竞技','单机游戏',
 'switch','steam','NS','3DS','splatoon','星之卡比','旷野之息','塞尔达','动物森友会','动物森','岛上',
 'overcooked','celeste','ori','undertale','dead cells','cooking simulator','untitled goose game',
 'gonner','a dark room','party','派对','音游','音乐游戏','米老鼠','迪士尼','律师函','QWOP','FC','nes','fc'
]
MUSIC_WORDS=[
 '翻唱','合唱','唱歌','演唱','音乐','原创','演奏','vocaloid','utau','音乐游戏','音游','音乐现场',
 'mv','acg','vocal','utau','utaite','音乐相关','原创音乐','歌曲'
]
RADIO_WORDS=['爆炸电台','爆米花电台','电台','radio','radio节目','爆炸电台节目']
LIVE_WORDS=['直播录像','直播','live','Live','LIVE']
PAINT_WORDS=['绘画','画画','手绘','手书','动画','画','MAD','AMV','MMD','绘画过程','手绘过程']
DUB_WORDS=['配音','中文配音','小剧场','短片','小短剧','短剧','短片·手书·配音']
FUNNY_WORDS=['搞笑','沙雕','娱乐','鬼畜','爆笑','有趣','整活']
KNOW_WORDS=['学习','科普','科学','高考','中考','励志','教育','知识','学习方法','考试','学习计划']
LIFE_WORDS=['日常','生活','vlog','Vlog','种田','做饭','旅行','老家','美食','料理','生活日常','沙雕日常',
 '纪录','纪录日常','生活记录','岛上生活','岛上','岛上日常','岛上纪录','岛上','岛上日常','岛上纪录']

def norm(s):
    return (s or '').replace('\\n',' ').lower()

def hit(text, words):
    for w in words:
        if w.lower() in text:
            return w
    return None

def classify(title, desc, tags, tid):
    text=norm(title)+'\n'+norm(desc)
    tagtext=' '.join(norm(t.get('name')) for t in tags)
    full=text+'\n'+tagtext
    if hit(full,RADIO_WORDS): return '爆炸电台'
    if hit(full,LIVE_WORDS): return '直播录像'
    if hit(full,GAME_WORDS): return '游戏实况'
    if hit(full,MUSIC_WORDS): return '翻唱/音乐'
    if hit(full,KNOW_WORDS): return '知识科普'
    if hit(full,PAINT_WORDS) and hit(full,DUB_WORDS): return '配音/小剧场'
    if hit(full,PAINT_WORDS): return '绘画/手书'
    if hit(full,DUB_WORDS): return '配音/小剧场'
    if hit(full,FUNNY_WORDS): return '搞笑娱乐'
    if hit(full,LIFE_WORDS): return '生活日常'
    if tid in {17,172,65,230,126}: return '游戏实况'
    if tid in {31,28,30,59}: return '翻唱/音乐'
    if tid in {47,162,161,136}: return '绘画/手书'
    if tid in {21,76,222,228,229,250,257,251}: return '生活日常'
    if tid == 138: return '搞笑娱乐'
    if tid == 174: return '直播录像'
    if tid == 27: return '影视/综艺'
    return '其他'

def main():
    shutil.copy2(REG, REG.with_suffix('.json.bak'))
    reg=json.loads(REG.read_text(encoding='utf-8'))
    meta=json.loads(META.read_text(encoding='utf-8'))
    tags=json.loads(TAGS.read_text(encoding='utf-8'))
    changed=0
    for row in reg.get('videos',[]):
        bvid=row.get('bvid')
        info=meta.get(bvid) or {}
        taglist=tags.get(bvid) or []
        tid=info.get('tid')
        new=classify(row.get('title',''), info.get('desc',''), taglist, tid)
        old=row.get('type') or ''
        if old != '其他' and new == '其他':
            new=old
        if new != old:
            row['type']=new
            changed += 1
    REG.write_text(json.dumps(reg,ensure_ascii=False,indent=2),encoding='utf-8')
    print('changed',changed,'total',len(reg.get('videos',[])))
if __name__=='__main__':
    main()
