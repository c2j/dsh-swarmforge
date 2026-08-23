# M1 Route A′ findings

Date: 2026-08-24

## 1. PoC result (performed first)

`test/spawn/anchor-poc.test.ts` mounts a real Cordis `Context`, the published agent-loop test dependencies, JSONL session persistence, `AgentLoop`, `SubagentRuntime`, and the in-process `spawn` provider. It uses a local deterministic `LlmAdapter`; no network request, model credential, or real `DSH_HOME` is involved.

The initial RED run failed because the spawn package is a named-export object plugin rather than a default export. After correcting that mounting detail, the PoC passed and proved:

1. `ctx.agents.create` creates an anchor whose durable header contains the absolute temporary worktree cwd and complete coordinator lineage (`parentSession`, `origin: subagent`, `delegationDepth`).
2. `ctx.subagents.startContinuable` with that live anchor as `request.parent` creates a child whose `session.header.cwd` equals the worktree and whose `parentSession` equals the anchor id.
3. A `composeFrom` spy is called once for the anchor setup and again by dsh's built-in child composition, proving the critical preset join path executes without requiring an agent turn.

PoC command: `pnpm exec vitest run test/spawn/anchor-poc.test.ts` → 1 file passed, 1 test passed.

## 2. dsh API evidence

All citations refer to the read-only sibling checkout `../deepseek-harness`.

- `packages/core/agent/src/index.ts:80-132` defines `CreateAgentOptions`: `sessionId`, durable `meta.cwd`/`parentSession`/`origin`/`delegationDepth`, inherited `agentOptions`, and unpublished `setup`.
- `packages/core/agent/src/index.ts:405-414` exposes `ctx.agents.create`; `:424-429` exposes `ctx.agents.resume`. Resume options and the same setup transaction are at `:139-155`.
- `packages/preset/agent-presets/src/index.ts:316-325` defines synchronous `composeFrom(agentCtx, parentCtx)`, binding the new agent to the exact standing preset composition used by its parent.
- `packages/subagent/subagent/src/child-agent.ts:102-120` constructs child session metadata: cwd is inherited at `:110`, `parentSession` is the exact parent header id at `:112`, and origin/delegation depth are stamped at `:115-117`.
- `packages/subagent/subagent/src/child-agent.ts:163-175` shows built-in child composition, including the same `composeFrom(childCtx, parent.ctx)` call at `:168` that anchor setup must mirror.
- `packages/subagent/subagent/src/continuation.ts:940-994` is cold-resume routing; authorization at `:963` requires the exact live direct-parent Agent. Consequently wake always calls `followup(anchorAgent, stableRoleChildId, ...)`, never the coordinator.
- `packages/subagent/subagent/src/continuation.ts:1048-1085` materializes continuable children through `ctx.agents.resume` or `ctx.agents.create`, preserving persisted child routing options.

## 3. Implemented contract

- Roster syntax is now `role <name> [worktree=...] [mode=...] [model=<id>] [provider=<id>]`. `model` and `provider` are non-empty opaque tokens and are passed only to `request.agentOptions`; this intentionally replaces the earlier §4.1 `preset=` proposal per the amended R1 verdict.
- Cwd resolution is: `master` → project root; `none` → project root (M1 no-worktree semantics); any named worktree → the absolute path returned by `ensureWorktree(projectRoot, name)`.
- Start order is excludes → named worktrees → commit-msg hook → runtime directories and `roles.tsv` → anchors → role children.
- Anchor ids are deterministic: `swarmforge-anchor-<coordinator-session-id>-<role>`. The owned handles are retained in `RoleSpawner` for the swarm lifetime.
- `.swarmforge/anchors.tsv` persists `role<TAB>anchor-session`. Missing state is an empty map. Existing rows are resumed with the same preset-join setup before any child start or followup can occur; new anchors are created and the complete current map is rewritten.
- Stable child ids remain the role names, preserving the M0 convention. Per-role `provider`/`model` overrides are attached to the continuable request. Wake uses the exact live anchor and the verbatim text `You have new handoff mail. If idle, run ready_for_next.`

## 4. Contract-evolution test changes

- `test/service/roster.test.ts`: the old `preset=careful` expectation represented the superseded M0/planned-preset contract. It was replaced with stronger assertions for independent provider/model parsing plus explicit empty-value rejection; no assertion was weakened.
- `test/spawn/spawner.test.ts`: M0 expected all children to be direct coordinator children at project root. The M1 replacement checks named-worktree cwd, full anchor lineage, preset-join setup, role-specific routing, persisted anchor ids, resume-before-start ordering, and wake through the exact anchor. This covers the evolved contract more deeply than the removed direct-parent assertion.
- `test/plugin.test.ts`: its temporary directory became a real temporary git repository because M1 `swarm_start` now necessarily installs the repository commit-msg hook. Typed fake `agents.create/resume` services were added because `agents` is now a required plugin dependency.

## 5. Known limitations and deferred checks

- Sandbox workspace root naturally narrows to each worktree through inherited cwd. Protocol tools remain service-layer operations and are not affected.
- One idle anchor session per role is visible in session lists.
- Credentialed checks remain manual: shell `pwd` from a model turn inside each worktree, distinct real model/provider routing, and process-level cold-resume survival.
- `ctx.shellEnv.register` / `DSH_SWARMFORGE_ROLE` was skipped in this unit. Correct agent-to-role lifetime mapping would broaden the host integration surface; the existing `roles.tsv` mapping remains the byline hook fallback. This optional quick item can be added with its own TDD cycle.
