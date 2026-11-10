"""Adapters for AstrBot events and group_chat_plus's existing group history."""
import json
from pathlib import Path
import re

from .observations import CQ, IMAGE_LABEL, QUOTE_LABEL, make_message, scalar_id

MAX_HISTORY_BYTES = 16 * 1024 * 1024
MAX_HISTORY_ROWS = 20000
PREFIX = re.compile(r"^\[[0-9]{4}-[0-9]{2}-[0-9]{2} [^\]\n]{1,40}\] [^\n]{1,80}?\(ID:([0-9]{5,15})\)(.*?)[:：]\s*", re.S)
GCP_MENTION = re.compile(r"\[At:([0-9]{5,15})\]", re.I)
ASSET = {"face": "face", "image": "image", "sticker": "sticker", "mface": "sticker"}


def get(obj, attr, default=None):
    return obj.get(attr, default) if isinstance(obj, dict) else getattr(obj, attr, default)


def chain_data(segments, bots):
    chunks, media, assets, reply, quoted, addressed = [], [], [], "", False, False
    for seg in segments[:120]:
        if isinstance(seg, dict):
            kind = str(seg.get("type", "")).lower()
            data = seg.get("data", seg)
        else:
            kind, data = type(seg).__name__.lower(), seg
        if kind in ("plain", "text"):
            value = get(data, "text", "")
            if isinstance(value, str):
                chunks.append(value[:800])
        elif kind in ("reply", "quote"):
            quoted = True
            reply = reply or scalar_id(get(data, "id") or get(data, "message_id"))
            addressed |= scalar_id(get(data, "sender_id")) in bots
        elif kind == "at":
            addressed |= scalar_id(get(data, "qq") or get(data, "id")) in bots
        elif kind in ASSET:
            style_kind = ("sticker" if kind == "image" and str(get(data, "sub_type", "")) in ("1", "emoji")
                          else ASSET[kind])
            media.append(style_kind)
            key = scalar_id(get(data, "id") if style_kind == "face" else get(data, "emoji_id") or get(data, "md5"))
            if key and style_kind in ("face", "sticker"):
                assets.append(f"{style_kind}:{key}")
    return "".join(chunks)[:800], tuple(media), reply, quoted, addressed, assets


def from_event(event, bots):
    obj = event.message_obj
    raw = getattr(obj, "raw_message", None)
    segments = raw.get("message") if isinstance(raw, dict) else None
    if not isinstance(segments, list) or not all(isinstance(x, dict) for x in segments):
        segments = event.get_messages() or []
    text, media, reply, quoted, addressed, assets = chain_data(segments, bots)
    return make_message(obj.message_id, event.get_sender_id(), obj.timestamp, text, reply,
                        quoted, media, addressed, "event", assets)


def from_gcp(row, group, bots, platform_name, platform_id=None):
    if (not isinstance(row, dict) or scalar_id(row.get("group_id")) != group
            or row.get("platform_name") != platform_name or row.get("type") not in (1, "GroupMessage")
            or scalar_id(row.get("self_id")) not in bots or row.get("is_bot") is True):
        return None
    session = row.get("session_id")
    if platform_id and isinstance(session, str) and ":GroupMessage:" in session:
        if session.split(":GroupMessage:", 1)[0] != platform_id:
            return None
    sender = get(row.get("sender"), "user_id")
    if scalar_id(sender) in bots:
        return None
    text = row.get("message_str")
    if not isinstance(text, str):
        return None
    text = text[:2400]
    reply, quoted, media, assets, addressed = scalar_id(row.get("reply_to")), False, [], [], False
    if isinstance(row.get("message"), list):
        structured, media_kinds, ref, quoted, addressed, assets = chain_data(row["message"], bots)
        text, media, reply = structured or text, list(media_kinds), ref or reply
    prefix = PREFIX.match(text)
    if prefix and prefix[1] == scalar_id(sender):
        addressed |= "[系统提示]" in prefix[2]
        text = text[prefix.end():]
    # GCP commonly flattens media and quotes. Keep a known id only when it exists.
    for tag in CQ.findall(text):
        kind, _, rest = tag[4:-1].partition(",")
        params = dict(x.split("=", 1) for x in rest.split(",") if "=" in x)
        if kind == "reply":
            quoted = True
            reply = reply or params.get("id", "")
        elif kind == "at":
            addressed |= params.get("qq") in bots
        elif kind in ASSET:
            media.append(ASSET[kind])
            if kind == "face" and params.get("id"):
                assets.append("face:" + params["id"])
    addressed |= any(mention in bots for mention in GCP_MENTION.findall(text))
    text = GCP_MENTION.sub("", text)
    for match in IMAGE_LABEL.finditer(text):
        label = match[0].lower()
        if label.startswith(("[表情:", "[face:")):
            assets.append("face:" + label.split(":", 1)[1][:-1])
            label = "[face]"
        media.append("sticker" if label in ("[表情包]", "[sticker]") else
                     "face" if label in ("[表情]", "[face]") else "image")
    quoted |= bool(QUOTE_LABEL.match(text))
    return make_message(row.get("message_id"), sender, row.get("timestamp"), text, reply,
                        quoted, media, addressed, "gcp", assets)


def read_gcp(file, group, bots, platform_name, platform_id=None):
    with Path(file).open("rb") as handle:
        data = handle.read(MAX_HISTORY_BYTES + 1)
    if len(data) > MAX_HISTORY_BYTES:
        raise ValueError("group_chat_plus history exceeds 16 MiB; use a target-group extract")
    rows = json.loads(data.decode("utf-8-sig"))
    if not isinstance(rows, list) or len(rows) > MAX_HISTORY_ROWS:
        raise ValueError("expected a group_chat_plus history JSON array of at most 20000 records")
    if rows and not any(isinstance(row, dict) and "group_id" in row and "sender" in row
                        and "message_str" in row for row in rows):
        raise ValueError("unrecognized group_chat_plus history format")
    return [m for row in rows if (m := from_gcp(row, group, bots, platform_name, platform_id))]


def read_replay(file, group, bots):
    with Path(file).open("rb") as handle:
        content = handle.read(MAX_HISTORY_BYTES + 1)
    if len(content) > MAX_HISTORY_BYTES:
        raise ValueError("target-group export exceeds 16 MiB")
    rows = []
    for line in content.decode("utf-8-sig").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if not isinstance(r, dict):
            raise ValueError("expected JSON objects in JSONL")
        if (r.get("group") != group or r.get("role") != "human"
                or scalar_id(r.get("sender")) in bots):
            continue
        media = r.get("media", [])
        if not isinstance(media, list) or not all(isinstance(x, str) for x in media):
            raise ValueError("media must be an array of media kinds")
        m = make_message(r.get("id"), r.get("sender"), r.get("ts"), r.get("text", ""),
                         r.get("reply_to", ""), r.get("quoted") is True, media,
                         r.get("addressed_to_bot") is True, "export")
        if not m:
            raise ValueError("invalid human replay record")
        rows.append(m)
    return rows
