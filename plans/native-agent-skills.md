# Native Agent Skills

## Status

Done

## Goal

Load website authentication guidance on demand through native Mastra skills. Make developer-owned feature registration repeatable without user skill configuration or a custom loader.

## Current Behavior

- Task and Worker load 744 words of login procedures in shared execution instructions for every request.
- Four login tools remain always available; their descriptions repeat workflow guidance.
- Mastra Core 1.76.0 supports agent-level filesystem skills, catalog injection and native loading tools.

## Milestones

### 1. Native registration and login skill

- Register packaged skill directories through one role map; attach skill paths to Task and Worker constructors according to that map. Main stays unchanged.
- Package `SKILL.md` files with the backend build and serve them from agent-service, independently of the execution filesystem.
- Move login procedures into website-authentication; retain brief security/routing guidance and concise tool contracts.
- Keep native skill tools direct so their instructions enter conversation context without generated code wrappers.

Exit criteria:

- Task/Worker advertise the skill, Main does not, and full instructions load only when requested.

### 2. Verification and documentation

- Verify native loading through existing processors and persistence across Task continuation/restart.
- Run focused login/runtime checks and existing dev synthetic username/password/OTP/trust, correction and picker flows.
- Record registration conventions, update architecture, and verify unchanged execution desktop and diagnostic cleanup.

Exit criteria:

- Existing login workflows pass with on-demand guidance and developer-owned registration is documented.

## Tests

- One native runtime integration scenario covers role scoping, metadata-only initial catalog, skill-tool execution, retained instructions after restart and reload in fresh context.
- Extend discovery coverage to keep skill tools native and exclude duplicate code-mode signatures.
- Reuse browser login and Task runtime integration tests; no new credential/UI contracts.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/agent-skills.spec.ts test/task-tool-discovery.spec.ts test/login.spec.ts test/task-agents.spec.ts
cd ..
python3 backend/scripts/login-latency/profile.py
```

## Overall Exit Criteria

- Four login tools and user-visible workflows remain available; full login guidance is absent from unrelated initial Task prompts.
- Future native features add a skill folder and one role registration.
- No custom skill activation state, user registry, dependency upgrade or compaction change.
- Relevant checks pass and dev synthetic acceptance is recorded.

## Validation Findings

- Backend build, type-aware lint/boundaries and 25 focused tests pass: native skills, discovery, browser/vault filling, Task runtime, login APIs and client contracts. Native integration verifies metadata-only initial prompts, full instruction loading, Main/Task/Worker scoping, retained instructions after restart, fresh-context reloading and rejection of skill-read traversal outside its directory.
- Always-loaded login guidance is 36 words (previously 744). Login-tool/schema descriptions are 291 words (previously 587). The on-demand skill is 569 words including its metadata. Main receives no new tools or guidance.
- Real dev-agent run `aea0bea0` passed all three natural-prompt synthetics: Apple-style username/password/code/trust (57.8 s, one credential form and one code form); Amazon-style wrong-password correction (57.4 s, two credential forms); ambiguous saved-account picker (31.6 s, Work selected once). Native skill loading occurred before login tools; no tool execution errors occurred. These are functional acceptance samples, not a controlled latency comparison.
- Artifacts: `.local/login-latency-detailed/` metadata and reports. Exact-host vault entries/tabs are removed, pending synthetic requests are closed, temporary hooks/files and the debugger are removed. Existing execution desktop identity/start time and normal model settings are preserved.

## Registration Convention

Add `backend/src/agent/skills/<name>/SKILL.md` with the matching frontmatter name and a trigger description. Register its receiving execution roles in `nativeSkills` in `backend/src/agent/agent-skills.ts`. Optional Markdown references live beside the skill and are included in the existing build asset glob. Mastra owns validation, catalog injection and on-demand loading. Feature operations remain ordinary application-service tools. No user registry or activation state is introduced.
