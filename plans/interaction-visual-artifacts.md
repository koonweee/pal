# Interaction Visual Artifacts

## Status

In Progress

## Goal

Keep unlimited interaction turns while preventing completed screenshot payloads from accumulating in the active Mastra run. Preserve each image in Pal file storage and hydrate only the newest image for the next model request.

## Current Behavior

- Mastra stores visual tool results and their cached `toModelOutput` media in the live message list.
- `ToolCallFilter` removes older visual results only from provider prompts; it does not release the active run's stored base64 values.
- Production retained large-object space across three concurrent visual workers until the 4 GiB V8 heap limit was reached.

## Target Data Shape

Completed visual tool results contain a small `pal-image-artifact:<attachment-id>` marker plus their non-image text and metadata. The corresponding PNG/JPEG bytes use the existing private attachment store and its cleanup policy.

## Milestones

### 1. Externalize completed visual results

Implementation tasks:

- Add an interaction input processor that saves raw visual result bytes before the next model step.
- Replace image values in the live message list, cached model output, and completed-step copies with artifact markers.
- Transiently hydrate only the newest marker in `processLLMRequest`.

Exit criteria:

- Active history and completed steps contain no historical base64 screenshots after the next input step.
- The next provider request still receives the newest screenshot.

### 2. Validate and roll out

Implementation tasks:

- Add focused processor tests and run backend build/lint.
- Run a repeated visual-result regression in development.
- Deploy the agent-service image, stagger interrupted-task nudges, and observe heap, RSS, and large-object space.

Exit criteria:

- Automated checks pass and production stays healthy while resumed tasks work.
- Memory does not ratchet toward the V8 limit during the observation window.

## Tests

- Externalize computer, Android, and private-field image shapes.
- Remove duplicate raw bytes from cached model output and completed steps.
- Hydrate only the newest artifact in a cloned provider prompt.

## Validation Commands

```bash
cd backend
npm run build
npx vitest run test/interaction-tools.spec.ts
npm run lint
```

## Overall Exit Criteria

- Interaction workers retain unlimited turns and complete non-image tool evidence.
- Raw screenshot bytes leave active Mastra history after one tool/model boundary.
- Production task resumption remains below the configured memory limits without a new crash.
