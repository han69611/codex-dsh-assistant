# Codex × DSH 协作助手 0.9.0

**0.9.0为协作引擎升级版，新增行为以ENGINE.md为准，下面旧版本说明仅为历史背景。** 包含持久队列、多DSH会话、依赖/优先级/写入冲突调度、失败移交Codex、分类型修正、运行中预算调整、审阅证据长期索引、gzip归档、完整历史补读、通用JSON验收、离线质量看板与HTTPS自动更新。

87+项模拟/离线测试覆盖主要能力，真实DSH历史分页已只读验证；新架构尚未用真实模型任务完成多会话并发端到端验收。当前Codex必须持续监督队列、处理needs_codex，不是后台无人自主系统。在线更新发布在本仓库updates/latest.json，ZIP在releases目录；配置方法见UPDATES.md。

快速入口：`node skills/dsh-assistant/scripts/orchestrate.mjs status`；入队enqueue TASK.json OPTIONS.json；执行run；看板dashboard。管理命令见ENGINE.md。默认并发2，可配置1..8；不等于默认同时花费8个模型任务。

**0.8.0改为任务级动态分配。** Codex根据材料量、搜索范围、步骤及输出要求设定budget和timeoutMs，并用budgetReason说明理由。workload的light/standard/research/large只是建议起点，可按具体任务覆盖；不再默认整轮最多3次或累计90000token，保留统计及用户明确指定的总上限。

实现仍校验异常参数：单项工具64次、来源30个、输出30000字符、提示60000字符、时限10分钟以内；不是每项任务自动分配到这些上限。预览显示allocation，启动后按该次分配执行，续做时由Codex重新评估，不自动无上限加码。58项回归通过。

0.7.1开放DSH自身工具及联网研究，移除协调模式强制maxToolCalls=0。默认使用4次工具预算，可在单项任务明确下调。research任务可在项目协作授权内执行；引用网络事实仍需可核查来源。保留120秒时限、调用轮次预算、取消与Codex验收。未新增真实模型演示。

0.7.0新增本机项目级协作授权，优先于下文0.6.0默认手动说明。默认仍为manual；明确授权后可开启coordinated，由Codex分工并执行范围内任务，无需每项重问。共享插件不携带授权。

命令：`manage.mjs mode coordinated --workspace ABS_DIR --user-request "真实要求"`；状态：`manage.mjs mode status`；关闭：`manage.mjs mode manual`。执行：`run.mjs TASK.json --execute --coordinated`。不带execute仍只预览。

授权24小时、最多3次尝试、可见输入累计90000token后阻止下一次（不是单次硬上限），单次120秒；允许联网搜索、调用DSH自身工具及批量摘要/分类/语义提取。超额/越界由Codex接手，不自动重置。复杂工作留给Codex，确定性工作用脚本，很短的工作不派。

**0.6.0起仅手动使用。** 技能policy.allow_implicit_invocation=false。只有明确说“交给DSH整理”等具体指令才执行；普通任务不会自动委派。默认 `node run.mjs TASK.json` 只离线预览，不启动DSH、不调用模型。执行需 `node run.mjs TASK.json --execute --user-request "具体委派要求"`，不必为已授权的同一任务反复确认。该参数是调用者的审计声明，不是安全认证令牌。

`manage.mjs history`离线查看最近10项的用量、耗时和验收摘要。返回仍需review和deliver。旧版命令若不加执行标志只会得到preview；依赖自动投递的旧集成需主动迁移，不能把preview当作完成结果。此前下面的安装/初始化说明仅在用户明确要求配置或执行时适用，不会在预览阶段启动DSH。

0.5.0修复协作验收语义：支持accepted_with_changes绑定修正版文件及哈希，保留验收历史；deliver拒绝未验收结果。新增timed-plan结构与时长合计校验、真正的零工具观测预算、单轮用量差值。42项Node回归通过。

调用者必须区分“返回”和“通过”：run/result只供检查，正式交付使用manage.mjs deliver ID。外部应用直接展示原回复并不等于Codex验收，插件不能强制修复外部代码。

0.4.0增加事件窗口截断保护、严格系统只读要求的拒绝路径、配置计数和目录校验。安装器使用暂存目录替换源文件；失败时恢复旧文件和市场清单，并尝试恢复Codex注册，注册恢复失败会明确告警。备份和失败目录保留供检查；升级不会合并残留旧文件。

0.3.1修复首次启动等待API就绪、无效配置被覆盖、读取较早中间回复三个问题；安装器新增Node最低版本检查，并明确使用UTF-8读取个人市场配置。31项回归通过。

本地 Codex 插件：一个工作流技能及其 Node 脚本。当前 Codex 主控，DSH DeepSeek 串行处理简单任务，Codex 负责验收和交付。复用既有 DSH 本地 HTTP 桥接认证，不需要独立 API key 或第三方依赖。

## 安装

若Windows默认禁止运行脚本，可使用 `powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-Codex.ps1`；仅该安装进程使用此设置，不修改系统执行策略。

安装后在Codex选择此插件，说“配置 DSH 执行助手并检查连接”。首次调用技能会执行setup：自动发现并启动已安装的Windows DSH、等待接口、创建专用会话和本机配置。接收者需在自己的DSH完成首次引导和模型提供商配置。缺少DSH时会提示安装，不内置或分发DSH安装器。配置保存在接收者的用户目录，与分享者完全独立。重复调用复用会话；中断配置可恢复。初始化不发送模型任务。

命令：`node skills/dsh-assistant/scripts/manage.mjs setup <共享目录>`。只检测不启动可加 `--no-launch`；会话丢失经检查后可加 `--repair`。自动启动当前支持Windows常见安装位置，自定义位置设置DSH_EXECUTABLE；其他平台需手动启动兼容DSH。插件首次调用依赖Codex加载技能，不是在安装插件时执行后台钩子。

将插件目录放在稳定位置。使用 Codex 插件页面的本地插件/市场入口；也可在一个本地市场目录中创建 `.agents/plugins/marketplace.json`：

```json
{"name":"dsh-local","interface":{"displayName":"DSH Local"},"plugins":[{"name":"codex-dsh-assistant","source":{"source":"local","path":"./codex-dsh-assistant"},"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"Developer Tools"}]}
```

其中 `codex-dsh-assistant/` 放在该市场根目录。然后运行（用实际绝对路径替换占位）：

```powershell
codex plugin marketplace add "<本地市场根目录>"
codex plugin add codex-dsh-assistant@dsh-local
```

重新打开聊天选择插件，输入“使用 DSH 执行助手，先检查专用会话，再把适合的简单子任务委派给 DeepSeek”。插件安装不等于自动执行；初始化及实际投递由技能指导当前 Codex 完成。

## 运行

需要 Node 22+、正在运行并已登录的 Windows DSH。脚本位于 skills/dsh-assistant/scripts，先运行 manage.mjs init <共享目录>，再运行 manage.mjs doctor。若已有本方案创建的专用会话，可显式绑定其 ID；分享包不包含本机绑定、历史或凭据。

执行 `node run.mjs <任务.json>`，结果保存在用户状态目录；`node manage.mjs result ID` 查看结果，`node manage.mjs review ID accepted "核查证据"` 记录验收。

任务模板见 examples/task.json。默认只读、单会话串行、至多一次补充，由 Codex 控制。超时取消未确认则保留锁。费用未知时如实标记，使用成本由 DSH 模型与上下文决定。

## 0.2.0 成本边界

- 投递前必须声明 routing 判断；适合脚本、60秒内可直接完成、超出助手范围的任务不调用模型。`manage.mjs assess task.json` 可离线预检，run 也会强制检查。
- 默认预算：工具4次、来源3个、正文1200字符、提示12000字符。任务可下调预算，上调需修改版本策略。
- 工具预算采用观察后取消，不是执行前硬上限；可能因轮询间隔、并行工具与网络延迟而超出。严格要求硬上限的任务设置 requireHardToolLimit=true，插件会拒绝委派。
- 来源及输出长度为返回后的验收门槛，不能当成生成额度硬限制。超标状态为 budget_exceeded，进程退出码1；不委派退出码2，成功取得待验收结果为0。
- 累计接受6项任务、历史序号300、最近输入用量48000任一触发下次任务前轮换。旧会话保留，模型与工作目录延续，新会话仅接收必要任务输入。`manage.mjs doctor` 只读查看；`manage.mjs rotate` 主动轮换。
- 补充任务必须填写 revisionOf，最多一次。日志保存判断、预算、观测调用次数、用量快照、轮换记录、耗时和取消确认，费用未知。

这些初始阈值是可测试的控制策略，并没有证明净节省比例。路由判断依赖主控如实填写；轮换不能减少 DSH 固有系统与工具上下文。

这是本地分享包，未发布公共目录或上传账户。兼容清单位于 .codex-plugin/plugin.json，portable 清单位于根 plugin.json。提供技能和脚本，不新增 MCP 工具。

## 验证

`node --test tests/*.test.mjs` 运行离线回归；真实桥接基础运行证据来自此前最小版本的两项委派与取消测试。新版预算与轮换用模拟 DSH 接口验证，另做本机只读 doctor 检查，不为打包重复消耗模型额度。
