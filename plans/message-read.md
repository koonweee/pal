# Message Read Receipts

## Status

Done

## Goal

Show a subtle Read label after the latest user message in a conversation is persisted, independent of agent acceptance. Outgoing bubbles appear immediately without a pending label. Reply references are outside this scope.

## Current Behavior

ChatService emits message.added after commit. HTTP success waits for agent acceptance. The playground and native iOS derive Read from the latest committed user message in the selected conversation and recover it from history on reconnect.

## Target Data Shape

Expose nullable idempotencyKey on message snapshots and events for optimistic bubble reconciliation. Persist the submission key on user messages. Existing records have null keys. Read is derived from committed user-message presence; no separate read state or event is needed.

## Milestones

### 1. Persistence-backed Read and Playground

Implementation tasks:

- [x] Persist and expose message correlation keys.
- [x] Render optimistic user bubbles without a status label and reconcile committed messages into Read bubbles.
- [x] Document the contract and verify SSE before agent acceptance, snapshot recovery, and playground behavior.

Exit criteria:

- [x] Read appears before a delayed agent handoff completes, remains after reload/reconnect, and never appears on assistant or uncommitted messages.
- [x] Optimistic and committed copies reconcile without duplicates; failed sends retain existing recovery behavior.

### 2. Native latest-message receipt

Implementation tasks:

- [x] Select only the latest persisted user message in each Main or task conversation; suppress Read while a newer optimistic message is pending.
- [x] Render a native secondary timestamp beneath its bubble with a short fade and two-point settle; omit movement under Reduce Motion.
- [x] Cover canonical selection, acknowledged reconciliation, and visible main-chat rendering with focused native tests.

Exit criteria:

- [x] Main and task conversations share the same receipt behavior without backend changes or per-row state.
- [x] At most one accessible Read timestamp is rendered in the current conversation.

## Tests

Use the existing backend acceptance-order test and playground HTTP/SSE fixture. Native tests cover latest-message selection and one visible receipt after reconciliation. No model inference is needed for persistence and rendering behavior.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm run test:e2e -- test/chat.e2e-spec.ts
cd ../frontend-playground
npm run build
PLAYWRIGHT_CHANNEL=chrome npm test -- --grep 'read|reconciles|failed submission|delegates'
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project ios/Pal/Pal.xcodeproj -scheme Pal -destination 'platform=iOS Simulator,id=<device-id>' -only-testing:PalTests -only-testing:PalUITests/PalUITests/testMainChatSendsAndReconciles test
```

## Overall Exit Criteria

- [x] Migration, backend checks, and focused browser tests pass.
- [x] API and playground documentation describe persistence-backed Read.
- [x] Native Main and task conversations show one accessible receipt only after canonical persistence.

Validation: backend build/lint, four chat end-to-end tests, playground build, and four focused browser tests passed. The full native scheme passed 14 tests on the iPhone 18 Pro simulator; its opt-in performance benchmark was skipped. Browser tests used installed Chrome because bundled Chromium was unavailable. Screenshot inspected for playground receipt placement. Deterministic fixtures held agent acceptance and dropped SSE delivery to verify the boundaries; no model inference was needed.

Local deployment: applied the additive migration and recreated the Pal backend. Backend and playground-proxied history return HTTP 200 with the updated message shape; API and desktop services are running.
