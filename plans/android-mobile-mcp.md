# Android Mobile MCP

## Status

Done

## Goal

Operate the owner's USB Android phone through Pal interaction workers, using one Mobile MCP and ADB sidecar in development and Linux production.

## Current Behavior

Task owns service MCP discovery. Interaction workers own browser/computer and configured Android workflows. The Mac development stack forwards the selected USB phone through OrbStack to container ADB. Stack v2 owns production USB passthrough and deployment wiring.

## Milestones

### 1. Container and USB access — validated

Implementation tasks:
- Add a locked Mobile MCP image with ADB, persistent authorization, authenticated HTTP, and optional Compose overlay.
- Add dev-local Android setup/status/reconnect/down commands using OrbStack passthrough and a single selected USB device.

Exit criteria:
- Container ADB sees the phone. MCP inspection and screenshot work. Ordinary Pal startup remains independent of phone readiness.

### 2. Worker integration — validated

Implementation tasks:
- Add the Android MCP integration, configured device binding, limited upstream tools, native images, serial calls, and worker ownership/cleanup.
- Share method-selection guidance across Task/Worker and add worker-only Android procedures.

Exit criteria:
- Focused tests cover binding/tool scope, images, contention, failure, cancellation, and reconnection. Build and lint pass.

### 3. Development acceptance — validated

Implementation tasks:
- Rebuild the existing development backend and run two read-only Android app workflows through the worker harness.
- Verify container replacement preserves ADB authorization. Document operational commands and deployment wiring.
- Remove disposable probes and build artifacts; preserve development state and active image tags.

Exit criteria:
- Two actual model-driven workflows return verified results. Checks pass and the scoped changes are committed locally.

## Tests

One Android MCP fixture suite for the integration invariants; existing worker lifecycle and skills suites; live USB/MCP and two model-driven flows. No real messages, purchases, or app-data resets.

## Validation Commands

```sh
./scripts/dev-local android-up
./scripts/dev-local android-status
cd backend
npm run build
npm run lint
npm test -- test/android.spec.ts test/task-workers.spec.ts test/agent-skills.spec.ts
cd ..
./scripts/dev-local android-smoke
```

## Overall Exit Criteria

Development uses container ADB, tools belong to Worker, one worker owns the configured phone at a time, native screenshot media reaches the model, app/authorization state survives replacement, and documentation describes the tested setup. Stack v2 production rollout remains separate.

## Validation Results

- Backend build and type-aware lint pass. Seven focused integration files pass all 16 tests; the Android fixture also verifies lost-response handling without mutation retries and subsequent reconnection.
- ARM64 sidecar controls the Samsung phone through container ADB. Linux AMD64 image builds and passes MCP initialization, ADB, and mobilecli startup checks.
- `./scripts/dev-local android-smoke` passes both real Task-to-Worker flows: Chrome follows the example.com link to IANA and verifies the destination heading with an image; Settings reads Galaxy A37 5G (SM-A376U) and Android 17 with image evidence. Container ADB properties independently confirm model/version.
- Sidecar replacement preserves the newly authorized ADB key. USB detach/attach exercises changed Linux device numbering and the reconnect helper. Physical cable replug and production rollout remain separate acceptance work.
- Scratch databases, copied smoke scripts, USB/build probes, the AMD64 validation image, and temporary ADB rollback keys are removed. The active development sidecar image (~520 MB), authorization state (~20 KB), and USB probe helper image (~6 MB) are retained for ongoing development. Shared development images, volumes, and build cache are preserved.
