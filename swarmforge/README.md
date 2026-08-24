# swarmforge/ — ported four-pack roster (provenance & adaptations)

This directory is the default SwarmForge roster example shipped with the
`dsh-swarmforge` plugin repo. It is a **content port** (text only, no code)
of upstream `unclebob/swarm-forge` protocol prompts, adapted to the dsh
tool-call model documented in `.sisyphus/plans/swarmforge-port.md` §4
(especially §4.1 conf format and §4.7 injection rules).

No constitutional rules, role duties, or protocol semantics were invented.
Every wording change below is mechanical: a shell-script call renamed to a
dsh tool call, or an upstream tmux/pane/dashboard-launch reference adapted
to the dsh Web UI equivalent. Where upstream content could not be verified
at the pinned commit, it was omitted rather than fabricated (see
"Known upstream gap" below).

## Upstream sources (pinned by commit SHA)

| Our file | Upstream branch@SHA | Upstream path |
|---|---|---|
| `constitution/articles/engineering.prompt` | `main@4f19ed052b4b71a39c290bf721ff833ee4b6983d` | `swarmforge/constitution/articles/engineering.prompt` |
| `constitution/articles/handoffs.prompt` | `main@4f19ed052b4b71a39c290bf721ff833ee4b6983d` | `swarmforge/constitution/articles/handoffs.prompt` |
| `constitution/articles/workflow.prompt` | `main@4f19ed052b4b71a39c290bf721ff833ee4b6983d` | `swarmforge/constitution/articles/workflow.prompt` |
| `swarmforge.conf` | `four-pack@615a08365a861f936395315624e1e5ef3b312466` | `swarmforge/swarmforge.conf` (reformatted, see below) |
| `constitution.prompt` | `four-pack@615a08365a861f936395315624e1e5ef3b312466` | `swarmforge/constitution.prompt` (verbatim) |
| `constitution/articles/project.prompt` | `four-pack@615a08365a861f936395315624e1e5ef3b312466` | `swarmforge/constitution/articles/project.prompt` |
| `roles/specifier.prompt` | `four-pack@615a08365a861f936395315624e1e5ef3b312466` | `swarmforge/roles/specifier.prompt` |
| `roles/coder.prompt` | `four-pack@615a08365a861f936395315624e1e5ef3b312466` | `swarmforge/roles/coder.prompt` |
| `roles/refactorer.prompt` | `four-pack@615a08365a861f936395315624e1e5ef3b312466` | `swarmforge/roles/refactorer.prompt` |
| `roles/architect.prompt` | `four-pack@615a08365a861f936395315624e1e5ef3b312466` | `swarmforge/roles/architect.prompt` |

Fetched via `https://raw.githubusercontent.com/unclebob/swarm-forge/<sha>/<path>`
on 2026-08-23; SHAs verified live against `unclebob/swarm-forge` branch refs
at fetch time (`main` HEAD was `7c1d1c9422046e9be40108c64c255f8dd142d0b5`,
`four-pack` HEAD was `615a08365a861f936395315624e1e5ef3b312466` — matches
the pinned SHA exactly, i.e. `four-pack` tip).

### Known upstream gap: `local-engineering.prompt` / `local-workflow.prompt`

The task brief called for porting
`swarmforge/constitution/articles/{local-engineering,local-workflow}.prompt`
from the `four-pack` branch. **Both return 404 at the pinned SHA
`615a08365a861f936395315624e1e5ef3b312466`.** Verified via the GitHub API
recursive tree listing for that commit: `swarmforge/constitution/articles/`
contains only `project.prompt`. History check explains why:

- `local-engineering.prompt` and `local-workflow.prompt` existed transiently
  earlier in `four-pack`'s history but were deleted by upstream commit
  `c55bff02dc97c1d76392234d813ea68d26629e8e` ("Remove redundant local
  engineering article", 2026-06-14) after commit
  `cd58d04d4c7724d139b98db4cfd42464f675a694` ("Use shared engineering and
  workflow articles") consolidated their content into the shared
  `engineering.prompt` / `workflow.prompt` articles that now live on `main`
  (the same three files we already port from `main` above).
- The `four-pack` branch HEAD (`615a0836…`) is exactly the pinned SHA — i.e.
  this is not a stale checkout on our part, it's the current tip.

Per the task's "do not invent content" and "do not fetch from branch names
without SHAs" constraints, **we did not fabricate replacement content for
these two files.** Our port ships 4 constitution articles
(`engineering`, `handoffs`, `workflow`, `project`), not 6. `constitution.prompt`'s
instruction to "read and obey every file in `swarmforge/constitution/articles/`"
is directory-driven and works correctly with 4 files.

This gap should be flagged to the plan author/Momus for the plan's §4.7 /
directory-listing text to be corrected in a follow-up.

## conf format conversion (plan §4.1)

Upstream `four-pack` conf:

```
# Format: window-invisible <role> <agent> <worktree> [task|batch] [extra-cli-args...]
window-invisible specifier codex master --yolo
window-invisible coder codex coder --yolo
window-invisible refactorer codex refactorer --yolo
window-invisible architect codex architect batch --yolo
```

Ours (`swarmforge/swarmforge.conf`):

```
role specifier worktree=master
role coder worktree=coder
role refactorer worktree=refactorer
role architect worktree=architect mode=batch
```

The `agent` field (`codex`) and CLI flags (`--yolo`) are dropped: roles run
as in-process dsh continuable sub-agents, not spawned external CLI
processes (plan §4.1 decision D3). Per-role model/tool selection is
available via an optional `preset=<preset-id>` field but omitted here to
use defaults, per the task brief.

## Adaptation table (upstream literal → our replacement → reason)

All role-prompt and article adaptations below are mechanical renames/drops
required by the tool-call model (plan §4.7); no protocol semantics changed.

| Upstream literal | Our replacement | Reason | Files affected |
|---|---|---|---|
| `swarm_handoff.sh <draft-file>` (write draft under `./tmp/`, then run script) | Call the `swarm_handoff` tool with fields (`type`,`to`,`priority`,`task`,`commit`/`message`) as arguments | No shell script / draft file in dsh; fields are passed as tool call arguments (plan §4.2) | `handoffs.prompt`, all 4 `roles/*.prompt` |
| `ready_for_next.sh` | `ready_for_next` tool | Script → in-process tool call (plan §4.4) | `handoffs.prompt`, `workflow.prompt`, all 4 `roles/*.prompt` |
| `done_with_current.sh` | `done_with_current` tool | Script → in-process tool call (plan §4.4) | `handoffs.prompt`, all 4 `roles/*.prompt` |
| `pack_dashboard_request.sh clarify ./tmp/question.txt` | Call the `swarm_clarify` tool | Script → in-process tool call; matches plan §4.5 async Clarify queue | `handoffs.prompt` |
| CLI verb "prints" (e.g. "if it prints `TASK: <path>`") | "returns" | Tool calls return structured results, not stdout (plan §4.4 "返回结构化结果") | `handoffs.prompt`, `roles/architect.prompt` |
| "the helper" (noun for the above scripts) | "the tool" | Consequence of script→tool rename | `handoffs.prompt` |
| `merge_and_process <sender> <sha>` / `merge_and_process.sh <sender> <commit>` | **kept verbatim** | Per task brief: `ready_for_next` executes the merge automatically; the protocol body text describing this is not rewritten. See note below. | `handoffs.prompt` (unchanged, documented here only) |
| "in the pane" / "ask ... in the pane" (tmux pane reference for informal human contact) | "in your session" / "the Swarm panel in the dsh Web UI" (context-dependent) | No tmux pane in dsh; the equivalent async review surface is the Swarm panel's Attention/Clarify queues (plan §4.5, M2) | `handoffs.prompt`, `roles/specifier.prompt` |
| "the operator uses Attention" | kept verbatim ("Attention queue in the Swarm panel of the dsh Web UI") | "Attention" already matches our own plan's M2 terminology (§6) | `handoffs.prompt`, `roles/specifier.prompt` |
| "Do not send tmux notifications directly." | "Do not attempt to notify or wake other roles directly; only the `swarm_handoff` tool triggers delivery and wake-up." | No tmux transport in dsh; intent (don't bypass the protocol) preserved | `handoffs.prompt` |
| "If a tmux wake-up arrives while already working on a task, ignore it." | "If a followup wake-up arrives while already working on a task, ignore it." | dsh's wake mechanism is `followup` (plan §4 decision D4: "唤醒只是敲门") | `handoffs.prompt` |
| "Do not run `./swarm` from an agent worktree to repair helper scripts. If handoff helper scripts are missing from PATH, stop and report the startup failure." | "Do not attempt to repair swarm tooling yourself. If a swarm tool (`ready_for_next`, `done_with_current`, `swarm_handoff`) is unavailable, stop and report the startup failure." | No `./swarm` launcher or PATH-resident scripts in dsh; tools are always part of the role's toolset or absent | `workflow.prompt` |
| "shared scripts under `swarmforge/scripts/`" | "rely on the in-process `swarm_handoff`/`ready_for_next`/`done_with_current`/`swarm_clarify` tools for delivery (no `swarmforge/scripts/` directory in this port)" | No scripts directory exists in the dsh port; `.swarmforge/` and `.worktrees/` paths are otherwise unchanged (plan §3) | `constitution/articles/project.prompt` |
| `swarm_handoff.sh` rejects drafts in `/tmp` and `.swarmforge/handoffs/outbox/tmp/` | **dropped** | Draft-file location rules are moot; there is no draft file | `handoffs.prompt` |
| `swarm_handoff.sh --help` prints usage. Do not pass `--help` as a draft path. | **dropped** | CLI-flag-specific; not applicable to a tool call | `handoffs.prompt` |
| "After a successful send, the helper removes the draft file. If you need to remove a stale draft manually, use `rm <draft-file>`, not `rm -f`." | **dropped** | No draft file exists to remove | `handoffs.prompt` |
| "Write handoff drafts in `./tmp/` as well." | **dropped** | No draft file to write | `workflow.prompt` |
| "Do not type a SHA or `SWARMFORGE_ROLE`." | "Do not type a SHA." | `SWARMFORGE_ROLE` is an upstream shell env var with no dsh equivalent; the `swarm_handoff` tool has no such field to mistype | all 4 `roles/*.prompt` |
| `swarm_tool.sh require/ensure <tool>` (APS tool bootstrap, `engineering.prompt`) | **kept verbatim, untouched** | Unrelated to the handoff/dispatch protocol — it is upstream's own dev-tool installer for CRAP/mutation/DRY tooling, out of scope for this port | `engineering.prompt` |
| "Project language: Babashka." (`project.prompt`) | **kept verbatim** | This describes the *upstream fixture project's* language, not `dsh-swarmforge` itself (which is TypeScript). Kept for fidelity to the four-pack example; a real project adopting this roster edits this line for its own language. | `constitution/articles/project.prompt` |

### Note: `merge_and_process` is automatic

Every place `handoffs.prompt` says `ready_for_next` (formerly
`ready_for_next.sh`) "merges the inbound commit
(`merge_and_process.sh <sender> <commit>`)" is describing real, current
behavior of our `ready_for_next` tool: per plan §4.4, the tool performs the
`merge_and_process` step automatically as part of dequeuing a `git_handoff`
before returning the task to the model. The model never invokes
`merge_and_process` itself in either the upstream or the ported protocol —
this note simply makes explicit that the sentence is still accurate,
unchanged, in our tool-call world.

## Directory layout produced

```
swarmforge/
  swarmforge.conf
  constitution.prompt
  constitution/articles/
    engineering.prompt      (from main)
    handoffs.prompt         (from main)
    workflow.prompt         (from main)
    project.prompt          (from four-pack)
  roles/
    specifier.prompt
    coder.prompt
    refactorer.prompt
    architect.prompt
  README.md                 (this file)
```

Flow: specifier (master worktree) → coder → refactorer → architect
(batch receive mode) → specifier.
