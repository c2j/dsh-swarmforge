# M0-1 工具链、bundle 骨架与 R5 调研结论

日期：2026-08-23

## 1. 本次落地范围

- 单包 pnpm 工程；Node `>=22`、TypeScript strict/NodeNext ESM、Vitest。
- `package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml` 插入一个 `swarmforge-host` 行。
- `src/index.ts` 是最小 Cordis object plugin：`name`、空 `inject`、`apply(ctx)`；启动时只写 `swarmforge: loaded` 日志。
- 不含协议、git、service、tools、spawn、client 等业务逻辑；未创建 `swarmforge/` 内容。

## 2. dsh bundle 与插件装载契约

### 2.1 bundle manifest / patch

- 基准 bundle 的 manifest 在 `deepseek-harness/packages/bundle/base/package.json:13-40`：ESM、`main`/`types`/`exports`/`files`，且 load-bearing 字段为 `"dsh":{"bundle":{"patch":"./cordis.patch.yml"}}`（36-40）。本包在 `package.json:5-33` 镜像该约定。
- 基准 patch 从 `deepseek-harness/packages/bundle/base/cordis.patch.yml:15` 开始使用顶层 `insert:`；每行采用 `id`、`name`、可选 `config`。patch schema 证据见 `deepseek-harness/vendor/include/src/index.ts:145-156`。
- bundle 自身入口可以不承载运行时 API：`deepseek-harness/packages/bundle/base/src/index.ts:1-9` 明确为 `export {}`；实际插件由 patch 行的 `name` 解析。
- Loader 在 `deepseek-harness/vendor/loader/src/index.ts:191-199` 用 `exports.default ?? exports` 解包模块；Cordis 在 `deepseek-harness/vendor/cordis/src/registry.ts:222-228` 接受函数、class 或带 `apply` 的 object plugin。
- 本包选择 named-export object plugin。其类型直接来自已发布的 `@deepseek-ai/cordis`，没有伪造本地类型；`pnpm-lock.yaml:10-13,24-29` 记录解析为 npm 版本 `4.0.1`。

### 2.2 `dsh plugin --profile web add <pkg>` 的行为

已完整阅读 `deepseek-harness/apps/cli/src/plugin.ts`：

- `runPlugin` 在 profile 目录执行 pnpm，并在成功后 reconciliation（`plugin.ts:120-158`）。profile 不存在时先初始化（121-125）。
- registry 包名与绝对路径原样传给 pnpm；相对 `.`/`..` 以及 `file:`/`link:` 相对 spec 会锚定到调用者 cwd，以免 pnpm 在 profile cwd 中错误自链接（`plugin.ts:93-112`）。
- git spec 也交给 pnpm；失败时 CLI 对 pnpm >=10 的 prepare/`allowBuilds` 限制给出提示（`plugin.ts:150-155`）。
- reconciliation 读取已安装 dependency 的真实包名；只有 manifest 存在 `dsh.bundle.patch` 的依赖才追加到 `dsh.profile.bundles`，否则只作为普通 dependency 并警告（`plugin.ts:36-45,59-75`）。删除 dependency 后，对应受管理 bundle 也会移除（78-87）。
- profile 路径为 `$DSH_HOME/profiles/<name>`（`deepseek-harness/packages/boot/app-boot/src/profile.ts:36,104-111`）。初始化的 `web` 模板含 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app`（114-125）；初始化会写 package manifest、空 patch 与 pnpm workspace 设置（152-168）。
- CLI 命令由 `deepseek-harness/apps/cli/src/bin.ts:29-53` 分派；实际源码入口是 `bin.ts`，不是 `index.ts`。参数定义 `deepseek-harness/apps/cli/src/args.ts:171-181` 明确 `[args...]` 原样转发给 pnpm。

因此它支持 npm registry、绝对/相对本地路径、`file:`、`link:` 和 git 依赖；安装主体是 pnpm，dsh 的额外工作是 profile 初始化和 bundle 列表 reconciliation。

## 3. 包发布与依赖策略（R5 结论）

### 3.1 发布证据

- harness 根 manifest：`deepseek-harness/package.json:2-10` 名为 `@deepseek-ai/dsh-root`、`private: true`、Node `^22.19 || >=24`；根包本身不发布。其 `dsh` 开发脚本是 `node --import tsx/esm apps/cli/src/bin.ts`（141）。
- 基准 bundle 在 `deepseek-harness/packages/bundle/base/package.json:2,41-119` 名为 `@deepseek-ai/dsh-base`，并依赖其 patch 行引用的各 dsh package。
- vendored Cordis 在 `deepseek-harness/vendor/cordis/package.json:2-25` 名为 `@deepseek-ai/cordis`、版本 `4.0.1`、ESM 入口 `lib/index.js`。
- 命令 `npm view @deepseek-ai/cordis name version dist-tags --json`：退出码 0，返回 `name=@deepseek-ai/cordis`、`version=4.0.1`、`latest=4.0.1`。
- 命令 `npm view @deepseek-ai/dsh-base name version --json`：退出码 0，返回 `@deepseek-ai/dsh-base@0.0.1-rc.1`。
- 命令 `npm view @deepseek-ai/dsh-cli name version bin --json`：退出码 1，npm `E404 Not Found`。所以不能假定 CLI 以该包名发布/可全局安装。

### 3.2 选定策略

选择：**`@deepseek-ai/cordis` 作为 peer dependency，由安装 bundle 的 dsh profile / Harness 运行时提供；开发安装由 pnpm 自动安装 peer 以支持本地 typecheck。bundle 本体可从 npm 发布后安装，也可在开发期通过本地绝对路径/link 安装。**

理由：

1. `@deepseek-ai/cordis@4.0.1` 已在公共 npm 可解析，类型导入无需依赖 harness 源码路径。
2. Cordis 是宿主类型/运行时边界，不应随第三方插件再打包一份独立运行时；peer dependency 避免双实例上下文风险。
3. `dsh plugin` 的 profile 安装流程基于 pnpm，支持 registry 和本地/link spec；`plugin.ts:36-45,59-75,93-112` 均有直接证据。
4. 本包当前 `private: true`，因此 M0 开发验证走本地绝对路径；未来发布前再移除 private 并确定版本策略，不影响 bundle contract。

不选择 `file:` 固定指向 harness checkout：这会把用户机器的绝对目录结构写进发布包，不可移植。也不选择假设所有 `@deepseek-ai/*` 都未发布：实测 Cordis 和 base 均存在 npm，但 CLI 的猜测包名不存在。

## 4. 本机 CLI 与实际安装/装载证据

- `command -v dsh` 无输出；`dsh --help` 返回 `/bin/bash: dsh: command not found`（退出码 127）：本机没有全局 `dsh`。
- harness 可运行：在 `deepseek-harness` 执行 `pnpm dsh --help`（退出码 0），输出 `plugin --profile tui add <package>` 示例。
- 为避免污染真实用户 profile，使用临时 `DSH_HOME=/var/folders/xh/8xyzggmj4jg02gnjyxwwbnb00000gn/T/opencode/dsh-swarmforge-m0-home`。
- 执行 `pnpm dsh plugin --profile web add /Users/c2j/Projects/Desktop_Projects/CODE/dsh-swarmforge`（退出码 0）：输出 profile 初始化，并安装 `dsh-swarmforge link:/Users/.../dsh-swarmforge`。
- 生成 profile manifest 的证据：`.../profiles/web/package.json:4-13` 同时含 dependency `dsh-swarmforge: link:/.../dsh-swarmforge` 和 bundles 列表中的 `dsh-swarmforge`。
- 执行 `pnpm dsh --profile web --dump-config`（退出码 0）：输出末尾包含 `# == dsh-swarmforge`、`id: swarmforge-host`、`name: dsh-swarmforge`、`config: {}`。这证明 manifest 被 reconciliation，patch 行被 profile composition 挂载。
- 额外尝试短时启动 web host 以捕获 `loaded` 日志；服务是长驻进程，自动终止脚本未获得可用日志且仅暴露了脚本自身的 timeout/bytes 处理问题。因此不把该尝试作为成功证据。M0-1 的可复现装载证据以 profile manifest + `--dump-config` 为准。

## 5. 工具链验证证据

环境：`node v22.22.0`、`pnpm 10.28.2`、`npm 11.8.0`。

- `pnpm install --reporter=append-only`：退出码 0；安装 `@deepseek-ai/cordis 4.0.1`、`typescript 5.9.3`、`vitest 3.2.7`。pnpm 报告忽略 `esbuild@0.28.2` build script；本次 Vitest 实际运行成功，因此该 warning 未阻塞当前目标。
- `pnpm typecheck`：退出码 0，执行 `tsc --noEmit`，无诊断。
- `pnpm test`：退出码 0；`test/placeholder.test.ts`，1 file passed、1 test passed。
- `pnpm build`：退出码 0，执行 `tsc -p tsconfig.build.json` 并生成 `dist/index.js` / `dist/index.d.ts`。

占位测试只验证工具链能真实发现并运行测试；本单元仅为 scaffold/config，没有业务逻辑，按任务约定不要求 Red → Green 循环。

## 6. 后续边界

- M0 后续才能按计划创建 protocol/git/service/tools/spawn/client；必须逐个 TDD 循环。
- 若进行发布 artifact 验证，应增加 `pnpm pack --dry-run` 并确认 patch、JS 与 declaration 均入包。
- 若要求进程级启动日志作为验收，应制作可控的集成 harness/生命周期测试，而不是依赖任意秒数后杀死 web server。

## 7. M0-5：dsh-facing wiring（2026-08-23）

### 7.1 真实 dsh API 证据

- continuable 子会话的宿主服务由 `deepseek-harness/packages/subagent/subagent/src/index.ts:212-238` 暴露：`startContinuable(spec): Promise<ContinuableStart>` 与 `followup(parent, childId, content, options): Promise<MessageId>`。完整参数在 `packages/subagent/subagent/src/continuation.ts:112-155`：start 需要 `provider`、`label`、可选稳定 `childId`、`request.parent/prompt`、`signal`；followup 必须持有精确 live direct-parent `Agent`，并携带 `MessageSource` 与 `AbortSignal`。
- 官方 consumer `deepseek-harness/packages/subagent/tool-subagent/src/index.ts:401-406` 证明 continuable 启动方式；`docs/subsystems/subagent.md:114-158,491-518` 说明 followup 对 running/waiting/cold-resume 的路由与 direct-parent authority。M0 使用 `provider: spawn`，角色名经 `SessionId(role)` 成为稳定 child id；wake source 为 `{ kind: 'coordinator', form: 'relay', senderSessionId: parent.id }`。
- 工具注册入口是 `deepseek-harness/packages/core/tools/src/index.ts:1037-1062` 的 `ctx.tools.register(definition)`；`packages/core/tools/src/schema.ts:483-547` 的 `defineTool` 要求 parameters、`output.schema`、`output.render` 与 async execute。真实参考 `packages/todo/tool-todo/src/index.ts:149-225`；文档见 `docs/subsystems/tools.md:9-151,408+`。
- session cwd 的真实来源是 `deepseek-harness/packages/context/agent-instructions/src/index.ts:123-125` 的 `agent.session.header.cwd ?? process.cwd()`；marker 向上查找在 `packages/context/agent-instructions/src/files.ts:176-191`。本插件 Config 提供显式 `projectRoot`，缺省时用加载进程的 `process.cwd()`；M0 的所有角色仍由 `resolveCwd` seam 固定到该 project root。
- Context service 采用 Cordis 标准模式：`Service` 构造器 `super(ctx, name)` 自动 provide（`deepseek-harness/vendor/cordis/src/service.ts:42-58`），并通过 `declare module '@deepseek-ai/cordis'` 扩展 `Context`；同型实现见 tools `packages/core/tools/src/index.ts:137-140,787-793` 与 subagent `packages/subagent/subagent/src/index.ts:129-132,171+`。

### 7.2 类型解析策略

- npm 实测：`@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-session` 均已发布；默认 latest 较旧，但 `npm view <pkg>@next version` 全部返回与本地 Harness 一致的 `0.1.1-rc.2`。`@deepseek-ai/schemastery` 为 `3.18.1`，`@deepseek-ai/cordis` 为 `4.0.1`。
- 因此未创建 ambient declarations。上述宿主边界包均以 exact `0.1.1-rc.2`（Cordis/Schemastery 用兼容范围）同时列为 peerDependency 与 devDependency：运行时由 dsh profile 提供，开发期从 npm `next` 对应版本获得真实类型与测试 runtime。
- 不使用默认 `latest`：调查确认 `@deepseek-ai/dsh-subagent@0.0.1-rc.1` 仍使用旧 `SubagentService` 名称；`0.1.0-rc.6` 又缺少当前 `ContinuableStartSpec.childId`。二者不能精确表达 M0 稳定角色 child-id 接缝。

### 7.3 已验证范围与限制

- 单元/集成层：真实 `defineTool` 生成四个工具并检查 output schema；typed fake 验证参数映射；真实最小 Cordis `Context` 挂载插件，确认 `ctx.swarmforge`、工具注册、两角色 roster、runtime 目录与两次 `startContinuable` 调用。该测试不发模型请求。
- temp-profile：使用新建的 `/var/folders/.../dsh-swarmforge-m05-home.8jiDTN` 作为唯一 `DSH_HOME`，运行 `pnpm dsh plugin --profile web add /Users/c2j/Projects/Desktop_Projects/CODE/dsh-swarmforge` 成功；随后 `pnpm dsh --profile web --dump-config` 显示 base profile 的 `subagent`、`subagent-spawn-in-process providerName: spawn`、`tools`，以及末尾 `# == dsh-swarmforge` / `swarmforge-host`。临时目录验证后已删除，未接触真实用户 DSH_HOME。
- 未执行模型驱动的 `swarm_start` e2e：临时 home 无模型凭据，且 `--dump-config` 只验证 bundle composition，不执行工具。真实 Context 测试已在无模型条件下验证插件 mount、工具 schema、conf 解析、runtime 初始化和 child start wiring；仍需有模型 key 的手工运行验证模型实际调用 `swarm_start`、wake 后调用 `ready_for_next`，以及进程重启后的 cold followup 行为。
