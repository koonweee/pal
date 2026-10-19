# Repository Guidelines

## Project Structure

- `backend/`: NestJS API, with application code in `src/` and end-to-end tests in `test/`.
- `architecture/backend.md`: backend architecture, API contracts, and data models.
- `plans/`: implementation plans, milestone scope, exit criteria, and validation.

## Engineering Principles

- Follow YAGNI. Keep things simple and implement only what current requirements need. Any added complexity must have a concrete justification.
- Aggressively minimize model-facing controls: tools, parameters, output fields, and instructions. Expose a choice only when a current requirement needs model judgment. Keep deterministic policies and defaults in host code, and remove redundant options so the model stays focused on the task.
- Keep Main a fast conversational router. Prioritize prompt acknowledgments, answer from available context, and delegate external-service calls and extended work so Main stays responsive to new messages.
- Prefer primitives and supported workflows from our dependencies. Build custom logic only when a concrete requirement justifies it, and document the gap it addresses.
- Follow the rule of three. When a pattern repeats in three places, consider an abstraction; do not introduce one speculatively or automatically.
- When adding or updating worker or other agent guidance, compare existing role prompts and evaluate whether equivalent rules belong in a shared instruction file for maintenance. Share policies that apply to all receiving agents; keep role-specific responsibilities and capability guidance separate. Load shared files only for applicable roles and maintain one source for each shared policy.
- Keep the test set as small as possible. Focus on essential behavior, avoid redundant tests, and add targeted regression tests when actual bugs are found.
- Documentation must reflect the current state. Avoid wording that reads like a change log.
- Keep documentation brief and direct. State things as they are; avoid contrastive caveats such as "it's X, not Y".
- Keep interface copy concise. Do not add helper text that restates a label, selected value, visible behavior, or persistence implied by a setting. Add supporting text only for non-obvious consequences, constraints, validation, safety, or required setup.
- Replace superseded internal subsystems when a clean implementation around current requirements is simpler. Preserve user-visible workflows and correctness guarantees, then remove obsolete modules, internal APIs, dependencies, tests, and compatibility layers with the replacement.
- Add an abstraction only when it removes concrete duplication, enforces an invariant, or isolates an external integration. A hypothetical future consumer is insufficient.
- Keep one owner for each state and policy. Do not add configuration for features, deployment modes, or variants that are not implemented.

## Planning

- Start implementation plans from [plans/template.md](plans/template.md) and register them in [plans/index.md](plans/index.md).
- Organize work into milestones with concrete tasks, milestone exit criteria, overall exit criteria, and a minimal test set.
- Keep plan status and remaining work accurate. Mark work done after its exit criteria are validated.
- Keep milestone scope, deferred work, and implementation progress in plans. Keep architecture documentation focused on system structure and contracts.
- At the end of every implementation spike that changes agent tools or guidance, include a short table in the user-facing completion report with columns for the tool/guidance, what changed, affected agent (Main/Task), and availability (always on, discovered on demand, removed, or guidance only). Keep entries brief; the user can ask for details.

## Build, Test, and Development Commands

Run the integrated local development stack from the repository root with `./scripts/dev-local`:

- `up`: start the isolated development stack. Frontend source changes use Vite hot reload and need no restart.
- `frontend-restart`: refresh the frontend container after frontend dependency changes.
- `rebuild`: rebuild the stack after backend, agent-guidance, desktop, package, or system dependency changes.
- `serve`: expose the staged production PWA over Tailscale when Tailnet access is requested. Use `unserve` to remove the script-managed route.
- `pwa-up`: rebuild the staged production PWA after frontend-only changes and notify connected clients that an update is available.
- `status`, `logs`, and `down`: inspect or stop the stack.

Use `pwa-up` only after `serve` has configured the staged PWA and the running backend supports the current frontend update contract. Use `rebuild` when backend or API changes are part of the update.

Use `npm` and run these commands from `backend/`:

- `npm install`: install dependencies.
- `npm run start:dev`: start the API with hot reload.
- `npm run build`: compile the backend.
- `npm run lint`: run Oxlint with type-aware checks.
- `npm test`: build and run PostgreSQL-backed service integration tests.
- `npm run test:e2e`: build and run the PostgreSQL-backed end-to-end suites.
- `npm run format`: intentionally format source and tests.

Run checks relevant to the change. Use targeted tests when possible.

Use `npm` and run frontend commands from `frontend/`:

- `npm run dev`: start Vite with hot reload.
- `npm run check`: run strict application and test TypeScript checks.
- `npm run test:unit`: run focused Vitest component and policy tests.
- `npm test`: run Playwright browser behavior tests.
- `npm run test:pwa`: build and run production PWA checks.
- `npm run check:ui`: enforce focused frontend ownership rules.
- `npm run trim`: find unused frontend files, exports, and dependencies.

## Coding Conventions

- Follow the existing TypeScript, ESM, NestJS, and formatting conventions.
- Use feature folders and conventional filenames such as `chat.controller.ts`, `chat.service.ts`, and `chat.repository.ts`.
- Prefer explicit types and fix type mismatches at their source.
- Controllers and agent adapters call application services. Services own business rules and transactions; repositories handle persistence.

## Commits and Pull Requests

- Commit completed work at coherent boundaries after relevant checks pass and documentation is updated, unless the user requests otherwise.
- Keep each commit focused on the current task. Preserve unrelated edits and staged changes; stage individual hunks when files contain work from multiple tasks.
- Review the staged diff before committing to confirm scope and exclude credentials, local data, and unintended generated output.
- If checks fail because of unrelated existing work, document the failures and validate the changed scope before committing.
- Commit locally; push or deploy only when requested.
- Use concise Conventional Commit-style subjects, such as `feat(chat): add message history`.
- Describe the resulting behavior, relevant API or migration changes, and validation performed.

## Configuration

- Document configuration in `.env.example` as it is introduced.
- Keep credentials, local environment files, uploaded files, and database data out of version control.

## Local Skills

- [explain-agent-harness-scenarios](.agents/skills/explain-agent-harness-scenarios/SKILL.md): Use to align on expected agent flows before implementation or explain implemented behavior through user scenarios, separating code guarantees from model judgment.
