"""Offline state management: python -m astrbot_plugin_fallout76_style.manage_style."""
import argparse
import json
from pathlib import Path

from .adapter import History, Options
from .profile import render
from .sources import read_replay


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True, help="AstrBot plugin config JSON")
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("status")
    sub.add_parser("prompt")
    hist = sub.add_parser("history")
    hist.add_argument("--limit", type=int, choices=range(1, 51), default=5)
    roll = sub.add_parser("rollback")
    roll.add_argument("version", type=int)
    sub.add_parser("resume")
    sub.add_parser("evaluate")
    sub.add_parser("import-gcp")
    imp = sub.add_parser("import-replay")
    imp.add_argument("file", type=Path)
    args = parser.parse_args()
    try:
        opt = Options.from_config(json.loads(args.config.read_text(encoding="utf-8-sig")))
        state = opt.store()
        if args.action == "status":
            result = state.status() if state.path.exists() else {"samples": 0, "version": 0, "profile": {}}
        elif args.action == "prompt":
            print(render(state.active()[1]))
            return
        elif args.action == "history":
            result = state.history(args.limit) if state.path.exists() else []
        elif args.action == "rollback":
            result = {"version": state.rollback(args.version), "paused": True}
        elif args.action == "resume":
            state.resume()
            result = {"paused": False}
        elif args.action == "evaluate":
            outcome, version = state.evolve(opt.minimum, opt.every, opt.daily)
            result = {"outcome": outcome, "version": version}
        else:
            count = (History(opt).refresh(state) if args.action == "import-gcp"
                     else state.ingest(read_replay(args.file, opt.group, opt.bots)))
            result = {"imported": count}
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, TypeError, OSError) as exc:
        parser.exit(2, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
