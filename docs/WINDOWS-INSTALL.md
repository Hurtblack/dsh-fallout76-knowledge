# Windows 安装与验证

适用环境：已经安装 DSH + dsh-napcat-bridge / NapCat。请使用当前实际安装目录和 profile；不要照抄其他电脑的路径。

## 安装

1. 定位当前 DSH_HOME、DSH CLI、运行 profile 以及 bridge 使用的 `messages.sqlite`。备份 profile 配置。宿主需要 Node ≥22.13 且支持 `node:sqlite`。
2. 从 GitHub Releases 下载 `dsh-fallout76-knowledge-0.1.2.tgz`，用实际 profile 安装：
   ```powershell
   dsh plugin --profile desktop add "D:\Downloads\dsh-fallout76-knowledge-0.1.2.tgz"
   ```
   `desktop` 是示例。若使用其他 profile，替换为实际名称。不要覆盖整份 cordis 配置，也不需要更换原有 QQ 接入方案。
3. 重启 DSH，打开“设置 → 辐射76知识库 → 学习设置”。默认会话列表为空；添加 `group_你的群号`，每行一个。若确实要学习私聊，显式添加 `user_QQ号`，其知识仍与群隔离。
4. 配置知识目录和消息库的绝对路径。知识目录可以放外置盘，例如 `E:\DeepSeekFish\SharedData\fallout76-knowledge`；盘符应现场确认，不能假定为 E:。变更目录不会自动搬迁知识。
5. 确认当前可用模型。默认 `deepseek-account / deepseek-flash`，通过 DSH 已登录的 DeepSeek 账号调用；可以在设置中改成宿主支持的其他文本模型。
6. 保存并启用。第一次自动运行只建立起点，此后学习新消息。需要回看时，在“手动整理与游标恢复”指定分钟数。

## 验证

- 页面应能读取状态并显示消息库存在；未找到文件时修正真实路径，不创建空数据库掩盖问题。
- 核对普通群消息能由 bridge 被动写库。本插件不修改群接收、发言或主动回复策略，也不启动 NapCat；若只接收 @ 消息，就只能学习这些消息。
- 不需要发送 QQ 测试消息。可等待自然聊天，或用独立临时 SQLite 验证，再检查管理页面是否有条目与匹配原话。样例数据不能混入正式库。
- 解压源码 zip 后，可以用 Node 22.13+ 执行 `node --test test/*.test.mjs`。测试不需要 QQ 登录或模型账号，不会发消息。
- 如果宿主无法加载插件，检查 `node:sqlite`、tools/llm/webServer/connection 服务和 DSH/bridge 版本；开发验证版本详见 VALIDATION.md。

## 迁移、停止与回滚

- 先停用学习并停止相关 DSH，再复制完整知识目录。不要让两台宿主同时写同一库。
- 更换消息数据库后，使用“从最新消息重新开始”重设起点；已有词条保留，此前未整理消息会被跳过。
- 设置中取消“启用知识库”即可停止检索与学习，也可以在宿主插件管理停用本插件。
- 移除：`dsh plugin --profile desktop remove dsh-fallout76-knowledge`，替换实际 profile 名。知识文件默认保留，方便恢复。
