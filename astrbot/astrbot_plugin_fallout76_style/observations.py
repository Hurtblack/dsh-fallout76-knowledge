"""Reduce untrusted chat to a closed set of expression signals."""
from dataclasses import dataclass
import re
import unicodedata

ID = re.compile(r"[A-Za-z0-9_-]{1,96}\Z")
QQ = re.compile(r"[0-9]{5,15}\Z")
CQ = re.compile(r"\[CQ:[^\]\r\n]{1,400}\]")
MARKERS = {
    "casual": ("行", "好嘞", "可以啊", "啊", "嘛", "呗", "呢", "吧", "哈", "呀", "啦"),
    "uncertain": ("好像", "貌似", "可能", "大概", "不确定", "我记得", "没测", "没查到"),
    "ask": ("请教", "问下", "请问", "怎么", "能不能", "有没有", "行吗", "对吗", "是什么", "多少"),
    "admit": ("我说错了", "我记错了", "我搞错了", "刚才说错", "我看错了", "我弄错了", "是我错了", "我的锅"),
    "correct": ("是说", "说的是", "你说的是", "应该是", "更正", "补充一下", "改一下"),
    "ack": ("对", "嗯", "行", "好", "收到", "懂了", "明白了", "确实", "也是", "没错", "ok"),
    "play": ("哈哈", "笑死", "乐了", "传出去", "怪不得", "好家伙", "绷不住", "笑晕", "梗"),
}
TOPICS = {
    "gear": ("词条", "配装", "武器", "铁路钉", "传奇", "护甲", "装备"),
    "events": ("围剿", "公共活动", "情报箱", "矿镇", "突袭", "掉落"),
    "building": ("营地", "建造", "工坊"),
    "version": ("版本", "更新", "实测", "补丁"),
    "food": ("做饭", "美食", "咖啡", "火锅"),
    "pets": ("猫猫", "狗狗", "宠物"),
}
IMAGE_LABEL = re.compile(r"\[(?:图片|表情包|表情|image|sticker|face)(?::[0-9]{1,8})?\]", re.I)
QUOTE_LABEL = re.compile(r"^\s*[\[【](?:引用|回复|转发)[^\]】]{0,180}[\]】]")
CUE = re.compile(r"^[\s\[【]*[!！/]|(?:系统提示词|忽略.{0,6}(?:规则|指令)|<\/?(?:system|assistant)|请.{0,3}修改.{0,5}人设)", re.I)


@dataclass(frozen=True)
class Message:
    mid: str
    sender: str
    timestamp: int
    text: str = ""
    reply: str = ""
    quoted: bool = False
    media: tuple = ()
    addressed: bool = False
    source: str = "event"
    assets: tuple = ()


def scalar_id(value):
    return str(value) if isinstance(value, (str, int)) and type(value) is not bool else ""


def make_message(mid, sender, timestamp, text="", reply="", quoted=False,
                 media=(), addressed=False, source="event", assets=()):
    mid, sender, reply = map(scalar_id, (mid, sender, reply))
    if not ID.fullmatch(mid) or not QQ.fullmatch(sender):
        return None
    try:
        ts = int(float(timestamp))
    except (OverflowError, TypeError, ValueError):
        return None
    if not 0 < ts < 4102444800 or not isinstance(text, str):
        return None
    text = unicodedata.normalize("NFKC", text[:800]).strip()
    if not ID.fullmatch(reply) or mid == reply:
        reply = ""
    media = tuple(sorted(set(x for x in media if x in ("face", "sticker", "image"))))
    if not text and not media:
        return None
    assets = tuple(sorted({a for a in assets if re.fullmatch(r"(?:face|sticker):[A-Za-z0-9_-]{1,120}", a)}))[:8]
    return Message(mid, sender, ts, text, reply, quoted or bool(reply), media, addressed, source, assets)


def cleaned_text(text):
    return CQ.sub("", IMAGE_LABEL.sub("", QUOTE_LABEL.sub("", text, count=1))).strip()


def features(message):
    if message.addressed or CUE.search(message.text):
        return None
    text = cleaned_text(message.text).lower()
    plain = text.strip(" 。.!！?？~～…，,、")
    if not plain and not message.media:
        return None
    flags = []
    for key, choices in MARKERS.items():
        matched = (
            plain in choices if key == "ack" else
            plain.endswith(choices) if key == "casual" else
            any(token in plain for token in choices)
        )
        if matched or (key == "ask" and text.endswith("?")):
            flags.append(key)
    if re.search(r"[。！？.!?~…]{2,}$", text):
        flags.append("expressive")
    if text and text[-1] not in ".!?。！？~…":
        flags.append("no_period")
    return {
        "length": len(re.sub(r"\s", "", plain)),
        "flags": flags,
        "topics": [key for key, words in TOPICS.items() if any(word in plain for word in words)],
        "media": list(message.media),
    }
