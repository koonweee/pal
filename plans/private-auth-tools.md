# Private Authentication Tools

## Status

Done

## Goal

Make private authentication a surface-bound workflow that agents can use without choosing between overlapping inspection, request, fill, and session operations.

## Current Behavior

- Ordinary browser and Android inspection can reveal a login screen but does not establish private field bindings.
- Agents choose a private inspection target and then choose between separate entry and fill tools.
- Authentication confirmation exposes an action selector for completion versus preference recording.

## Milestones

### 1. Bind Private Authentication to the Active Surface

Implementation tasks:

- Track the most recently used browser or Android surface per interaction worker in host code.
- Mark successful computer and Android actions and clear tracking during worker cleanup.
- Replace target-selected login inspection with active-surface private inspection.

Exit criteria:

- Private inspection has no surface selector and fails clearly until an ordinary interaction establishes a surface.
- Android accepts only the account origin needed for shared vault matching.

### 2. Replace Model-Facing Authentication Policy

Implementation tasks:

- Merge saved-account fill, account choice, new credential entry, code entry, and card entry behind one private entry tool.
- Replace session actions with one authentication confirmation tool.
- Remove superseded tools and update worker guidance and architecture documentation.

Exit criteria:

- Interaction workers receive only `inspect_private_fields`, `enter_private_fields`, and `confirm_authentication` for private authentication.
- Host code chooses automatic fill, picker, or private entry from current state.

### 3. Validate the Replacement

Implementation tasks:

- Update focused tool, surface-binding, Android, and login workflow tests.
- Run backend build, lint, and the smallest relevant integration and end-to-end suites.

Exit criteria:

- Targeted regression tests cover active-surface inference and automatic private-entry fallback.
- Relevant checks pass and the implementation is committed locally.

## Tests

- Tool schemas expose no target, account ID, or action selector.
- Successful computer and Android actions select their respective private-inspection surface.
- Missing, ambiguous, saved, code, and payment inputs route to entry, picker, or fill deterministically.
- Confirmation completes an active flow or records an explicit browser preference when no flow exists.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

## Overall Exit Criteria

- Agents cannot mistake ordinary inspection for private inspection or select the wrong private destination.
- Existing browser and Android private-entry, vault reuse, picker, and persistence behavior remains available through the smaller toolset.
- Current documentation and guidance describe only the replacement abstraction.
