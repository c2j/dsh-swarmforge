# SwarmForge → dsh 移植计划（M0–M3）

状态: **M0–M3 全部完成（2026-08-24）**。185 测试全绿；模型驱动 e2e 待有凭据手工运行（见各 milestone findings 的 manual checklist）。R1/R4/R5 均已裁决并落地（§8）。
上游基线: unclebob/swarm-forge @ main `4f19ed05`（协议脚本核实自 `swarmforge/scripts/*.bb`）
宿主: deepseek-harness（本地 `/Users/c2j/Projects/Desktop_Projects/CODE/deepseek-harness`）
本仓库: dsh-swarmforge（greenfield，TDD 铁律见根 AGENTS.md）

---

## 1. 目标与非目标

**目标**：把 SwarmForge 的协作协议（固定编制、git 交接、宪法+人审）作为 dsh 插件（bundle）落地。协议以文件为准、以 handoff 状态机为唯一调度事实源；dsh 的 continuable sub-agent 承载角色。

**非目标（明确不做）**：
- 不嵌 `./swarm`、不共用私有 tmux socket、不搬 tmux 进程模型
- 不与 Kimi 式大规模扇出共用工作树
- 不追求上游 UI 像素级一致
- 不复用 dsh AgentTeams 的任务 DAG / writeScopes（与 handoff 状态机竞争；只借"命名可续跑成员"模式）
- 不改 deepseek-harness 上游（见 D1）

## 2. 决策记录（已拍板）

- **D1 不改上游**：全部能力经 dsh 插件机制注册（bundle + cordis.patch）。per-child cwd 不修改 `childSessionMeta`，由插件解决（M1 双路线 spike，见 §8 R1）。
- **D2 审批走异步队列面板**：对齐上游语义（specifier 出站后立即自由，人审在独立面板异步进行）。不用 dsh `ctx.approval` 的阻塞式 turn 内审批承载主流程；插件自管 `pending_approval` 状态机 + Web 面板 Approve/Reject。
- **D3 全部 in-process agent**：角色一律 `ctx.subagents.startContinuable`（provider: spawn/in-process）。**支持 per-role 模型**：经 dsh preset 机制（per-session `agent.cordis.yml`）为每个角色指定模型/工具集（M1 落地，M0 先统一默认）。
- **D4 调度以 handoff 文件状态机为准**：唤醒（`followup`）只是"敲门"，有损、泛化、不携带任务内容；角色必须经 `ready_for_next` 工具拉取（保序 + 断点续跑，上游协议灵魂）。
- **D5 文件是唯一事实源**：`.swarmforge/` 目录（git-ignored）承载全部状态；session log 仅作 UI 镜像来源，不作为协议事实源。

## 3. 架构总览

```
┌─ dsh host（不改） ────────────────────────────────────────────┐
│  lead 会话（master 角色，如 specifier）                        │
│    └─ 工具: swarm_start / swarm_handoff / ready_for_next /    │
│              done_with_current / swarm_clarify(M2)             │
│  角色 = continuable sub-agent（childId=角色名, kebab-case）     │
│    master 角色 → 主 checkout；worker 角色 → .worktrees/<role>(M1)│
│                                                                │
│  本插件（bundle）:                                              │
│   host 半: SwarmForgeService(ctx.swarmforge)                   │
│     - conf 解析/校验（编制声明）                                │
│     - handoff bus: send→validate→deliver→wake; hold→approve   │
│     - git 层: worktree/commit 校验/merge/byline hook           │
│     - 面板数据 API（M2 起，插件可注册的 host 通道，见 R5）       │
│   client 半(dsh.client): Swarm tab（conversation.view slot）    │
│     - M2: Attention 队列(Approve/Reject) + Clarify 队列        │
│     - M3: 看板(lanes) + New Task + 收发件箱浏览                │
└────────────────────────────────────────────────────────────────┘
文件总线（项目内, git-ignored）:
  .swarmforge/
    handoffs/<owner>/{outbox/{tmp,sent,failed}, inbox/{new,in_process,completed}}
    handoffs/pending_approval/        # 人审挂起
    handoffs/outbox/                  # 项目根 outbox（New Task / 已批准件入口）
    notify/reject-<task>              # 拒绝标记
    dashboard/clarifications/{pending,answered}/<id>.request
    board/tasks.tsv, board/<name>.txt # M3
    roles.tsv                         # 编制运行时快照
  swarmforge/（随项目仓库, 可提交）:
    swarmforge.conf, roles/<role>.prompt,
    constitution.prompt, constitution/articles/*.prompt
```

## 4. 协议移植规范（字段级基线，TDD 依据）

### 4.1 编制声明 `swarmforge/swarmforge.conf`
```
role <role-name> [worktree=<name>|master|none] [mode=task|batch] [preset=<preset-id>]
```
- 保留上游语义：角色名 kebab-case（禁 `_`，保文件名可解析）、恰一个 `master`、worktree 名唯一、mode 默认 task。
- 舍弃上游 `window/window-invisible <agent>` 字段：后端统一 in-process（D3），agent 选择改由 `preset` 表达。
- 校验失败 → 启动即报错并列出全部问题（对齐上游 fail-fast）。

### 4.2 handoff 草稿（`swarm_handoff` 工具入参 → 校验）
允许字段仅 6 个：`type, to, priority, task, commit, message`。
- `type ∈ {git_handoff, note}`
- `to`: 逗号分隔已知角色列表；广播时交付件保留完整 `to:`，每收件人副本加 `recipient:`
- `priority`: `00`–`99`，默认 `50`（小者先）
- `task`: ≤80 字符；git_handoff 必填；取 board 卡名/上游件 `task:`，禁止自造（工具侧强校验：草稿 task 必须存在于发送者 lane 卡或当前 in_process 件的 task）
- `commit`: 恰 10 hex；`git rev-parse --disambiguate=` 唯一解析且为 commit 对象；必须是发送者 worktree HEAD（工具自动回填，模型不许手填——照抄上游）
- `message`: note 必填，单行 ≤80 字符
- 保留字段（`id, from, role, recipient, created_at, enqueued_at, dequeued_at, completed_at, approved, artifacts`）出现在草稿中 → 拒绝
- 校验失败 → 教导性错误信息（指明错在哪、合法值是什么），模型可自行纠正重试

### 4.3 交付件格式
```
id: <UTC时间戳>_<6位序号>_from_<sender>
from: <sender>
to: <完整收件人列表>
recipient: <本副本收件人>        # 投递时加
priority: 50
type: git_handoff
role: <sender>
task: <task-name>
commit: <10hex>                # git_handoff
artifacts: <逗号分隔变更文件>    # git_handoff，面板用
created_at: ISO8601Z            # 发送工具写
enqueued_at: ISO8601Z           # 投递写
dequeued_at: ISO8601Z           # 拉取写
completed_at: ISO8601Z          # 完成写
approved: true                  # 仅审批路径，插在 header 块末尾（空行前）

Re-read your role and constitution.

merge_and_process <sender> <commit>    # note 则为 <message>
```
文件名: `<priority>_<时间戳>_<序号>_from_<sender>_to_<收件人列表>.handoff`。**文件名字典序 = 队列处理序**。序号 per-worktree 6 位计数器，进程内互斥（dsh 单 host 进程，无需上游 lock-dir）。

### 4.4 队列状态机（全部原子 rename）
- 出: `outbox/tmp/`（草稿写入）→ 校验通过 → 原子 rename 至各收件人 `inbox/new/`（加 `recipient:`+`enqueued_at:`）→ 发送副本归档 `sent/`；校验失败 → `failed/`
- 进: `ready_for_next` 先查 `inbox/in_process/`（恰一件→续跑；多件→报错）；否则取 `inbox/new/` 字典序第一 → rename 至 `in_process/`，盖 `dequeued_at:` → git_handoff 则先 `merge_and_process` → 返回结构化结果
- 完: `done_with_current` 盖 `completed_at:` → `inbox/completed/`
- batch 模式（M2）: 同优先级排队件打包 `inbox/in_process/batch_<ts>_<suffix>/`
- **项目根 outbox**（`.swarmforge/handoffs/outbox/`）: New Task 注入件与已批准件的入口，投递服务同样轮巡/处理；`(New Task)` 为幽灵发件人，sent 归档特判到根目录

### 4.5 人审门禁（异步，D2）
- hold 规则（照抄上游）: `type=git_handoff` ∧ 编制含 specifier ∧ sender=master 角色 ∧ 单收件人 ∧ 无 `approved:` 头 → 投 `pending_approval/`，**不唤醒任何人**
- Approve（面板）: 在 header 块末尾（空行前）插 `approved: true` → 原子移至根 outbox → 投递 → 唤醒收件人
- Reject（面板）: 删除挂起件 → 写 `notify/reject-<task>` → `followup(master, "Rejected: <task>")`
- Clarify（异步，同面板）: 角色 `swarm_clarify` 工具写 `dashboard/clarifications/pending/<id>.request`；面板回答 → 移入 `answered/` → `followup(该角色, "[<id>] <答案>")`
- 重启幂等: 已含 `approved: true` 的件不再 hold

### 4.6 git 约定
- 工作分支 `swarmforge-<role>`；worktree: `git worktree add --force -B swarmforge-<name> .worktrees/<name> HEAD`（M1）
- merge: `git merge --no-edit -m "Merge <sender> <sha>" <sha>`，已 ancestor 则跳过
- byline: 安装 commit-msg hook，commit message 缺 `By <role>.` 则追加（角色经 `SWARMFORGE_ROLE` 等价机制传入）
- `.gitignore` + `.git/info/exclude` ensure `.swarmforge/` 与 `.worktrees/`（swarm_start 幂等执行）
- **handoff 文件永不入 git**

### 4.7 宪法与角色注入
- 启动拉起角色时，种子 prompt 等价于上游生成式指令: "Read `swarmforge/constitution.prompt`, then read every file it refers to recursively, and obey all of those instructions. Read `swarmforge/roles/<role>.prompt`, then read every file it refers to recursively, and follow all of those instructions." + 生成的"工具用法"节（各角色可用工具清单及 `ready_for_next`/`done_with_current`/`swarm_handoff` 强制流程）
- 交付件 body 首行 `Re-read your role and constitution.` 逐字保留
- 宪法内容不进插件代码：插件只教工具，内容在项目 `swarmforge/` 目录（可提交、随仓库走）
- 本仓库附带 four-pack 默认编制示例（constitution.prompt + articles + roles/*.prompt，移植上游 four-pack 分支文案）

## 5. 代码布局（本仓库）

```
dsh-swarmforge/
  package.json          # name: dsh-swarmforge; "dsh": {"bundle": {"patch": "./cordis.patch.yml"}}
  cordis.patch.yml      # host 行(ctx.swarmforge 服务+工具) + dsh.client 行(Swarm tab)
  src/
    protocol/           # 纯协议层: 草稿校验/文件名/头部生命周期/状态机转换 —— 零 dsh 依赖, TDD 核心
    git/                # git 封装(经 dsh subprocess seam): rev-parse/merge/worktree/hook/excludes
    service/            # SwarmForgeService: conf、roster、bus(投递/hold/approve/reject/clarify)、唤醒
    tools/              # defineTool 定义: swarm_start/swarm_handoff/ready_for_next/done_with_current/swarm_clarify
    spawn/              # 角色拉起: worktree 生命周期、preset 装配、startContinuable、cwd 方案(R1)
    client/             # Swarm tab(M2 Attention/Clarify, M3 看板/New Task/收发件箱)
  test/                 # vitest: protocol 单测 / git fixture(tmp repo) / service(tmpdir+假唤醒) / e2e
  swarmforge/           # 默认编制示例(可被项目覆盖)
  AGENTS.md             # 工具链落地后更新命令清单(待补项)
```

**TDD 策略（遵守本仓库 AGENTS.md 铁律）**：
- 每个 TDD 循环: Red(失败测试) → Green(最小实现) → Refactor；每循环结束汇报测试/实现/重构/状态
- `protocol/` 纯函数 100% 先测后写；`git/`、`service/` 用临时 fixture；工具层薄封装（校验在 protocol 层测过）
- 禁止删测试改断言迁就实现；测试命名描述行为（如 `shouldRejectDraftWithReservedField`）
- 工具链: TypeScript(strict, ESM) + pnpm + vitest；构建产物 js 入口（cordis 加载）；不引入运行时新依赖（git 经 dsh subprocess / 系统 git）

## 6. 里程碑

### M0 — 协议总线冒烟（同 checkout，master + 1 worker）
范围: 不做 worktree、不做审批、两角色同目录（merge 为 no-op 路径也要真实走 `git merge` 判定）。
任务:
1. 工具链落地（pnpm/vitest/tsconfig/空 bundle 骨架，`dsh plugin --profile web add <本地路径>` 可加载）→ **更新根 AGENTS.md 待补项**
2. protocol 层 TDD: 草稿校验全规则（§4.2 每条一测）、交付件格式化/解析、文件名生成与排序、头部生命周期归属
3. git 层 TDD: 10hex disambiguate 校验、HEAD 回填、merge_and_process（临时 repo fixture）、excludes ensure
4. SwarmForgeService: conf 解析校验（fail-fast 全量报错）、投递状态机（tmpdir + 假唤醒回调注入）、序号互斥
5. 工具注册（lead scope）+ 角色拉起（startContinuable, 统一默认配置, 种子 prompt=§4.7 指令）
6. 唤醒回路: send → deliver → followup 敲门文案（照抄上游 "You have new handoff mail. If idle, run ready_for_next."，工具版改为调用 ready_for_next 工具）
验收（全部可执行验证）:
- lead 会话中 `swarm_start` → 2 角色激活（session id 稳定）
- 一次 `git_handoff` 端到端: 校验→投递→敲门→worker `ready_for_next` 返回结构化任务→`done_with_current`→空队列返回 NO_TASK
- **重启 dsh 后**: 角色 followup 冷恢复；worker 的 `in_process` 件正确续跑；序号计数器不冲突
- vitest 全绿；AGENTS.md 命令清单已补

### M1 — 工作树隔离 + git 全约定 + 按角色模型
任务:
0. **Spike R1（先做，双路线出结论并记录决策）**: (a) 插件注册自定义 SubagentProvider 包装 in-process run 以控制子 session cwd；(b) 角色沙箱工具箱（preset toolFilter 移除默认 bash/fs，注册强制 workdir 的 wrapped 工具）。按 §8 R1 取舍标准定案
1. worktree 生命周期: swarm_start 创建/复用 `.worktrees/<role>` + `swarmforge-<role>` 分支；ensure excludes
2. per-role preset: conf `preset=` 字段 → per-session `agent.cordis.yml`（模型/工具集/persona），两角色验证连不同模型
3. byline commit-msg hook 安装与角色名解析
4. sent/failed 归档完整化 + `(New Task)` 幽灵发件人特判（为 M2 面板 New Task 铺路）
验收:
- 两角色在各自 worktree 并发工作；一次真实跨 worktree merge handoff（含冲突外正常路径）
- 角色 A 用模型 X、角色 B 用模型 Y，同一编制内并存
- byline hook: 任一角色 commit 缺 byline 自动补全
- M0 全部验收项回归通过

### M2 — four-pack + 异步人审面板
任务:
0. **Spike R5**: 确认插件向 Web 端暴露数据/动作的 sanctioned 通道（apiproxy 扩展点 / 既有 Remote 模式 / ui-cordis 先例），记录决策
1. four-pack 默认编制移植（specifier/coder/refactorer/architect + batch 接收模式 + constitution 文案）
2. hold/approve/reject 状态机 TDD（§4.5 全规则，含重启幂等）
3. Attention 队列 API + Swarm tab: 挂起件列表（gate/task/artifacts）+ Approve/Reject 按钮 → 状态机动作 → 唤醒
4. clarify 异步队列: `swarm_clarify` 工具 + 面板回答 + followup 注入
5. reject 通知回路（followup specifier）
验收:
- 面板 New Task（或根 outbox 注入）→ specifier 出站 → **面板出现挂起件** → Approve → coder 收到并开工；全程 specifier 不被阻塞
- Reject 一次: 件被删、specifier 收到 `Rejected: <task>`、卡留在 specifier lane
- Clarify 一次: 角色提问 → 面板回答 → 角色收到 `[id] 答案`
- host 重启后 pending_approval 件仍挂起不重复 hold

### M3 — 看板
任务: board 数据层（tasks.tsv+卡文案）、lanes 视图、New Task 表单（替代根 outbox 手工注入）、各角色收发件箱浏览、（可选）状态热度。
验收: 不看终端，纯面板完成"建任务→审批→观察流转至完成"一轮。

## 7. 测试与验证策略
- 单测: protocol（规则级）、git（fixture repo）、service（tmpdir + 注入假 followup/gitRunner，隔离 dsh 运行时）
- 集成/e2e: 每 milestone 验收脚本（真实 dsh + 本地 git repo fixture），验收输出留档
- 回归: 每 milestone 结束重跑此前全部验收
- 诊断: lsp_diagnostics 清洁；不suppress类型错误

## 8. 风险登记

- **R1 per-child cwd（最高技术风险）→ 已裁决（2026-08-24，Oracle 路线 A′）**: 原 a/b 两路线均否——provider 包装不可行（continuable 子会话 header 由 manager 构建并深冻结，provider 仅贡献 seed）；registerContinuableSetup 在 header 冻结后运行，只读。**采用路线 A′（锚会话）**: 每角色经 `ctx.agents.create({ meta: { cwd: worktreeAbs, parentSession: coordinator.id, origin: 'subagent', delegationDepth: +1 } })` 创建锚会话，以锚为 `request.parent` 调 `startContinuable`，继承规则自动传播 worktree cwd（`child-agent.ts:110`），全部下游 cwd 消费者天然正确，lineage 完整（listDescendants 可穿透）。**关键失效点**: 锚 setup 必须镜像 `applyChildComposition` 的 preset join（`composeFrom`），否则角色工具注册表为空。**已知限制**: sandbox workspaceRoot 收窄到 worktree（协议工具不受影响，走 service 层）；session 列表出现 N 个 idle 锚会话；重启需 `ctx.agents.resume` 锚后再 followup。per-role 模型走 `request.agentOptions = { provider, model }`（冷恢复存活），conf 字段由 `preset=` 改为 `model=`/`provider=`；per-role 工具集走 `request.persona`/`toolFilter`。角色身份: `ctx.shellEnv.register` 暴露 `DSH_SWARMFORGE_ROLE`（仅模型 shell 调用），byline hook 保留 roles.tsv 兜底。
- **R2 模型不守约（不调 ready_for_next 自行开工）**: 缓解: 种子 prompt 强流程 + 敲门文案不给任何任务细节 + ready_for_next 输出是唯一获得 task 上下文的通道（结构性激励）。验收含"敲门后模型行为"观察项。
- **R3 followup 到无 activation 的角色触发冷恢复**: 这正是期望行为（等价上游重启拉取），但需验证种子 prompt 在冷恢复时仍生效（session 持久化已含系统侧注入）。M0 验收覆盖。
- **R4 面板 host↔client 通道 → 已裁决（2026-08-24，explore spike）**: apiproxy 与 Typert Remote 均为闭式装配，第三方不可扩展（client 装配显式 import，README 明言需 harness 源码改动）。**采用通道组合**: (1) 数据 = session projection（`SessionProjectionMap`/`StateMap` declare-merge 插件可扩展 + `ctx.sessionProjections.register`，队列变化时发 whole-value session event 驱动 fold，客户端 `useProjection` 零代码读取，重连经 history 基线恢复）；(2) 界面 = `conversation.view` list slot 加 Swarm tab（ui-trajectory 先例）或 `sidebar.footer.action`（ui-cordis 先例）；(3) 动作 = `ctx.remote.commands.execute(sessionId, '/swarm ...')` → host `ctx.commands.register`（两侧均插件可扩展的唯一通用动作通道）；(4) clarify 队列可乘 `ctx.userQuestions.ask()`（插件可调通用 API，现有 ui-user-questions UI 渲染答案输入；约束: 需 live root agent、composer 一次一批、自由文本走 custom 槽）。`ctx.approval.request()` 是 turn-bound，仅适合工具时内联审批，持久队列不适用。client 插件装载: package.json `dsh.client` 声明 + `exports["./client"]` + 本包 cordis.patch.yml 加 client 行（需增设 client 构建链）。工具卡（presentCall/presentResult + tool.call.toolview）为聊天流内补充面。
- **R5 dsh 包依赖源**: 本插件依赖 `@deepseek-ai/cordis` 等 dsh 包，其发布源（npm/私有/file:）未确认，影响 bundle 可安装性。M0-1 spake 验证 `dsh plugin add` 本地路径安装路径。
- **R6 上游协议细节漂移**: 上游在活跃开发。锁定基线 commit `4f19ed05`，协议规格以本计划 §4 为准（已字段级固化），后续上游变更按需选择性同步。

## 9. 开放问题（Momus 重点审）
1. M0 同 checkout 下 merge_and_process 走真实 `git merge`（同 HEAD→no-op）是否会掩盖 M1 才暴露的问题？是否 M0 就该用分支隔离（角色各自分支、同 checkout）？
2. conf 格式从上游 `window` 行改为 `role` 键值行（§4.1），是否保留更多上游字段以降低迁移心智（如 worktree 名与角色名解耦上游已有）？
3. Clarify 面板回答注入用 followup 文本（上游 `[id] 答案` pane 注入）是否足够，还是需要结构化消息类型？
4. 序号计数器持久化位置（内存 vs `.swarmforge/seq`）——重启后序号回退会导致文件名排序歧义吗（时间戳在前，实际风险低，但 id 唯一性要求呢）？
5. M2 batch 接收模式与 hold/approve 的交互（上游 batch 用于 architect 非门禁路径）是否需要在 M2 首次就实现？

## 10. AGENTS.md 更新义务
工具链落地（M0-1）后立即补: 构建/测试/lint/typecheck 精确命令、单测运行方法、目录结构、CI 检查顺序、测试 quirks（git fixture、tmpdir 清理）。
