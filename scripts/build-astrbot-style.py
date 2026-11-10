"""Create the installable AstrBot ZIP without chats, state, or dependencies."""
import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
NAME = "astrbot_plugin_fallout76_style"
PLUGIN = ROOT / "astrbot" / NAME
LOCAL = ("__init__.py", "_conf_schema.json", "adapter.py", "main.py", "manage_style.py",
         "metadata.yaml", "observations.py", "profile.py", "README.md", "sources.py",
         "state.py", "verify_chain.py")
SHARED = ("LICENSE", "NOTICE", "docs/WINDOWS-ASTRBOT-STYLE.md", "docs/STYLE-REPLAY.md")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    out = parser.parse_args().output
    files = [PLUGIN / n for n in LOCAL] + [ROOT / n for n in SHARED]
    out.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(out, "w", compression=ZIP_DEFLATED) as archive:
        for src in sorted(files, key=lambda p: p.name):
            member = ZipInfo(NAME + "/" + src.name, date_time=(2026, 11, 10, 0, 0, 0))
            member.compress_type = ZIP_DEFLATED
            member.external_attr = 0o100644 << 16
            archive.writestr(member, src.read_bytes())


if __name__ == "__main__":
    main()
