---
name: dsh-assistant
description: Codex主控与DSH执行助手。当前项目已明确开启协作模式时，承接有边界的批量语义整理；未开启时仅手动点名使用。Codex负责复杂工作、核查和交付。
---

# DSH 手动助手

## 0.9.0主控工作流（优先于所有下文旧规则）

完整命令和限制见插件根目录ENGINE.md、UPDATES.md。当前模式已授权时先预览，默认通过orchestrate.mjs enqueue/run队列执行；独立任务可并发，默认2个DSH专用worker。复杂工作留给Codex，确定性工作用项目内Node脚本，重复整理交DSH。可用role=critic让另一任务独立质疑现有结论以降低单一视角；不要为了多样性无意义重复调用。

分配预算前填写planning(items/sources/expectedSteps/outputChars/reviewSeconds/handoffSeconds/risk)。预期交接+审阅成本抵消直接处理时，Codex自己做。机器只验证声明与结构，复杂度和多样性仍由Codex判断。

队列run返回工具会话ID后继续等待，并在等待期间完成自己的复杂部分；之后检查status。needs_codex必须由当前Codex根据原目标、partial result和reason实际完成，再用takeover登记产物；cancel_pending必须先confirm-stop，不能让两方继续同一写入范围。没有后台自动唤醒Codex，不另起第二个Codex。用户取消的任务应停止，不自动接手继续做。

运行中可用allocate调整DSH预算并steer通知它，不是无条件自动加码。修正改走correct，填错误类型、具体缺口、预计修正耗时和最大次数(1..5)，工具故障或不值得修正转Codex，不再套用下文旧版一次补充规则。保留每轮反馈与结果。

队列/单项审阅后自动维护项目经验与日志归档；仅审阅证据可进长期知识库。后续任务自动检索相关经验并带来源引用，不把旧模型原文当事实。不写Codex全局记忆目录。默认30天压缩已审阅日志，180天归档删除须明确--cleanup；待审阅和取消不明记录保留。memory/metrics/dashboard提供检索、统计和离线看板。

真实协议beforeSeq/throughSeq分页回填替代单纯100条窗口限制，不能补全仍保守停止。通用json契约可检查required、arrayField、exactItems/minItems、itemRequired、uniqueBy；语义与来源真伪仍需主控检查。

配置了GitHub HTTPS更新源并启用autoApply后，明确执行或队列启动前按间隔自动检查/安装；所有worker必须空闲。更新成功须从新版本重跑，避免旧进程继续调度。未配置源不假装可更新；没有任务时不额外创建后台模型轮询。

## 0.8.0协作模式（优先于下文手动默认规则）

先离线运行 `manage.mjs mode status`。默认manual；用户明确授权Codex分工后，使用 `manage.mjs mode coordinated --workspace ABS_DIR --user-request "真实授权原文"`，只将授权保存在本机状态目录，分享包不含该配置。不自动替其他项目开启，也不自动续期/重置预算。

有效协作范围内，Codex自主拆分、先预览，再用 `run.mjs TASK.json --execute --coordinated` 执行，不逐个重复问用户。该入口检查任务文件真实路径位于授权项目、授权未过期和预算未耗尽；范围外或到期/超额直接由Codex继续完成，不自行放宽规则。

分工：Codex做需求、架构、复杂代码、调试、关键结论和验收；确定性提取与转换交给脚本；DSH做资料搜索、批量摘要、分类、语义字段整理。将同口径材料合成一项边界明确任务，避免拆成大量小调用。60秒内直接完成的工作仍不派。DSH可以联网并按需要使用自己的工具，任务kind允许research；不要再给一般任务添加“禁止联网/不调用工具”。项目写入范围仍按具体任务授权，不因为开放工具而自动允许所有修改。

授权范围仍为24小时的当前项目，不再默认限制整轮3次或累计90000token；持续记录用量，是否继续根据实际剩余工作和返工判断。若用户另设maxCalls/maxInputTokens总上限必须遵守；有明确token总上限但用量未知则阻止继续。调用计数在共享锁内预留，失败也记录。不保证净省费用。

每次委派先分配任务级预算。可选workload为light/standard/research/large，未指定时按材料量和研究类型给起始建议；这些是可覆盖的起点，不是档位硬上限。Codex用budget覆盖工具、来源、输出、提示长度，用timeoutMs分配时限，budgetReason说明预计步骤与分配理由。预览和执行日志均记录allocation。不要机械套4次工具/120秒；材料多、来源多或交付复杂时合理增加，简单任务减少。

当前实现保留异常参数保护：工具最多64、来源30、输出30000字符、提示60000字符、时限10分钟；这些是单项执行保护，不是默认额度，超出则拆成有意义子任务或Codex接手。单项启动后按该次计划执行，不在后台无限自动加码；若需续做，Codex根据已得结果重新规划下一项，不重复整份材料。保留原有验收和一次补充规则。

技能允许被隐式选中仅用于检查本机模式，不构成授权。未配置或manual时仍按下文要求明确点名。`manage.mjs mode manual`立即关闭协作授权（正在执行任务须按原取消流程处理）。所有模式都保留review/deliver，DSH不再唤醒Codex。本轮插件开发与测试由Codex完成，不为了启用模式追加模型演示。

先说明使用本技能。只有用户明确说“交给DSH整理”等委派指令才执行；“研究一下”“优化项目”“可以”不能脱离上一条明确任务被当作泛化授权。禁止自动路由、后台派发或为演示重复调用。当前“改为手动模式”只授权修改插件，不授权新的模型任务。

脚本路径相对本文件为scripts/，以下SCRIPT替换为绝对路径，使用Node22+。任务和状态分离：任务JSON在工作区，状态默认~/.codex/dsh-assistant。可设置DSH_ASSISTANT_STATE_DIR，同一专用会话必须共用一个状态目录。

## 预览与执行

1. 先判断是否值得：确定性工作用脚本，短任务由Codex直接完成。architecture、复杂代码、关键决策不交给助手。不要把estimatedDirectSeconds统一填180来假装有收益。
2. 写任务JSON：唯一id、goal、input、deliverable、acceptance、limits、routing（kind为research/summarize/classify/semantic-extract、scriptSuitable、estimatedDirectSeconds、reason）、timeoutMs。只传必要输入，不复制聊天或整项目。实际估计不超过60秒的直接工作拒绝派发。
3. `node SCRIPT/run.mjs TASK.json` 默认离线预览，输出任务摘要、SHA256、预算、路由和费用未知提示；不启动DSH、不读凭据、不创建会话、不调用模型。先展示给用户简短摘要。若用户之前已明确授权该具体任务，可继续执行，无需重复询问。
4. `node SCRIPT/run.mjs TASK.json --execute --user-request "用户的具体委派要求"` 才能投递。不得编造用户要求。参数只是审计声明，不是安全认证；操作者仍需遵守真实授权。执行日志保留该声明和本次任务哈希。预算和范围仍生效，不因手动模式绕过。
5. 等待进程真正完成。returned/handoffState=awaiting_codex_review只代表候选；不能把它当作已验收交付。失败不自动重试。

## 预算与验收

预算按上文任务级分配，可增可减。工具由DSH按需要选择；明确无需工具时设置maxToolCalls=0。工具次数靠轮询后取消，存在超出可能；requireHardToolLimit=true或requireSystemReadOnly=true直接拒绝，不能篡改请求来绕过。权限限制主要靠提示，不是OS隔离。历史窗口丢失未观测事件时history_incomplete并取消。

可选validation={"kind":"timed-plan","totalSeconds":300}要求steps数组含action和正整数seconds，本地检查总和；失败为validation_failed。机器契约仅验证结构与算术，不证明内容专业正确。

Codex核对来源、实际文件和完成条件。原样合格：`manage.mjs review ID accepted "核查证据"`。原结果错误而Codex已修正：`manage.mjs review ID accepted_with_changes "错误与修正说明" --artifact FILE`，绑定修正版SHA256并保留历史。未合格用rejected。最多一次补充任务，必须新id并填写revisionOf；再次失败Codex接手，不自动重试、不自动唤醒Codex。

正式交付使用 `manage.mjs deliver ID`；未验收会拒绝，修正版变动后也拒绝。result/raw输出只供检查，外部代码若直接使用仍可绕过工作流。

## 配置与故障

只有明确执行或用户明确要求配置时，运行 `manage.mjs setup ABS_CWD`。首次执行也会自动setup：Windows已装DSH则启动并等待接口，创建独立会话并选模型，不发送测试prompt。未安装提示自行从官方渠道安装；登录和模型提供商配置由用户在DSH完成，不收集密码/API key。自定义位置用DSH_EXECUTABLE。其他平台手动启动兼容DSH。

已有配置复用；stale_session检查后用setup --repair修复；setup-pending.json支持续接。busy/invalid_config先处理现有状态，不自动删锁、不清空其他会话。超时请求取消并确认running=false且inbox空；cancelConfirmed=false须报告未确认并保留锁，不继续派发。

运行 `manage.mjs history` 离线查看最近10项摘要、用量差值和验收状态；不重新运行任务。doctor只读检查DSH；rotate显式轮换。自动轮换仅在明确执行下一任务前且会话空闲时发生：已接受6任务、历史序号300、最近请求输入量48000任一阈值触发，保留旧记录与模型、工作目录，不搬整段历史。

费用没有真实数据时写未知。用量取同一会话快照差值，字段未知或计数回退则未知；不能按响应快或单价低宣称省钱。本插件无新增MCP工具，不支持云端直接访问本机DSH。
