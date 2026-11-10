# Windows：辐射76群聊风格 v0.4.0

Windows 的 QQ 回复由 AstrBot + group_chat_plus 负责时，请安装 **AstrBot 插件 ZIP**：`astrbot_plugin_fallout76_style-0.4.0.zip`。这是辐射76项目的 AstrBot 原生组件。DSH 的 `.tgz`、知识库、设置和学习任务继续使用原版本，不用迁移到 AstrBot。ZIP 不安装或替换 group_chat_plus、LivingMemory、NapCat 或沙箱。

本次验证了上游 group_chat_plus `V1.2.3.hotfix.2`（[提交 aa97e0e](https://github.com/Him666233/astrbot_plugin_group_chat_plus/commit/aa97e0e35a18733e73db753238dd2a3021446e42)）的普通群回复钩子，以及 [AstrBot](https://github.com/AstrBotDevs/AstrBot/commit/faba6c02d2e385befb04afadc8023372fe63971a) 原生 runner 的系统消息组装。AstrBot 插件声明要求 **AstrBot ≥4.11.0**；这是最低接口版本，不代表每个版本或私有改版都已验证。实际 Windows 版本、安装路径、群历史格式和最后的发送控制须在目标机确认。

## 备份和安装

1. 记录当前 AstrBot 版本、group_chat_plus 版本、QQ 平台实例 ID 和群发送限制。维持原来的群发送、主动对话及被动触发回复策略。停止宿主后备份现有插件配置、现有人设、group_chat_plus 数据、LivingMemory 数据，以及 DSH 配置和知识目录；如有旧风格库，备份整个独立风格目录。不要将旧库覆盖成 starter JSON，不需要更改任何既有人设。
2. 将 ZIP 和 `SHA256SUMS.txt` 放在同一目录，核对哈希：
   ```powershell
   Get-FileHash -Algorithm SHA256 .\astrbot_plugin_fallout76_style-0.4.0.zip
   Get-Content .\SHA256SUMS.txt
   ```
3. 在 AstrBot 插件管理用本地 ZIP 安装或更新。如果当前版本没有 ZIP 上传入口，停止 AstrBot 后把 ZIP 内唯一的 `astrbot_plugin_fallout76_style` 目录放入当前实例的 `data\plugins`。已有同名目录先备份，再替换代码，避免新旧文件混合；配置和数据库在代码目录之外。
4. 先保持插件配置的 `enabled=false`。在 Windows 本机盘预先创建独立目录，如 `D:\Harness\fallout76-style`，给 AstrBot 运行账号读写权限，给历史文件只读权限。运行时目录变更不会搬迁风格库；外置盘未挂载或目录不存在时插件不会改用其他位置。
5. 在插件配置里填写唯一目标 QQ 群、平台实例 ID（与平台名称不是同一字段）、平台类型和机器人 QQ 列表。机器人列表至少包含大肥鱼自己的 QQ，有其他已知机器人也一并加入。填写路径示例：

   | 配置 | 填写方式 |
   | --- | --- |
   | `target_group` | 实际目标 QQ 群号 |
   | `platform_id` | AstrBot 当前接收该群的适配器实例 ID |
   | `platform_name` | 实际平台名称；OneBot v11 通常为 `aiocqhttp` |
   | `bot_ids` | QQ 号码字符串数组 |
   | `style_directory` | 已存在的独立绝对路径 |
   | `gcp_history_file` | 已有的 `<GCP数据目录>\chat_history\<平台名>\group\<群号>.json`，绝对路径 |
   | `learn_style` / `inject_style` | 默认均为 true，可分别暂停采集评估和请求注入 |

   文件必须属于同一群与同一机器人。找不到时先查实际 GCP 目录或导出目标群历史；留空只学习插件启用后实际收到的群事件。不要创建空历史文件冒充接通，也不要把私聊、整库或 DSH 桥接库填进去。
6. 先用独立测试风格目录和目标群脱敏历史副本，按下面步骤离线验收。确认 Windows 的文件和钩子兼容后，再让正式配置 `enabled=true`、保留既有群静默策略，重载本插件。默认每 90 秒检查历史及更新；需要至少 12 个可关联的对话回合和 3 位发言者，首次后每 24 个新样本复核，UTC 每天最多 12 次。无需模型 API Key，原预算不会扣减。未收到的群消息无法学习；未生成回复时也不会产生请求钩子日志。

## 不发群消息的验收

从 AstrBot 根目录运行，路径以实机为准。用 AstrBot 自己的 Python 或兼容 Python；`$config` 指向独立测试配置 JSON，可复制已有配置并把风格路径和历史路径改成测试副本。常见配置名为 `data\config\astrbot_plugin_fallout76_style_config.json`。不要把生产配置的密钥打进测试包。

```powershell
$env:PYTHONPATH = (Resolve-Path '.\data\plugins').Path
$config = 'D:\Harness\fallout76-style-test\test-config.json'
$gcp = (Resolve-Path '.\data\plugins\astrbot_plugin_group_chat_plus').Path
python -X utf8 -m astrbot_plugin_fallout76_style.manage_style --config $config status
python -X utf8 -m astrbot_plugin_fallout76_style.manage_style --config $config import-gcp
python -X utf8 -m astrbot_plugin_fallout76_style.manage_style --config $config evaluate
python -X utf8 -m astrbot_plugin_fallout76_style.manage_style --config $config history --limit 1
python -X utf8 -m astrbot_plugin_fallout76_style.verify_chain --config $config --gcp $gcp
```

- 第一次导入应有样本，重复导入应为 0；状态应出现版本号，历史应能查看差异、消息 ID、时间和关联。明确引用有原 ID 才认作精确引用。GCP 若只保存 `[引用消息]`，插件不猜引用目标；没有明确引用的相邻回合标为 `nearby`。
- `verify_chain` 对实机已安装的受信任 GCP 源码执行离线钩子，检查重写后的系统请求：`before_count=0`、`after_count=1`、`other_system_content_preserved=true`。它不启动 AstrBot、不给模型发请求、也不连 QQ；如果有兼容 AstrBot 源码检出，可加 `--astrbot-source <目录>` 验证原生 runner 的系统消息组装。
- 核对真实宿主的被动采集时，可等待群自然聊天，检查游标或样本数增长，同时保持群静默。验证运行时最终请求应在隔离 AstrBot 实例用目标群的离线 OneBot 事件和本地假 provider，关闭发送出站，在 provider 入口仅记录风格标记出现次数和固定人设/现有记忆是否仍在。`log_hook=true` 只证明本插件曾附加风格，不能单独证明后续钩子未覆盖。
- 原有知识回归：检查原知识和人工修订仍可查，既有 DSH 或 AstrBot 知识接入照旧。离线回放、假 provider 和状态记录均留在测试目录。

若生产 GCP 只保留数据库历史，可从其已有数据导出目标群 UTF-8 JSONL，经 `import-replay <文件>` 导入；每行对象包含字符串 `group`、`id`、`sender`、`role`（只采纳 `human`）、秒级 Unix `ts`、`text`；可选 `reply_to`、`quoted`、`addressed_to_bot` 和 `media`（`face`、`sticker`、`image` 的数组）。保留源消息 ID；字段缺失不编造。生产已安装副本不能通过上述离线验收时，请 Windows 端提供：

- AstrBot 版本/提交号、原生还是第三方 Agent runner；group_chat_plus 的 `metadata.yaml`、`main.py`、`utils/reply_handler.py`、`utils/system_prompt_rewriter.py`（或实际替代文件）。若生产启用了主动回复，还需其实际发送前请求生成模块；本包未验证绕过请求钩子的模型直连或缺少可确认账号身份的虚拟事件。
- 实际群历史路径和少量目标群脱敏记录（需保留群、发送者、机器人标识、消息 ID、时间、引用及图片类型字段的相对关系）；若只在数据库内，先给表结构和少量同样脱敏的记录，无需提供整库。
- 该群启用的插件/钩子清单、平台实例 ID 和最后一跳的脱敏请求验收记录。无需提供账号、密钥、Cookie、私聊、人设原文或原始图片。

## 迁移与回滚

- 从 DSH 0.3.0 升级：没有数据库迁移操作。AstrBot 新建 `fallout76-style.sqlite3`，不会打开原知识库、记忆或人格文件。若未来移动风格目录，先停止写入，备份并复制整个目录，保持目标群、平台实例 ID 和机器人列表一致，再改配置。数据库绑定这个范围；变化时用独立目录并重新审核语料，避免串群。
- 暂停学习保留当前表达：`learn_style=false`；暂停注入但继续评估：`inject_style=false`；全部停用：`enabled=false` 或停用该插件，再重载。设置不影响 AstrBot、GCP 的现有回复权限。
- 回到一个已知风格版本（`0` 表示无风格），保留当前游标、日额度、样本和全部版本记录：
  ```powershell
  python -X utf8 -m astrbot_plugin_fallout76_style.manage_style --config $config rollback 0
  python -X utf8 -m astrbot_plugin_fallout76_style.manage_style --config $config status
  ```
  回滚形成一个新的记录并冻结自动应用；`resume` 才恢复评估。要完全撤回代码，停用/移除这一个 AstrBot 插件（或恢复备份的旧同名代码），保留风格目录以便审计。DSH、GCP、LivingMemory 和发送配置无需回退。
