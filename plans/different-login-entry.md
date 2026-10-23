# Different login entry

## Status

Done

## Goal

Allow a Task to request a new login even when a matching account is already stored, while retaining account selection across staged forms.

## Current Behavior

LoginService opens or reuses secure-entry cards for valid requests. The account selection cache retains only an account ID and expiry. Task/Worker guidance owns the decision to reuse saved credentials or collect different details. No tool parameters, public API or schema changes are required.

## Milestones

### 1. Explicit entry requests — validated

Implementation tasks:

- Remove the saved-account prompt suppression and obsolete attempted-role tracking.
- Keep selected-account continuity and explicit matching account selection.
- Update shared guidance and the tool description for different logins.

Exit criteria:

- A new flow can open private entry despite a matching saved login.
- Two saved accounts remain distinct and staged filling uses the selected account.

### 2. Verification and development deployment — validated

Implementation tasks:

- Extend the existing login integration scenario for a second account and explicit switching.
- Run focused login tests, backend build/lint and client contracts.
- Rebuild the development backend while preserving the execution desktop and private state.

Exit criteria:

- Relevant checks pass and development services are healthy.

## Tests

The existing synthetic browser/API scenario covers stored-account entry, private save, two-account selection, staged filling, rejection, transient codes and stale-field recovery.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/login.spec.ts
npm run test:e2e -- test/login.e2e-spec.ts test/client-contract.e2e-spec.ts
```

## Overall Exit Criteria

Explicit valid entry requests display a form regardless of saved accounts. Account matching and selected-account reuse remain intact; no secrets enter public messages or model tool results. Changes are committed and verified in development.

## Validation

- Passed: backend build, warning-free lint and adapter boundaries; seven login regressions and 12 login/client-contract integration cases.
- The synthetic scenario collects another account despite an existing match, saves both separately, fills the chosen account across stages, explicitly switches stored accounts and checks secret-free public outputs and persistence.
- Deployed `9e0a993` with `./scripts/dev-local rebuild`. All development services are healthy and the Tailnet PWA health check passes.
- Preserved all seven login requests, 25 inspections and 1,237,604 preview bytes. The execution desktop container ID and start time are unchanged. No frontend update or schema migration was needed.
