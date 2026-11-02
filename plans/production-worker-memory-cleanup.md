# Production Worker Memory Cleanup

## Status

Done

## Goal

Deploy the worker-result projection boundary in `cf5791b` to `pal-sf`, then compact only historical parent-message copies of screenshot-heavy worker tool results. Preserve canonical worker histories, user-visible delegation results, identifiers, timing, usage, approvals, and all unrelated message content.

## Current Behavior

- New worker delegations are projected only after the worker stream is fully materialized in the deployed `4037c65` backend. A single active run can therefore hold repeated screenshot results until it finishes.
- Production parent messages contain historical `agent-worker` tool results whose nested `subAgentToolResults` repeat canonical worker evidence. The newest affected task history serialized to roughly 431 MB during the incident investigation.
- `cf5791b` projects each completed worker result at the public `SubAgent` boundary, before parent aggregation. The no-step-limit benchmark remains stable across five repeated 90-worker cycles and reduces the representative parent record from 525.517 MiB to 0.042 MiB.

## Target Data Shape

Only Mastra message parts matching all of these conditions are eligible:

- part type is `tool-invocation`;
- `toolInvocation.toolName` is `agent-worker`;
- `toolInvocation.result.subAgentToolResults` is an array.

Each nested result becomes `{ toolName, toolCallId, isError? }`. The parent worker final text, message and thread identifiers, timestamps, roles, finish and usage metadata, approval/resume state, other parts, and worker-thread records remain unchanged. The rewrite is idempotent and processes one message per transaction.

## Milestones

### 1. Validate the bounded maintenance tool

Implementation tasks:

- Build a temporary inventory/dry-run/apply/verify tool that parses one candidate message at a time and never prints message content.
- Bind apply mode to the reviewed inventory digest and reject rows changed since inventory.
- Exercise the exact transformer with compact, mixed, malformed, already-compacted, and large synthetic records.

Exit criteria:

- Synthetic checks demonstrate exact-path compaction, idempotence, preservation of unrelated fields, and bounded one-row processing.

### 2. Publish and stage the backend release

Implementation tasks:

- Push reviewed Pal source `cf5791b`.
- Publish and verify one Linux AMD64 agent-service image from that exact revision.
- Pin only agent-service in Stack v2. Retain the web image, execution image, schema, and `PAL_RELEASE_ID=4037c65`.

Exit criteria:

- The immutable image digest is tied to `cf5791b`; tracked configuration is validated, pushed, synchronized, and ready for a targeted deployment.

### 3. Protect, deploy, and compact production

Implementation tasks:

- Capture a bounded production baseline and require idle agent work.
- Run the existing stopped-Stack state backup and confirm service recovery before changing the backend.
- Pull and deploy only agent-service with temporary `--no-deps`, then restore normal Stack arguments.
- Inventory historical candidates, review aggregate counts/bytes, apply the digest-bound rewrite one message per transaction, and verify no eligible nested heavy fields remain.

Exit criteria:

- The new backend is healthy on the reviewed digest; unrelated containers retain identity; the historical rewrite verifies cleanly; canonical worker records and public record counts remain unchanged.

### 4. Production acceptance and cleanup

Implementation tasks:

- Verify API/SSE health, bounded logs, deployed projection code, database health, and post-cleanup storage statistics.
- Remove temporary scripts, guarded plans, copied probes, and disposable build artifacts. Restore all temporary configuration.
- Record production evidence and mark the plan done.

Exit criteria:

- Production runs the boundary fix, historical parent duplication is removed, normal configuration is restored, and no task-created maintenance artifacts remain.

## Tests

- Existing focused worker projection tests and the no-step-limit repeated-memory benchmark.
- Temporary transform self-test covering exact-path selection, preservation, idempotence, malformed input rejection, and a representative large nested result.
- Production dry-run/apply/verify summaries using counts and byte totals only.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run src/agent/worker-result-projection.test.ts
npm run benchmark:worker-result-memory
```

Deployment validation uses the Stack v2 application validator and guarded Komodo operator workflow.

## Overall Exit Criteria

- New worker output is projected before parent aggregation without a hardcoded run or step limit.
- Historical parent copies retain the compact delegation contract and no longer carry nested screenshot payloads.
- Worker histories, message/thread identity, application state, web/execution releases, and schema are preserved.
- The targeted production rollout and cleanup complete with bounded, non-content-bearing evidence.

## Production Evidence

- Pal source `cf5791bf798d8eaf9971d6b4007a01105918507d` produced Linux AMD64 image `ghcr.io/koonweee/pal:cf5791b@sha256:45ab289fbebe0e3d42f5c6b778e9858fc0c3611c0348798165d1a2a6e93b9c35` in Build update `6ae91f2fc7c3aa9585152074`.
- Stack v2 revision `1249881` changes only `agent-service`. Targeted pull `6ae920a3cc8c3d5623b779d3` and deploy `6ae921a7cc8c3d5623b779fc` succeeded with temporary `--no-deps`; normal arguments are restored. Web, execution, PostgreSQL, Google MCP, Android, egress, and one-shot container identities are retained.
- Pre-cleanup stopped-Stack backup `6ae92114cc8c3d5623b779e4` produced encrypted snapshot `63b0a52c553d` with 250,023 files and 11,912,914,580 bytes, then recovered the original running service set.
- The final dry-run selected 979 canonical Task parent messages totaling 560,032,798 bytes under inventory digest `d7bf473dc3c5c298368b3e7225c52991dc3727c4d1e305290fb19e405d996d0c`. The digest-bound rewrite projected 19,337 nested items in 978 messages; strict verification reports zero remaining non-projected fields and 33,871,413 candidate bytes.
- The incident parent thread shrank from 364,926,025 to 21,245,817 stored bytes. Three sampled canonical worker threads retain their exact two-message counts and pre-cleanup stored sizes of 101,810,940, 92,731,679, and 88,002,690 bytes.
- Public counts remain 48 tasks and 2,507 messages; Mastra retains 37,747 messages. Online `VACUUM (ANALYZE)` completed with zero estimated dead tuples; PostgreSQL can reuse the relation space without an exclusive rewrite.
- Internal/public health and SSE pass, activity is idle, the deployed projection module and delegation boundary are present, and the bounded post-deploy log scan contains no fatal, uncaught, heap-OOM, or ENOMEM markers.
