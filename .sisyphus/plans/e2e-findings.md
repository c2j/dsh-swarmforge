# Model-driven E2E smoke findings

Date: 2026-08-24 (run timestamps are UTC, beginning 2026-08-23T23:38:10Z)

## Verdict

| Acceptance item | Verdict | Evidence summary |
|---|---|---|
| a. A real-model lead calls `swarm_start`; roles become continuable children behind worktree-scoped anchors | **PASS** | Lead session log records a model-authored `swarm_start` tool call. `.swarmforge/anchors.tsv` records both anchors. The runtime snapshot records `specifier` and `coder` as continuable children, with anchor session cwds at the project root and coder worktree respectively. |
| b. One New Task wakes the real-model specifier; it writes and commits a spec with byline, then sends a git handoff that is held without waking coder | **PASS** | The specifier session records `ready_for_next` returning `tiny-spec`, reads the board card, writes `SPEC.md`, commits `cd80bc997c3fa5ea208399607aea27b394d5f565`, verifies `By specifier.`, and eventually calls `swarm_handoff` with the required 10-hex commit. The pending-approval snapshot shows the handoff present and coder inbox/new empty. |
| c. `/swarm approve` wakes coder; coder calls `ready_for_next`; merge reaches coder worktree and handoff enters `in_process` | **PASS** | Command result says the approval succeeded. Coder session records the exact wake text, model-authored `ready_for_next`, and a TASK result for `tiny-spec` with payload `cd80bc997c`. The coder worktree contains merged `SPEC.md`, HEAD is the specifier commit, and the approved handoff has `dequeued_at` in coder `in_process`. |
| Stretch: browser Swarm panel | **NOT ATTEMPTED** | Stopped after a-c succeeded, per the one-round budget rule. |

## Environment and isolation

- Plugin repository: `/Users/c2j/Projects/Desktop_Projects/CODE/dsh-swarmforge`.
- Read-only host harness: `/Users/c2j/Projects/Desktop_Projects/CODE/deepseek-harness`.
- Temporary DSH home: `/var/folders/xh/8xyzggmj4jg02gnjyxwwbnb00000gn/T/opencode/sf-e2e-home`.
- Temporary fixture repository: `/var/folders/xh/8xyzggmj4jg02gnjyxwwbnb00000gn/T/opencode/sf-e2e-proj`.
- Profile: `headless`, initialized and link-installed with `pnpm dsh plugin --profile headless add /Users/c2j/Projects/Desktop_Projects/CODE/dsh-swarmforge`.
- Effective provider/model read from the copied user settings: `deepseek-official` / `deepseek-v4-flash-vision-exp`.
- The credential provider's documented default is `~/.dsh` with `$DSH_HOME` override; its managed secret file is `$DSH_HOME/.credentials.yaml`. The real home had `settings.yaml`; credentials needed by this run were inherited shell values, so the temporary home received a newly written owner-only `.credentials.yaml` containing those authorized values. Secret contents were never printed. Sanitized file facts: `.credentials.yaml` 195 bytes mode `0600`; `settings.yaml` 165 bytes mode `0600`.
- All dsh invocations unset credential variables from the child process after copying them, forcing reads from the temporary home. No process used the real home for writes.
- Fixture roster: `specifier worktree=master`, `coder worktree=coder`; prompts were deliberately short. Initial fixture commit: `082369cbf488f73c6b55804ac2bc6208fd3af23b`.
- The ordinary headless CLI is one-shot and disposes continuable children after the lead goes idle. Therefore the run used a temporary in-process driver plus a generated profile composition with `headless-startup` and `headless-runner` disabled. This kept the Cordis tree alive while polling. Neither the harness nor its tracked files were modified.

## Timeline and evidence

The compact structured timeline is retained at `$DSH_HOME/evidence.jsonl`; durable compressed session logs are under `$DSH_HOME/sessions/`. For inspection only, they were concatenated to `$DSH_HOME/all-sessions.jsonl` with `zstd -dc`. Paths below are relative to the temporary fixture or DSH home unless stated otherwise.

### 1. Lead starts the swarm (23:38:10–23:38:12Z)

- Lead: `swarmforge-e2e-63dd5de3-1f41-41e4-bb1c-efcb6110c275`, cwd fixture root (`evidence.jsonl` lines 1-2).
- `all-sessions.jsonl:1334-1355` contains the user request, a model message from `deepseek-official/deepseek-v4-flash-vision-exp`, and tool call `swarm_start {}`.
- `evidence.jsonl:3` records children:
  - `specifier`, `mode=continuable`, parent anchor ending `-specifier`;
  - `coder`, `mode=continuable`, parent anchor ending `-coder`.
- `.swarmforge/anchors.tsv` records stable anchor IDs. `evidence.jsonl:8` records the anchor cwds: specifier anchor at the fixture root and coder anchor at `.worktrees/coder`.
- Durable logs exist separately for the lead, both anchors, and both role children under `sessions/<project-key>/<session-id>/session.jsonl.zstd`.

### 2. New Task wakes specifier (23:38:12Z)

- Commands runtime executed `/swarm new tiny-spec Write a tiny specification proving the model-driven handoff.`
- `evidence.jsonl:4`: `Created tiny-spec in specifier.` and the initial board row.
- Lead log `all-sessions.jsonl:1367-1369` records `command/run`, projection version 2 with one specifier inbox/new file, and successful `command/done`.
- Specifier log records wake text and a model `ready_for_next` call; its result is:
  `{"status":"TASK","from":"(New Task)","taskName":"tiny-spec",...}` (`all-sessions.jsonl:16,28-37`).

### 3. Real-model specifier creates and commits the spec (23:38:29–23:38:40Z)

- The specifier model reads `.swarmforge/board/tiny-spec.txt` (`all-sessions.jsonl:121-123`).
- It writes `SPEC.md` (`all-sessions.jsonl:208-236`). Final content is captured in `evidence.jsonl:5`.
- It executes `git add SPEC.md && git commit ...`, obtaining full SHA `cd80bc997c3fa5ea208399607aea27b394d5f565` (`all-sessions.jsonl:249-254`).
- It verifies the commit message contains `By specifier.` (`all-sessions.jsonl:268-275`). Independent fixture `git log` inspection confirmed the same commit body.

### 4. Handoff is held for approval (23:42:22–23:42:27Z)

- The successful model call uses protocol-required commit `cd80bc997c` (`all-sessions.jsonl:1244-1249`).
- `evidence.jsonl:5` captures the held file `pending_approval/50_20260823T234222Z_000003_from_specifier_to_coder.handoff`, including task `tiny-spec`, artifact `SPEC.md`, and commit `cd80bc997c`.
- Critically, the same snapshot has `coderNew: []`: the approval was HELD and coder was not woken/delivered before approval.
- Three earlier model calls used the full 40-character SHA or otherwise omitted required fields. They were rejected and retained as sanitized JSON under `.swarmforge/handoffs/specifier/outbox/failed/`. This was model non-compliance with the documented 10-hex protocol, not a plugin fault; the model inspected the error/protocol and self-corrected.

### 5. Approval, wake, dequeue, and merge (23:42:27–23:42:34Z)

- Commands runtime executed `/swarm approve 20260823T234222Z_000003_from_specifier`.
- `evidence.jsonl:6` records success: `Approved ... (50_..._from_specifier_to_coder.handoff).`
- Coder log records exact wake text `You have new handoff mail. If idle, run ready_for_next.` at `all-sessions.jsonl:1463-1468`.
- The next real-model message calls `ready_for_next {}` (`all-sessions.jsonl:1470-1478`). The tool returns `status=TASK`, `from=specifier`, `taskName=tiny-spec`, payload `cd80bc997c`.
- `evidence.jsonl:7` captures the approved handoff in `coder/inbox/in_process`, with `enqueued_at`, `dequeued_at`, and `approved: true`, and captures the merged `SPEC.md` from `.worktrees/coder`.
- Independent git inspection shows coder worktree HEAD `cd80bc997c3fa5ea208399607aea27b394d5f565`, proving the merge reached the target worktree.
- Final board row is `tiny-spec<TAB>coder<...>`, proving the board lane moved to coder.

## Issues observed

### Model compliance: full SHA versus protocol 10-hex

The compact fixture prompt asked for the "exact commit SHA", while SwarmForge intentionally accepts exactly 10 hex characters. The model first attempted the full SHA three times, producing failed outbox records, then inspected the implementation/error and retried with `cd80bc997c`. The accepted handoff and all downstream behavior were correct. No plugin change was made.

### Driver-launch setup errors (outside plugin runtime)

Two setup attempts failed before Cordis boot: first, `pnpm exec` was invoked from a fixture with no package manifest; second, a `.ts` scratch file outside an ESM package was treated as CommonJS and rejected top-level await. The successful invocation used the harness's absolute `node_modules/.bin/tsx` and an `.mts` driver. These are test-driver setup issues, not plugin failures.

### Session enumeration snapshot

At evidence capture, `ctx.sessions.list()` included the lead, both anchors, and the specifier child; the coder child had already settled and was represented in durable storage and `listDescendants`, rather than the final live session list. Its compressed session log contains both initial `NO_TASK` and post-approval wake/TASK turns.

## Bugs fixed

None. No plugin source was changed and no repository commit was created.

## Residual gaps

- Browser/client module loading and Swarm panel interaction were not tested; the stretch item remains deferred.
- Cold resume across process restart and distinct per-role model/provider overrides were not exercised.
- This acceptance intentionally stopped once coder received and merged the single task; coder implementation/return handoff and the full four-role cycle were outside budget.
