# Shared Agent Guidance

## Status

Done

## Goal

Maintain common file rules in one shared file for Main, Task, and Worker, and execution rules for Task/Worker. Preserve role-specific routing, processing ownership, browser lifecycle, and public/private output behavior.

## Current Behavior

- files.md contains shared inspection, metadata lookup, native media limits, and original-file preservation.
- execution.md contains Task/Worker workspace courtesy, interaction-method choice, and file processing.
- agent-instructions.ts composes startup prompts for the runtime and existing smoke scripts. Worker receives private output guidance; Main and Task receive public texting guidance.

## Milestones

### 1. Extract and Wire Shared Guidance

Implementation tasks:

- [x] Extract common file and execution policies; retain role-specific responsibilities.
- [x] Use one role composer in runtime and smoke scripts to keep shared policy inclusion consistent.
- [x] Update architecture and README guidance.

Exit criteria:

- Common policies have one maintained source and are included for applicable roles.
- Main retains quick reading/delegation; Task owns worker coordination/public delivery; Worker returns private findings.

### 2. Validate Composition and Behavior

Implementation tasks:

- [x] Build, lint, format, and check modified smoke script syntax.
- [x] Reuse native Main, file-agent, and worker tests.
- [x] Run the configured-model file smoke for direct Main inspection, task/worker processing, generated delivery, memory compression, and restart.
- [x] Remove disposable validation resources.

Exit criteria:

- Shared assets ship in the build; role composition and native agent behavior remain valid.

## Tests

Reuse existing native-agent suites and the real-model file smoke. Inspect composed roles for audience boundaries; avoid tests matching prompt wording.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- test/main-session.spec.ts test/file-agents.spec.ts test/task-workers.spec.ts
npm run files:smoke
```

## Overall Exit Criteria

- All roles use shared file policies; Task/Worker use shared execution policies.
- Role-specific guidance and public/private output boundaries remain intact.
- Runtime and smoke probes compose applicable guidance through one loader; validation passes.

## Validation Results

- Backend build, type-aware lint, formatting, and diff checks passed.
- Built role composition contains shared files exactly once, restricts execution guidance to Task/Worker, and restricts public texting to Main/Task. All five modified smoke scripts pass syntax checks.
- Existing native Main/file-agent/worker coverage passed: 3 suites, 9 tests.
- The configured-model file smoke passed: direct Main PDF/image inspection, native worker verification, structured generated-file delivery, shared final/download identity, memory compression, restart, and reopening earlier files with stable output bytes.
- The disposable validation database/container and smoke filesystem were removed.

## Remaining Work

None. Milestone and overall exit criteria are validated.
