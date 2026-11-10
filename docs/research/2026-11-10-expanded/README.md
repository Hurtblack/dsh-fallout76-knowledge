# 辐射76中文知识库增量研究包

核对时间 2026-11-10T10:37:30+08:00（北京时间）。版本基线为第26赛季「当心血月」正式服 1.7.27.11（2026-10-20）。9月15日「杀人魔」首发为 1.7.26.13。10月下旬 World Pets / Hideouts 资料属于公开测试服，未按正式服收录。[Bethesda Fallout 新闻索引](https://fallout.bethesda.net/en/news)、[Fallout 76 Update Notes – October 20, 2026](https://fallout.bethesda.net/en-NZ/news/fallout-76-update-notes-october-20)、[The Slasher Release Notes](https://fallout.bethesda.net/en-US/news/fallout-76-the-slasher-release-notes)、[《Fallout 76》“杀人魔”更新与赛季概览](https://fallout.bethesda.net/zh-CN/news/fallout-76-the-slasher-update-season-overview)

v0.3.0 发布整合：41条非限时记录已追加到内置目录，保留原36条及稳定包ID；8条限时记录仍仅保留为研究快照。完整来源注册表随插件文档分发。

## 交付内容

| 文件 | 内容 |
| --- | --- |
| [knowledge-candidates.json](knowledge-candidates.json) | 49 条增量候选，使用独立的 `exp-` ID |
| [sources.json](sources.json) | 83 个 URL，官方 42、Wiki 29、社区 12，其中 36 个只采用索引文字或摘录 |
| [01 商店、货币与图纸](01-shops-and-currencies.md) | 12 条，含常驻商人、轮换、四类游戏内资源、原子商店与会员 |
| [02 活动与进入路线](02-activities-and-events.md) | 18 条，含公共事件、变异事件、每日行动、远征、突袭、围剿和季节活动 |
| [03 配卡与装备路线](03-builds.md) | 11 条，其中 8 套配卡，另有卡片改版、尸鬼与传奇槽的说明 |
| [04 11月时效快照](04-time-sensitive-november.md) | 8 条，含米涅瓦、原子商店和活动日历 |

基于插件 v0.2.0 的 36 条内置资料筛重。本包将仓储、国库券基本兑换、会员到期后取存量、每日行动按日领档、变异基础等留在基础包。与基础包同主题时补充新用途，例如远征领队和周图纸、每日行动两种模式的分工、变异公共事件三会员结算。对现有候选做了 ID、标题及主要知识点核对，未重写基础包。

## 如何解释证据

- 官方补丁优先用于明确改过的机制。常驻帮助页用于入口和规则，但遇到与正式补丁冲突，或页内数据不一致时，正文保留差异和采用口径。
- `page-text` 表示可以读取页面文本，`indexed-text` 和 `indexed-excerpt` 表示仅使用公开索引。发布日期或更新时间无法确认时为 `null`；核对时间为本轮汇总快照，不能解释成页面更新时间。
- `reference` 指已有公开资料支持的摘要。配卡用 `experience`，其中 `buildDetails.facts` 为可查机制，`buildDetails.recommendation` 为整理者路线，`limitations` 说明证据边界。社区文章只作参考，不据此定最强、固定暴击率或必掉条件。
- 贴吧第23赛季帖直连返回 403，只读到公开索引摘录，配卡图片未读到。基础包已引用该帖两条经验，本包只登记其作为历史对照。[辐射76吧：【23赛季】健康人配卡加点护甲武器](https://tieba.baidu.com/p/10400002232?fr=good)
- 官方第26赛季图历的文章可读，原图抓取返回错误。采用公开转录核对日期，用 Nuka Knights 交叉核对时刻，排期未实测。官方月报与通用重置页的适用范围不同。[Bethesda：The Slasher Update is available NOW](https://fallout.bethesda.net/en-US/news/fallout-76-the-slasher-update-out-now)、[Nuka Knights：Fallout 76 Event Calendar](https://nukaknights.com/events-calendar.html)、[R.O.L.L.：Season calendar](https://fallout76.wiki/calendar)、[Atomic Shop Monthly Update: November 2026](https://fallout.bethesda.net/en-US/news/atomic-shop-monthly-update-november-2026)、[Bethesda Support：每日和每周重置](https://help.bethesda.net/app/answers/detail/a_id/72290/)、[Bethesda Support：Mutated Public Events](https://help.bethesda.net/app/answers/detail/a_id/72309/)

## 明显缺口

- 未核实当日正式服实时库存、玩家摊位、米涅瓦实际货架、11月周年挑战任务和奖励、具体每日行动地图与词缀。赛季确切结算时间、周主推套装下架时间及部分商品的起售小时未知。变异公共事件按排期另带官方的未开场问题。
- 未穷举所有阵营商店和图纸、每日行动逐季稀有池、突袭逐关掉率和全套最短刷取路线。常规报价与促销分开，结算仍以界面为准。
- 配卡核对到核心与替代卡、等级、词条、依赖、成本及操作。高阶四星最优组合、各平台逐卡伤害实测、冷肩逐首领控场效果和动力工具的传奇重击交互暂缺。

## 交接与导入

1. `knowledge-candidates.json` 沿用 `schema: 1`、`entries` 和基础条目字段。候选来源的 `checkedAt` 仍用日期，注册表有北京时间戳。`sources` 使用插件白名单域名，其他已核证据通过 `verification.supplementalSourceIds` 对照 `sources.json`；`verification.sourceIds` 列该条的全部证据。带 `starterAllowedHost: false` 的补充来源勿直接放进内置包的 `sources`。
2. `classification` 分为相对稳定机制 20 条、版本绑定 21 条、限时 8 条。限时项有 `validFrom` / `validUntil`、`timeZone`、原文当地日期和确认状态。准确时刻未知用 `null`。完整窗口按开始含、结束不含。没有时效过滤前，只把 `handoff.starterReviewEligible: true` 的条目送入内置包人工复核；限时项留作快照。v0.2.0 检索当前只提示复核，`reviewAfterDays` 本身不会把到期内容从回答中剔除。
3. 合并时保留稳定 ID。插件用包 ID 加条目 ID 作为去重键，同一键的旧副本不会仅因修订号变化而自动重写；避免反复换包 ID，也别把候选包覆盖成基础包。资料基线和来源核对日期跟着实质复核更新。
4. 已检查两个 JSON、候选及基础包 ID、每条来源与来源登记映射、时间边界、报告链接及 v0.2.0 的内置目录校验。校验使用临时目录的源码副本与候选包。
