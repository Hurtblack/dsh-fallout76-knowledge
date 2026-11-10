"""Offline request verifier for compatible group_chat_plus sources; uses no host or network."""
import argparse
import ast
import asyncio
from contextlib import contextmanager
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import re
import sys
from types import ModuleType, SimpleNamespace as NS
from unittest.mock import patch

from .adapter import Options, append_style
from .profile import END, START

FIXED = "固定身份：大肥鱼。主人识别、隐私、权限和知识核验使用原规则。"
MEMORY = "既有记忆：独立测试标记。"
STATIC = "既有群聊回复规则：独立测试标记。"
QUESTION = "四星暴怒怎么查？"
FULL = "既有群聊历史：独立测试标记。\n" + QUESTION


@contextmanager
def gcp_hook(root):
    main, reply = root / "main.py", root / "utils" / "reply_handler.py"
    rewriter = root / "utils" / "system_prompt_rewriter.py"
    main_bytes = main.read_bytes()
    tree = ast.parse(main_bytes)
    group = next((c for c in tree.body if isinstance(c, ast.ClassDef)
                  and any(isinstance(n, ast.AsyncFunctionDef) and n.name == "on_llm_request" for n in c.body)), None)
    if not group:
        raise ValueError("installed GCP has no compatible on_llm_request hook")
    selected = [n for n in group.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                and n.name in ("on_llm_request", "_snapshot_request_before_rewrite")]
    if len(selected) != 2:
        raise ValueError("installed GCP hook layout differs; inspect actual files")
    for n in selected:
        n.decorator_list = [d for d in n.decorator_list if isinstance(d, ast.Name) and d.id == "staticmethod"]
    klass = ast.ClassDef(name="ProbeGCP", bases=[], keywords=[], body=selected, decorator_list=[])
    ast.fix_missing_locations(klass)

    reply_attrs = {}
    for node in ast.parse(reply.read_bytes()).body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            for key in node.targets:
                if isinstance(key, ast.Name) and key.id.startswith("PLUGIN_"):
                    reply_attrs[key.id] = node.value.value

    # The two actual GCP methods and its rewriter run; unrelated host capabilities
    # (compliance UI, Skills, tools) are replaced with local empty fixtures.
    spec = importlib.util.spec_from_file_location("_f76_gcp_rewriter", rewriter)
    module = importlib.util.module_from_spec(spec)
    stubs = {spec.name: module}
    for name, attrs in {
        "_f76_gcp.utils.reply_handler": reply_attrs,
        "_f76_gcp.utils.tools_reminder": {
            "ToolsReminder": NS(_extract_tools_from_container=lambda tools: [])},
        "astrbot.core.skills.skill_manager": {
            "SkillManager": lambda: NS(list_skills=lambda **_: []), "build_skills_prompt": lambda _: ""},
    }.items():
        obj = ModuleType(name)
        obj.__dict__.update(attrs)
        stubs[name] = obj

    logger = NS(info=lambda *_a, **_k: None, warning=lambda *_a, **_k: None,
                error=lambda *_a, **_k: None)
    with patch.dict(sys.modules, stubs):
        spec.loader.exec_module(module)
        env = {"__name__": "_f76_gcp.main", "__package__": "_f76_gcp",
               "SystemPromptRewriter": module.SystemPromptRewriter, "logger": logger,
               "AstrMessageEvent": object, "ProviderRequest": object}
        exec(compile(ast.Module(body=[klass], type_ignores=[]), str(main), "exec"), env)
        hook = env["ProbeGCP"]()
        hook.debug_mode = False
        hook._check_compliance_status = lambda: None
        hook._merge_per_plugin_prompt = lambda p, _: p
        hook._merge_per_plugin_contexts = lambda c, _: c
        yield hook.on_llm_request, reply_attrs, sha256(main_bytes).hexdigest()


def wire_message(req, astrbot_root=None):
    messages = []
    if astrbot_root:
        path = astrbot_root / "astrbot/core/agent/runners/tool_loop_agent_runner.py"
        tree = ast.parse(path.read_bytes())
        node = next((n for n in ast.walk(tree) if isinstance(n, ast.If)
                     and ast.unparse(n.test) == "request.system_prompt"
                     and "Message(role='system', content=request.system_prompt)" in ast.unparse(n)), None)
        if node is None:
            raise ValueError("AstrBot provider message builder has changed")
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"),
             {"request": req, "messages": messages, "Message": lambda **kwargs: kwargs})
    elif req.system_prompt:
        messages.append({"role": "system", "content": req.system_prompt})
    return messages[0]["content"] if messages else ""


async def verify(root, profile, version, astrbot_root=None):
    with gcp_hook(root) as (hook, keys, fingerprint):
        async def generate(evolved):
            extras = {
                keys["PLUGIN_REQUEST_MARKER"]: True,
                keys["PLUGIN_CUSTOM_CONTEXTS"]: [{"role": "user", "content": "现有群上下文"}],
                keys["PLUGIN_CUSTOM_SYSTEM_PROMPT"]: FIXED,
                keys["PLUGIN_CUSTOM_PROMPT"]: FULL,
                keys["PLUGIN_CURRENT_MESSAGE"]: QUESTION,
                keys["PLUGIN_CUSTOM_STATIC_INSTRUCTIONS"]: STATIC,
                "_gcp_per_plugin_injections": {"fixture": {"system_prompt_added": MEMORY}},
            }
            event = NS(get_extra=lambda k, d=None: extras.get(k, d), set_extra=extras.__setitem__)
            req = NS(system_prompt=FIXED + "\n\n" + MEMORY, prompt=QUESTION, contexts=[],
                     image_urls=[], audio_urls=[], func_tool=None)
            if evolved:
                if not append_style(req, profile):
                    raise ValueError("the selected version has no style block")
            await hook(event, req)
            if req.prompt != FULL or req.contexts != [{"role": "user", "content": "现有群上下文"}]:
                raise ValueError("GCP did not restore the regular reply request")
            return wire_message(req, astrbot_root)
        before, after = await generate(False), await generate(True)
    if after.count(START) != 1 or after.count(END) != 1:
        raise ValueError("final system message does not contain exactly one style block")
    left, marker, right = after.partition(START)
    learned, _, rest = right.partition(END)
    removed = re.sub(r"\n{2,}", "\n\n", left + rest).strip()
    if removed != re.sub(r"\n{2,}", "\n\n", before).strip():
        raise ValueError("non-style system message changed")
    if not all(value in after for value in (FIXED, MEMORY, STATIC)):
        raise ValueError("fixed prompt, existing memory or GCP instructions did not survive")
    return {"version": version, "gcp_main_sha256": fingerprint, "ast_astrbot_serializer": bool(astrbot_root),
            "before_count": before.count(START), "after_count": after.count(START),
            "other_system_content_preserved": True, "style_chars": len(marker + learned + END),
            "style_block": marker + learned + END, "provider_network_calls": 0, "qq_sends": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--gcp", type=Path, required=True, help="local installed group_chat_plus directory")
    parser.add_argument("--astrbot-source", type=Path, help="optional local AstrBot checkout for provider serializer")
    args = parser.parse_args()
    opt = Options.from_config(json.loads(args.config.read_text(encoding="utf-8-sig")))
    version, profile = opt.store().active()
    try:
        print(json.dumps(asyncio.run(verify(args.gcp, profile, version, args.astrbot_source)),
                         ensure_ascii=False, indent=2))
    except (OSError, SyntaxError, ValueError, ImportError, KeyError, AttributeError) as exc:
        parser.exit(2, f"Offline chain verification failed: {exc}\n")


if __name__ == "__main__":
    main()
