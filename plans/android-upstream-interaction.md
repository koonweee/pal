# Android upstream interaction

## Status

Done. Development implementation and device acceptance pass; Amazon diagnostics are reviewed in the [results report](android-browser-computer-benchmark-results.md#upstream-owned-android-rerun).

## Goal

Use Mobile MCP for ordinary Android interaction, retain the helper only for private fill, and rerun signed-in Amazon retrieval with useful evidence.

## Current Behavior

Mobile MCP owns ordinary observations, refs, actions and results. Pal selects its schemas, binds one device and serializes worker access. The helper owns private field inspection/validation/fill; ordinary navigation stays within upstream. Screenshots and visible UI text are unmasked. See the [evaluation](android-browser-computer-benchmark-results.md#android-tooling-evaluation) for the motivating evidence.

## Milestones

### 1. Dependency-owned navigation — complete

- Load selected upstream tool schemas; bind the configured device and preserve observations, refs, results and errors.
- Add upstream clipboard, swipe controls and batching within the same selected tool set.
- Remove ordinary helper observation/resolution and switch automation only at private-fill boundaries.
- Keep secret submission private; permit unmasked upstream observations of visible UI.
- Update shared recovery guidance and Android procedure.

Exit criteria validated: backend build/lint, adapter ownership/handoff test, Android private-entry integration, helper transport and benchmark protocol tests pass. Helper APK compiles. Repeated ordinary inspection uses upstream without private helper calls. Native and WebView device proof passes all credential stages, stale-reference rejection, Unicode, upstream ref taps and clipboard restoration.

### 2. Device acceptance and Amazon retrieval — complete

- Verified synthetic native/WebView fill and return to upstream, clipboard restoration, batching, positioned swipe and screenshots. Real Task/worker private HTTP entry and saved-vault reuse both pass.
- Rebuild the existing dev stack; preserve app data and sessions.
- Run Amazon product retrieval before further repetitions, then signed-in order retrieval. Keep human-required work separate.
- Record results, limitations, timing and cleanup; commit scoped changes.

Exit criteria validated: device transition checks pass. Amazon order retrieval completes in 45 seconds. Two product attempts return in about 200 seconds: one partial and one complete with a confirmed, reversed Shopping List mis-tap. Evidence and limitations are recorded; no human-dependent flow ran.

## Tests

- Adapter integration: upstream schemas/results, worker ownership, private handoff, batch device binding and no replay after lost responses.
- Existing private-entry service regression and synthetic phone proof.
- Real Task/interaction-worker Amazon product and order flows.

## Validation Commands

```sh
cd backend
npm run build
npm run lint
npx vitest run test/android.spec.ts
node --test android/helper-client.test.mjs
```

## Overall Exit Criteria

Ordinary interaction uses upstream; private fills retain current-target and private-delivery guarantees. Dev device checks and Amazon reruns are documented honestly, with task resources cleaned up. No production deployment.

## Remaining findings

Reproduce the upstream Share-ref mis-target independently before choosing a fix. Treat missing accessibility content as inconclusive until visual inspection. The diagnostic sample is insufficient to change global method priority.
