"""Configuration and host-neutral helpers shared by the AstrBot entry and offline verifier."""
from pathlib import Path
from dataclasses import dataclass

from .observations import QQ, scalar_id
from .profile import START, END, render
from .sources import read_gcp
from .state import State

DB_NAME = "fallout76-style.sqlite3"


@dataclass(frozen=True)
class Options:
    group: str
    platform_id: str
    platform_name: str
    bots: frozenset
    history: Path | None
    directory: Path
    minimum: int
    every: int
    daily: int
    interval: int
    learn: bool
    inject: bool
    log_hook: bool

    @classmethod
    def from_config(cls, config):
        group = scalar_id(config.get("target_group"))
        platform = config.get("platform_id")
        platform_name = config.get("platform_name")
        bots = config.get("bot_ids")
        if not QQ.fullmatch(group) or not isinstance(platform, str) or not platform.strip():
            raise ValueError("configure target_group and the actual AstrBot platform_id")
        if not isinstance(platform_name, str) or not platform_name.strip():
            raise ValueError("configure the actual AstrBot platform_name")
        if (not isinstance(bots, list) or not 1 <= len(bots) <= 20
                or any(not QQ.fullmatch(scalar_id(x)) for x in bots)):
            raise ValueError("configure bot_ids, including this QQ bot")
        raw_path = config.get("style_directory")
        if not raw_path or not Path(raw_path).is_absolute() or not Path(raw_path).is_dir():
            raise ValueError("style_directory must be an existing absolute directory")
        history = config.get("gcp_history_file")
        if history:
            history = Path(history)
            if not history.is_absolute() or history.name != f"{group}.json" or history.parent.name != "group":
                raise ValueError("gcp_history_file must be the target group's absolute .../group/<group>.json")

        def number(key, default, low, high):
            result = config.get(key, default)
            if type(result) is not int or not low <= result <= high:
                raise ValueError(f"{key} must be between {low} and {high}")
            return result

        return cls(group, platform, platform_name, frozenset(map(scalar_id, bots)), history, Path(raw_path),
                   number("min_dialogue", 12, 8, 80), number("update_every", 24, 8, 120),
                   number("daily_runs", 12, 1, 48), number("interval_seconds", 90, 15, 3600),
                   config.get("learn_style", True) is True, config.get("inject_style", True) is True,
                   config.get("log_hook", False) is True)

    def matches(self, event):
        return (scalar_id(event.get_group_id()) == self.group
                and event.get_platform_id() == self.platform_id
                and event.get_platform_name() == self.platform_name
                and scalar_id(event.get_self_id()) in self.bots)

    def store(self):
        return State(self.directory / DB_NAME, self.group, self.platform_id, self.bots)


class History:
    def __init__(self, options):
        self.options = options
        self.last = None

    def refresh(self, state):
        file = self.options.history
        if not file:
            return 0
        before = file.stat()
        revision = (before.st_ino, before.st_size, before.st_mtime_ns)
        if revision == self.last:
            return 0
        rows = read_gcp(file, self.options.group, self.options.bots,
                        self.options.platform_name, self.options.platform_id)
        after = file.stat()
        if revision != (after.st_ino, after.st_size, after.st_mtime_ns):
            return 0  # source changed while being read; try again on the next tick
        if before.st_size > 3 and not rows:
            raise ValueError("history has no rows with matching group, platform, self and human IDs")
        count = state.ingest(rows)
        self.last = revision
        return count


def append_style(req, profile):
    current = req.system_prompt or ""
    if not isinstance(current, str) or START in current or END in current:
        return False
    block = render(profile)
    if not block:
        return False
    req.system_prompt = current + ("\n\n" if current else "") + block
    return True
