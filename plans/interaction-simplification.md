# Interaction coordination cleanup

## Status

Done

## Goal

Remove the duplication and unnecessary variants found in the resource rewrite audit. Preserve FIFO turns, one device per execution, safe private targets and fencing of uncertain mutations. Development only.

## Scope

- One required application coordinator and trusted execution binding.
- Recoverable observations; fencing for uncertain mutations and late UI interaction.
- Production worker composition shared with exclusive development acceptance.
- Isolated test storage without starting unrelated application services or reconciling shared desktop files against an empty database.

## Milestones

### 1. One coordinator and device identity — Done

- Require explicit coordinator dependencies and worker configuration.
- Derive private inspection's device from trusted execution identity; remove surface callbacks and test-only ownership queries.
- Keep one Android tool catalog and service-owned batch validation; remove the unused subset parameter.

Exit: build and focused lifecycle/private-entry tests pass without fallback coordinators or duplicate device state.

### 2. Proportionate failure handling — Done

- Allow fresh observations after settled read failures and known pre-dispatch failure.
- Keep uncertain input/fill and potentially late UI interaction fenced; preserve deadlines and drain-before-handoff.

Exit: targeted regressions distinguish recoverable observations from unsafe mutations.

### 3. Production-wired development acceptance — Done

- Replace hand-composed worker runtimes with thin scenarios using production `interactionSession` composition and configuration validation.
- Give acceptance exclusive device ownership by stopping the idle dev backend for the fixture window and restoring it afterward.
- Keep isolated test storage, owned fixtures, bounded evidence and cleanup.

Exit: production-wired native contention/private entry passes, affected suites pass, temporary resources are removed and changes are committed locally.

## Tests

- Extend existing adapter regressions for failed reads versus uncertain writes; reuse existing FIFO/lifecycle coverage.
- Update existing private-tool tests to use execution binding.
- Run production-wired native desktop/phone scenarios and private entry in development, without production deployment.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test
npm run test:e2e
npm run openapi:check
```

Use the existing dev stack for bounded native acceptance.

## Validation

- `npm test`: 95 service tests pass; `npm run test:e2e`: 43 tests pass.
- Build, type-aware lint, architecture boundaries, public API contract and shell/script syntax checks pass.
- `./scripts/dev-local interaction-smoke`: strict FIFO burst, independent phone progress, cancellation settlement and private filling after an intervening turn pass on the final dev image. Single screenshot baseline: 90 ms; direct request waits 651 ms behind ten short turns.
- Final native desktop runs `07e0456c-2ed5-418b-93c8-5598ae6f3dd3` and `32c50ff5-e472-4aad-a578-76d2e0cb5318`: both headings verified, one existing tab preserved, zero leftover tabs.
- `./scripts/dev-local android-smoke`: Chrome/IANA and Settings flows pass (`9215bfef-d0a0-4d60-a21a-0bc101bd24f5`, `9d4641fb-10e8-419c-b563-f58f48d6da81`). Fresh-worker desktop-to-phone fallback passes (`761a8321-a858-4c30-b868-24cdc68bd50b`).
- A simultaneous acceptance invocation is refused while the backend is stopped for the exclusive window. Completed windows restore a healthy backend and remove their runner/database/lock.
- `./scripts/dev-local android-secure-smoke`: native/WebView helper proof and both Task-to-Worker journeys pass. Entry runs `6778eebb-b9ae-4702-bcb5-864d3f8df6ca` through `46a4bc8c-4565-4dfb-a297-65e8d226db22`; saved reuse runs `f333ee2c-d36e-4648-853c-b19c74a87182` and `cac1d525-188a-474e-a488-a5d1b92c8f97`. Credential waits release ownership; private HTTP, vault merge, OTP exclusion, production skill discovery and independent Authenticated checks pass.
- Test databases, runner containers, the owned APK, copied helper, proof images and lock are removed. Existing desktop tabs, phone accounts and persistent volumes are preserved.
- Final dev rebuild and native recheck pass. Shared services are healthy. No additional scheduling, cleanup or recovery policy is proposed.
- Docker inspection finds no disposable task images. Current service/recreation images (about 7.1 GB), persistent volumes (about 3.5 GB) and shared build cache (about 17.3 GB) are retained; no global pruning or volume deletion.

The isolated Task scenarios omit routing and task-management tools. Worker tools, model, guidance, skills, workspace, processors and finalization come from production composition. Backend integration tests cover application wiring; native acceptance covers device behavior.

## Overall Exit Criteria

- One explicit coordinator owns resource identity and admission.
- Recoverable reads do not permanently disable devices; uncertain mutations remain fenced.
- Acceptance uses production wiring and cannot compete with the normal dev backend.
- Documentation, tests and local commits match the implementation; no production changes.
