# M3 Findings

## Board persistence and lifecycle

- `.swarmforge/board/tasks.tsv` has no header. Every non-empty row is exactly `name<TAB>lane<TAB>created_at<TAB>updated_at`; bodies remain separate at `.swarmforge/board/<name>.txt`.
- Task names use the roster-compatible lowercase kebab-case alphabet and are capped at 80 characters. Lane validation always uses the active roster.
- New tasks start in the roster role whose `worktree` is `master`. Creation writes the card before placing a priority-50 `(New Task)` note in the project-root outbox; the existing root-outbox processor performs recipient stamping, delivery, archival, and wake.
- A successful handoff with an existing card moves that card to the first recipient lane. This is deliberately a thin post-delivery hook; handoffs without cards retain M2 behavior.
- `deleteTask` is exposed and tested, but automatic completion is intentionally not attached to `doneWithCurrent`. Whether a return to the master lane represents review, rework, or completion is content/policy-specific and cannot be inferred reliably from the queue transition alone.

## Projection and client decisions

- The whole-value `swarm/queue` contract is version 2: `{ approvals, clarifications, tasks, boxes, version: 2 }`. The fold remains last-wins; projection `stateVersion` is also 2 so persisted v1 state is not decoded as v2.
- Task bodies are **not embedded** in the projection. Cards contain only name, lane, and updated timestamp; card selection executes `/swarm task <name>` through the existing `remote.commands.execute` action channel. This keeps routine projection events small while preserving durable bodies as file-backed facts.
- Queue box data is embedded because counts and pending filenames are small at swarm scale and needed together for a read-only overview. Each role carries inbox/outbox counts plus pending filenames.
- Existing M2 host surfaces were reused without a new harness API: `session.append('swarm/queue', snapshot)`, `ctx.sessionProjections.register`, `ctx.commands.register`, `conversation.view`, and `ctx.remote.commands.execute`. API provenance remains the M2-b citations in `m2-findings.md`; M3 touched no new harness surface.

## Manual verification checklist

1. Load the bundle in a credentialed local dsh web profile with a temporary `DSH_HOME`; start a four-pack swarm.
2. Confirm the Swarm tab exposes Queue, Board, and Boxes toggles and preserves pending approval/clarification actions.
3. Create a kebab-case task from Board; confirm the card appears in the master/specifier lane and the role wakes with a New Task note.
4. Click the card and confirm `/swarm task` returns multiline body text without a model turn.
5. Send/approve a handoff and confirm the card moves to the first recipient lane while Boxes counts/files update.
6. Use the card lane selector and verify `/swarm move` updates the board immediately.
7. Confirm `/swarm inbox <role>` and `/swarm outbox <role>` return the same counts and pending filenames shown in Boxes.
8. Restart the host and confirm cards/bodies persist and the next version-2 snapshot reconstructs Board and Boxes.
9. Complete the content-level workflow manually; delete the card explicitly when the team decides it is complete.
10. Confirm `dist/client.js` remains below the 150 kB target and that the existing module-loader compatibility caveat from M2-b is resolved or observed in the real host.
