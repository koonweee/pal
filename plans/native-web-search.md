# Native Web Search

## Status

Done

## Goal

Task and workers research current public information through native OpenAI web search using Pal's ChatGPT login and deliver source links.

## Current Behavior

Pal uses an OAuth-backed Responses model. Task and worker tools are registered in `mastra-agent-runtime.ts`; shared execution guidance lives in `instructions/execution.md`. Publication reads structured text from model output.

## Milestones

### 1. Native search wiring

Implementation tasks:

- Register live native search for Task and workers.
- Keep server-executed search out of the TypeScript runner.
- Share research and source-link guidance across Task and workers.

Exit criteria:

- Build and targeted discovery checks pass; lint findings are reviewed for scope.

### 2. Real search and publication

Implementation tasks:

- Run an isolated OAuth search through the model adapter, discovery processor, and public output processor.
- Verify actual native search execution and source links in published text.
- Document availability and any remaining limitations.

Exit criteria:

- Real search succeeds and published answers include source URLs.

## Tests

- Extend existing discovery test to preserve native search while excluding it from code execution.
- Run existing model adapter tests.
- Add a repeatable live web-search smoke script.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npx vitest run test/task-tool-discovery.spec.ts test/chatgpt-model.spec.ts
node scripts/web-search-smoke.mjs
```

## Overall Exit Criteria

- Task and workers have native web search through existing OAuth credentials.
- Search executes directly and source links survive public delivery.
- Relevant checks and real OAuth smoke pass; no new provider credentials are required.

## Validation

- `npm run build`: passed.
- Targeted discovery and model adapter tests: 2 passed.
- Live OAuth smoke: passed with 2 native search results, 1 source event, and a published answer containing Markdown source links. Existing publication handles the links without a citation adapter.
- Type-aware lint: passed with existing warnings in the first-party preferences controller and secondary delivery dispatcher. Full `npm run lint` exits 1 because the existing Telegram driver imports two persistence implementations, outside this plan.
- No deployment performed.
