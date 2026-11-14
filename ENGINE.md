# 0.9.0 协作引擎

## 分工与多样性

Codex承担需求、架构、复杂代码、关键判断、整合和最终验收。可确定计算交给限定项目内的Node脚本。DSH承担研究、摘要、分类与语义提取。队列任务executor可选dsh/script/codex，role可选executor/critic；critic会明确要求独立复核和不同假设，而不是重复现有结论。观点不同不等于事实正确，最终由Codex核查。

planning可写items、sources、expectedSteps、outputChars、reviewSeconds、handoffSeconds、risk。预算据这些字段与材料量推导，仍可人工覆盖；若预期审阅与交接时间抵消直接处理时间，或risk=high，交给Codex。不是自动理解全部项目的模型，不承诺净省钱。

## 队列与并发

`node scripts/orchestrate.mjs enqueue TASK.json OPTIONS.json`，OPTIONS支持executor、role、dependsOn、priority、writeScope。路径相对实际插件skills/dsh-assistant目录。任务快照持久化于用户状态engine.json，默认2个独立DSH worker，可用concurrency 1..8调整。相同目标/输入/交付/角色去重；引用文件变化需显式更新输入以刷新去重键。

`orchestrate.mjs run`前台执行所有当前可运行任务；依赖需accepted才放行，失败依赖转Codex接手。声明writeScope重叠的任务串行。此为调度约束，不是OS沙箱。DSH worker独立会话和状态目录，旧会话保留；当前Codex可同时做复杂工作，工具返回会话ID时须持续等待和查看status，不要把任务投递当完成。

没有后台自动唤醒当前聊天；Codex接手由正在处理此任务的主控代理完成，不创建第二个Codex。待审阅/待接手状态出现后，主控必须继续核查和执行，不能停在状态记录上。用户取消任务则停止，不把取消当作失败后继续做。

## 失败保底

任何DSH失败记录原因、已有结果和工作会话，状态needs_codex；主控使用takeover JOB_ID COMPLETION.json登记自己的完成结果、证据与可选文件。若取消未确认则cancel_pending，保留worker锁，不复用该槽位；confirm-stop只在确认会话停止、队列为空后放行。无法确认时不自动宣称接手安全。

cancel支持排队任务及执行任务，DSH通过控制文件请求取消，脚本由其所属worker停止。recover仅在旧pump进程已不存活时恢复遗留任务，先要求停止确认。它不是断电后无损恢复，也不是跨机器分布式队列。

## 动态预算与修正

`orchestrate.mjs allocate JOB_ID PATCH.json 分配理由`可调整排队任务或运行中的DSH预算。PATCH为budget、timeoutMs等；运行中runner读取控制文件，更新本地限额并用steer通知DSH，写allocationHistory。时限是本轮执行起点后的总时长，不能复活已结束任务；steer本身可能消耗输出额度，计入calls。不会无条件自动加码，主控根据进展决定。

correct JOB_ID OPTIONS.json要求errorType(content/format/missing-evidence/tool-failure)、feedback、reason、predictedSeconds、maxAttempts(1..5)。保留每次结果与反馈；超次数、工具故障或修正预计不划算，直接needs_codex。不是固定只能修一次；没有无限自动重试。

## 验收与记忆

支持timed-plan和通用json契约：required、arrayField、exactItems/minItems、itemRequired、uniqueBy，结构/算术失败不通过。来源真伪和业务正确性仍由Codex核查。

队列review/takeover与单任务review后自动维护本插件知识索引。只从已验收的审阅证据提炼可追溯条目，不把模型原回复当事实；含项目范围、任务和文件hash。后续任务自动检索最多3条相关经验加入提示。memory命令可检索，拒绝或文件变化会使条目失效。应用知识库不写入Codex全局memory目录。

maintain默认将30天以上已审阅终态日志压缩归档，保存SHA256索引，保留未审阅/取消未确认记录。`maintain --cleanup`才删除超过保留期(默认180天)的归档。API可配置保留期；备份文件与产物不随意删除。历史分页用DSH真实beforeSeq/throughSeq协议，完整回填缺页并去重，失败仍保守中止。

## 统计与看板

manage metrics返回审阅、返工、状态、调用与token汇总；orchestrate dashboard生成本地HTML快照。日志增加准备时间、pipelineElapsedMs和审阅等待时间；等待时间不是主动人工工时。费用未知，不能拿这些指标直接宣称省钱。

## GitHub更新

update.mjs configure HTTPS_MANIFEST --auto-apply后，在明确执行或队列运行前按间隔检查并更新；无任务时不会后台定时唤醒。check/apply可单独执行。验证SemVer、HTTPS、SHA256、ZIP路径/大小/CRC；全部worker空闲才安装，复用已审阅安装器。更新成功后要求从新版本重跑原任务，不在旧代码进程继续执行。GitHub public仓库只发布源码、测试与打包产物，不含本机状态或凭据。
