# AGENTS.md — dsh-swarmforge

## 仓库现状（2026-08-24 核实）

- **M0–M3 全部完成**：协议层/git 层/服务层（含审批门禁/batch/clarify/board）/cordis 接线（锚会话+per-role model）/Swarm Web 面板（Queue/Board/Boxes 三视图 + projection v2 + /swarm 命令）全部落地（185 个测试全绿）；模型驱动的 e2e 冒烟尚待有凭据的手工运行（见 `.sisyphus/plans/m0-findings.md` §7.3、m1/m2/m3-findings 的 manual checklist）。
- 单包 pnpm + TypeScript（strict、ESM、Node >=22）+ Vitest；dsh 类型经 npm `@deepseek-ai/*@0.1.1-rc.2`（peer/dev 双声明，运行时由 dsh profile 提供）；client 半经 tsdown 构建（`pnpm build:client` → dist/client.js）。
- Git：分支 `main`（跟踪 `origin/main`），远程 `origin` = `git@github.com:c2j/dsh-swarmforge.git`（SSH）。
- 当前无 lint 工具/命令与 CI 配置；禁止编造不存在的命令。

## 核心设计原则：AI 协作规范（TDD，基于 Kent Beck 原则）

以下为强制规范，优先级高于任何效率考量。

### 1. 工作流铁律：Red → Green → Refactor

严格循环，**不允许跳过任何一步**。

**Red（写测试）**
- 在任何业务代码之前先写测试；测试必须能编译，但**必须失败**（验证测试本身有效）
- 修改现有功能前，先写**特征测试**（Characterization Test）锁定当前行为
- 测试命名必须描述行为，如 `shouldRejectNegativeAmount`

**Green（最小实现）**
- 只写**最少**的代码让当前失败的测试通过
- **禁止**：
  - 删除或注释掉失败的测试
  - 修改测试断言来适配实现
  - 一次性引入多个未验证的变更
- 现有测试因你的变更而失败 → 修复实现，而不是测试

**Refactor（重构）**
- 只有在**全部测试通过**后才能重构；重构后立即运行测试确认
- 重构范围限于当前工作区，不扩散到无关模块

### 2. Legacy 规则（首批代码合入后生效）

> 注：仓库当前为空，本节在已有代码存在时适用。

- **特征测试优先**：修改遗留代码前，先为其当前行为写特征测试——目的是"锁定"现有行为，而非验证正确性；允许特征测试"丑陋"，只要能捕获当前输出
- **接缝识别（Seams）**：遗留代码难测试时，优先找接缝（可覆盖的方法、可替换的依赖、可注入的配置）；找不到就先通过依赖注入或提取接口**创造**接缝，再写测试
- **增量引入**：不一次性给整个模块补测试；只给**即将修改的代码路径**补测试；未触及的遗留代码保持现状，不主动重构

### 3. 测试是不可变契约

- **现有测试代码只读**。除非人类明确指令，不得：
  - 删除测试方法
  - 修改测试断言
  - 将 `@Test` 改为 `@Disabled`
  - 用 `assumeTrue(false)` 跳过测试
- 测试确实过时 → 向人类报告，由人类决定是否更新

### 4. 探索与实现的边界

- **Explore**：需求模糊或方案不确定时可写"草稿代码"验证想法；探索产出**不能直接合并**，必须通过 TDD 循环重写
- **Implement**：方案确定后必须走 TDD 循环正式实现；禁止"先写一堆代码再补测试"

### 5. 提交前检查清单

- [ ] 新功能有对应的失败→通过测试
- [ ] 修改的功能有特征测试锁定原行为
- [ ] 全部测试通过（运行 `pnpm test`；单文件或按名称运行方法见下文）
- [ ] 没有删除或绕过任何现有测试
- [ ] 每次提交都是可工作的状态（不提交"半成品"）

### 6. 沟通规范

每个 TDD 循环结束时简要汇报：
1. 写了什么测试（验证什么行为）
2. 做了什么最小实现
3. 是否重构，重构了什么
4. 当前测试状态（全部通过 / 哪些失败及原因）

汇报"如何验证它是正确的"，而不是只说"我完成了"。

## 命令与目录（M0 完成）

- 安装依赖：`pnpm install --frozen-lockfile`（首次生成/有意更新锁文件时用 `pnpm install`）
- 构建：`pnpm build`（`tsc -p tsconfig.build.json`，输出至 `dist/`）
- 类型检查：`pnpm typecheck`（`tsc --noEmit`）
- 全部测试：`pnpm test`（`vitest run`）
- 单个测试文件：`pnpm test -- test/placeholder.test.ts`
- 按测试名运行：`pnpm test -- -t "should run the placeholder test"`
- lint：当前未配置，不得使用或宣称存在 lint 命令。
- 当前本地检查顺序：`pnpm typecheck` → `pnpm test` → `pnpm build`；尚无 CI 配置。

当前目录与边界：

- `src/index.ts`：Cordis host 插件入口；定义 `ctx.swarmforge` 服务（Schemastery Config：`projectRoot`/`confPath`），接线 spawner/git/service/工具注册/projection/swarm队列事件/`/swarm` 命令。
- `src/protocol/`：纯协议层（零 dsh 依赖）——草稿校验、交付件格式化/解析、文件名与队列序、头部生命周期、状态机路径常量。
- `src/git/`：git 层——可注入 GitRunner（默认 node:child_process）、10hex 校验、HEAD 回填、可达性、merge_and_process、excludes ensure、worktree 生命周期、`By <role>.` commit-msg hook。
- `src/service/`：编排层（零 dsh 依赖，端口注入）——conf 解析/roster 校验、运行时目录、投递状态机（原子 rename）、序号互斥、readyForNext（task/batch）/doneWithCurrent、根 outbox 处理、审批门禁（hold/approve/reject）、clarify 文件协议、board 数据层（tasks.tsv + New Task 注入 + lane 移动）。
- `src/spawn/`：种子 prompt 构建器与 RoleSpawner（Route A′ 锚会话：ctx.agents.create 定 worktree cwd + preset join，startContinuable 稳定 childId、per-role model=、followup 经锚唤醒、重启 resume）。
- `src/tools.ts`：五个模型工具（swarm_start/swarm_handoff/ready_for_next/done_with_current/swarm_clarify），defineTool DSL，薄包 service。
- `src/projection/`：swarm/queue whole-value session 事件 + projection 注册（v2：approvals/clarifications/tasks/boxes）。
- `src/client/`：Swarm tab（conversation.view slot；Queue/Board/Boxes 三视图；动作走 remote.commands.execute）。
- `cordis.patch.yml`：单行同时装载 host 半与 client 半（dsh.client 声明 + ./client 导出）。
- `swarmforge/`：four-pack 默认编制内容（conf/constitution/roles），协议资产非代码；上游出处与适配表见 `swarmforge/README.md`。
- `test/`：Vitest 测试（protocol/git/service/spawn/tools/plugin/client 分目录）。
- `dist/`：构建产物（git ignored）；host 入口 dist/index.js，client 入口 dist/client.js。
- `.sisyphus/plans/`：移植计划与 milestone 调研记录，不是运行时代码。

测试 quirks / 前置条件：

- 单元测试不需要外部服务或环境变量；git/service 层测试使用 tmpdir 临时仓库并在 afterAll/finally 清理（AGENTS 铁律）。
- dsh 集成冒烟需要本地 `deepseek-harness` checkout；全局 `dsh` 当前未安装，可在该仓库运行 `pnpm dsh ...`；必须使用临时 `DSH_HOME`，禁止污染真实用户 profile。
- 模型驱动的 e2e（swarm_start → 角色激活 → wake → ready_for_next）需要带模型凭据的 profile，尚未运行。

## 待补全

- [x] 构建 / 测试 / lint / typecheck 精确命令，含**运行单个测试**的方法
- [x] 真实入口点与目录结构、模块边界
- [ ] CI 检查项与命令执行顺序（当前仅记录本地顺序，CI 尚未创建）
- [x] 测试 quirks（fixtures、集成测试前置条件、required services）
