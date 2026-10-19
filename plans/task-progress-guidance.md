# Task progress guidance

## Status

Done

## Goal

Keep Main a quick conversational respondent while letting Task conversations explain substantial work through useful, casual progress updates.

## Current Behavior

- Main and Task load shared voice and texting guidance plus their role instructions.
- Main owns its 80-word budget, compact examples, and research-narration restriction. Task owns approach and progress commentary guidance.
- Task commentary appears in task chat and can feed the activity bubble. Only final answers report outcomes, questions, and blockers to Main.

## Milestones

### 1. Role-specific communication

Implementation tasks:

- [x] Keep shared tone, grouping, links, silence, and final-answer readability policies in shared guidance.
- [x] Move the ordinary answer budget and compact examples into Main guidance.
- [x] Give Tasks explicit commentary before investigations or work with several steps and meaningful stage/finding/blocker updates, with fuller explanations when useful.
- [x] Preserve final-only requests, quiet scheduled checks, private workers, and existing delivery behavior.

Exit criteria:

- Composed role prompts have one owner for each policy and no Main-specific brevity restriction in Task guidance.

### 2. Validation

Implementation tasks:

- [x] Build/lint and review all three composed role prompts.
- [x] Use isolated real-model Task fixtures without per-request update instructions, plus a compact Main answer and a final-only Task control.
- [x] Rebuild the local development stack and verify health and packaged instruction assets.
- [x] Record findings and remove exact temporary probe files.

Exit criteria:

- Model samples show useful progress, compact Main communication, and honored final-only behavior. Report variability without treating samples as a frequency guarantee.
- Development loads the reviewed guidance. No API, tools, schema, model settings, or private worker behavior change.

### 3. Main handoff scope

Implementation tasks:

- [x] Explicitly scope Main's brevity and narration rules to its own user-facing messages.
- [x] Forward task communication restrictions only when supported by user requests; prior handoff wording alone does not establish a preference.
- [x] Use recording-only real-model delegation probes for a news follow-up, a stale restricted handoff, and an explicit final-only request.
- [x] Build/lint, rebuild dev, verify packaged guidance/health, and remove exact probe files.

Exit criteria:

- News delegation retains the request and source requirements without adding Main's brevity/narration restrictions; an explicit user final-only request is retained.
- Development loads the scoped guidance; no live task history is rewritten or rerun.

### 4. Production rollout

Implementation tasks:

- [x] Push the reviewed guidance as-is and build paired Linux amd64 runtime/web images through the existing build Core.
- [x] Validate, commit, and push immutable production pins; pull and redeploy idle Pal while preserving state/settings.
- [x] Verify health, release identities, immutable image pair, and activity stream; remove exact temporary rollout plans/probe.

Exit criteria:

- Production runs the reviewed guidance and passes release/health acceptance without further prompt tuning.

## Tests

- Reuse existing public-output/activity regression coverage; no prompt-string snapshot tests.
- Inspect bounded synthetic model output for meaning, phases, correctness, and silence compliance.

## Validation Commands

```bash
npm run build --prefix backend
npm run lint --prefix backend
npm test --prefix backend -- test/public-output.spec.ts test/agent-activity.spec.ts
./scripts/dev-local rebuild
```

## Overall Exit Criteria

- Main stays brief and Tasks can explain substantial work without a shared total-word budget.
- Public commentary and result routing retain their existing contracts.
- Relevant checks and bounded model samples pass; development and documentation are current.

## Validation findings

Backend build/lint and four existing public-output/activity tests pass. Lint retains existing redundant-type warnings in unrelated tests. Composed prompts put the word budget and compact examples only in Main; Task receives progress guidance; private workers retain their existing composition.

Isolated gpt-6.1-sol/medium samples use copied instruction assets and synthetic delayed tools, with recording-only publication and no chat/database writes or personal service calls. General approach wording yielded no commentary in three short checks or a 38-second sequential investigation. Explicit commentary-phase wording yielded one approach update in two of three short checks and one in the 38-second investigation. The latter appeared after about 2 seconds, preceding six evidence reads. These small samples do not establish a production rate or guarantee intermediate updates. The final-only Task emitted no commentary; Main gave a one-sentence answer. All fixture conclusions were correct and no parser replacement appeared.

The exact temporary host probe and copied container runtime/probe are removed.

The isolated development stack is rebuilt and healthy. All three composed prompt hashes match the reviewed local build. API, desktop viewer, Vite frontend, and staged PWA health checks pass; temporary probe paths are absent.

Focused handoff probes preserve source references and confirm that Main-only brevity or narration constraints do not leak into ordinary Task delegation. Backend build/lint and private deployment health checks pass. Commentary remains model-dependent, so additional tuning is deferred.
