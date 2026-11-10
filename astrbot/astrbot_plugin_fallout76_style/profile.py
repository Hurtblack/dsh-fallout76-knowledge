"""Conservative aggregate learning and a fixed vocabulary for prompt rendering."""
from collections import Counter, defaultdict, deque
from statistics import median

START, END = "<fallout76_group_style>", "</fallout76_group_style>"
MODES = {
    "length": {
        "brief": "平常先用短句讲重点，复杂机制再分句解释。",
        "balanced": "普通话题先说结论，需要时再用两三句说明。",
        "detail": "需要解释时用完整短段，普通接话依然可以简短。",
    },
    "tone": {"casual": "日常语气轻松，可自然用「对」「行」「好像」一类接话。"},
    "punctuation": {"loose": "随口接话可少用句号，信息较多时正常分句。"},
    "banter": {"follow": "熟悉的轻松话题可以接一小句梗，别挤占正经答案。"},
    "questions": {"direct": "没听明白就问一个具体问题，先确认对方指哪项。"},
    "corrections": {"own": "说错了就简短承认，紧接着给出更正；还没核实就直说。"},
    "uncertainty": {"mark": "没把握时直说不确定，措辞不代替查证。"},
    "reaction_scene": {
        "banter": "表情反应主要放在接梗时。",
        "ack": "表情反应主要放在轻松的短接话里。",
    },
    "reaction": {
        "face": "轻松回合可以偶尔用一个表情反应。",
        "sticker": "轻松回合才考虑表情包式反应；不编造素材或链接。",
        "image": "见到群友用图片接话时，可以简短接住，不推断没看见的图内容。",
    },
}
INTERESTS = {
    "gear": "武器与配装", "events": "公共活动与挑战", "building": "营地建造",
    "version": "版本与实测", "food": "美食", "pets": "宠物",
}
RULE = "只调整表达和闲聊关注点；身份、主人识别、隐私、权限及知识核验仍按原有规则。"
MAX_BLOCK = 460


def validated(value):
    if not isinstance(value, dict) or set(value) - (set(MODES) | {"interests"}):
        raise ValueError("invalid profile keys")
    for key, item in value.items():
        if key == "interests":
            if (not isinstance(item, list) or not 1 <= len(item) <= 2 or
                    any(not isinstance(x, str) or x not in INTERESTS for x in item) or
                    len(set(item)) != len(item)):
                raise ValueError("invalid interest list")
        elif not isinstance(item, str) or item not in MODES[key]:
            raise ValueError("invalid profile value")
    return value


def render(value):
    validated(value)
    if "reaction_scene" in value and "reaction" not in value:
        raise ValueError("reaction context requires a reaction")
    if not value:
        return ""
    lines = [START, RULE]
    lines.extend(choices[value[key]] for key, choices in MODES.items() if key in value)
    if value.get("interests"):
        lines.append("闲聊可优先响应：" + "、".join(INTERESTS[x] for x in value["interests"]) + "。")
    lines.append(END)
    block = "\n".join(lines)
    if len(block) > MAX_BLOCK:
        raise ValueError("style prompt too long")
    return block


def relate(rows, anchors=None):
    # The source may have omitted the reply target. Never infer one for an explicit quote.
    by_id = dict(anchors or {})
    recent = deque()
    result = []
    for row in rows:
        while recent and recent[0]["ts"] < row["ts"] - 180:
            recent.popleft()
        explicit = row["quoted"]
        prior = by_id.get(row["reply"]) if explicit else next(
            (r for r in reversed(recent) if r["speaker"] != row["speaker"]), None
        )
        if prior and prior["speaker"] != row["speaker"] and prior["ts"] <= row["ts"]:
            scene = set(row["f"]["flags"]) | set(prior.get("f", {}).get("flags", []))
            result.append((row, prior["mid"], "reply" if explicit else "nearby", scene))
        by_id[row["mid"]] = row
        recent.append(row)
    return result


def learn(rows, minimum, anchors=None):
    # Limit how much one prolific participant can steer a rolling profile.
    quota, linked = Counter(), []
    for entry in reversed(relate(rows, anchors)):
        speaker = entry[0]["speaker"]
        if quota[speaker] < 36:
            linked.append(entry)
            quota[speaker] += 1
    linked.reverse()
    if len(linked) < minimum or len(quota) < 3:
        return None
    lengths = [r["f"]["length"] for r, _, _, _ in linked if r["f"]["length"] > 0]
    if len(lengths) < minimum // 2:
        return None
    profile = {}
    center = median(lengths)
    profile["length"] = "brief" if center <= 12 else "balanced" if center <= 27 else "detail"
    signals, speakers = Counter(), defaultdict(set)
    for r, _, _, _ in linked:
        for signal in r["f"]["flags"] + r["f"]["topics"] + r["f"]["media"]:
            signals[signal] += 1
            speakers[signal].add(r["speaker"])

    def enough(key, floor=2, ratio=0):
        return signals[key] >= max(floor, ratio * len(linked)) and len(speakers[key]) >= 2

    for signal, field, choice, ratio in (
        ("casual", "tone", "casual", .12), ("no_period", "punctuation", "loose", .62),
        ("play", "banter", "follow", .07), ("ask", "questions", "direct", .08),
        ("uncertain", "uncertainty", "mark", .07),
    ):
        if enough(signal, ratio=ratio) or (field == "tone" and enough("ack", ratio=.16)):
            profile[field] = choice
    if enough("admit") or (enough("correct") and signals["admit"] >= 1):
        profile["corrections"] = "own"
    reactions = [x for x in ("sticker", "face", "image") if enough(x, ratio=.04)]
    if reactions:
        reaction = max(reactions, key=lambda x: signals[x])
        profile["reaction"] = reaction
        for scene, signal in (("banter", "play"), ("ack", "ack")):
            authors = {r["speaker"] for r, _, _, context in linked
                       if reaction in r["f"]["media"] and signal in context}
            if len(authors) >= 2:
                profile["reaction_scene"] = scene
                break
    topics = sorted((x for x in INTERESTS if enough(x, 3, .08)), key=lambda x: (-signals[x], x))
    if topics:
        profile["interests"] = topics[:2]
    render(profile)
    sources = [{"id": r["mid"], "time": r["ts"], "via": r["source"],
                "context": context, "relation": kind,
                **({"media": r["f"]["media"], "asset_keys": r["f"].get("assets", [])} if r["f"]["media"] else {})}
               for r, context, kind, _ in linked]
    return profile, sources
