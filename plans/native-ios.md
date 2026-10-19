# Native iOS Reimplementation

## Status

In Progress. The retained native presentation runs on Pal's first-party contract; physical-device notification acceptance remains.

## Goal

Replace legacy installed iOS app with Pal while preserving the retained UI and interaction behavior. Copy the existing Xcode project and selectively rebuild its application layer. First release includes Main chat, Tasks with direct task chat, Settings, and push notifications.

Decisions:

- Keep task cards, archive/filter, and direct task chat through the shared conversation screen. Tapping a task opens its conversation; an Info presentation contains its goal and description.
- Omit the legacy Updates feed, Schedules screens, and action buttons. Preferences, MCP administration, desktop viewing, and Android implementation are deferred.
- The sole user deletes legacy app and installs Pal with fresh local state. Retain production bundle identity and compatible signing. No upgrade migration, reset machinery, or legacy-registration recovery is required.
- Preserve current branding and iOS 26+ support initially. Keep backend connection configuration explicit; remove legacy assistant server defaults.
- Push is a release requirement, owned jointly with [Native Notifications](native-notifications.md).
- Expose backend features only where they support a useful mobile interaction. Additional feature parity requires a concrete product need.

## Current Behavior

- Pal's native source lives in `ios/`. Its [first-party adapter plan](client-adapters.md) and [backend contract](../architecture/backend.md) cover Main/task history, messages, replies, files, tasks/archive, and live changes.
- The retained client uses SwiftUI/Observation, Swift concurrency, native navigation, Quick Look, and pinned native Markdown rendering.
- Pal owns its replay cursors, message IDs, image upload endpoints, task history, push registration, and acceptance evidence.
- The checked-in bundle IDs use the `com.example.pal` namespace; distributors select their own identifiers and signing team locally. Pal uses a fresh storage/Keychain namespace so surviving legacy entries are ignored.
- No changes to agent tools, prompts, task orchestration, or schedule semantics are planned.

## Target Data Shape

Use existing first-party message/task/file models directly, with typed Swift decoding. Core chat/task API changes are unnecessary for the agreed scope.

- Conversation identity: Main or a task UUID. Main and Task use one conversation implementation with separate drafts, pending sends, pagination, and scroll position.
- Canonical messages merge by backend ID/version and sort by sequence. Shared Task finals retain one identity across views; task commentary remains task-only.
- A durable local pending submission contains an idempotency key, conversation identity, frozen text/reply/timezone/destination payload, staged file references, returned attachment IDs, and submission outcome. Persist the final payload before issuing the message request.
- Reconcile optimistic rows using `idempotencyKey`, preserving stable presentation identity. HTTP/SSE order must not create duplicate rows.
- Server files use `POST /files` and returned attachment metadata. Stage original upload sources separately from purgeable thumbnails and Quick Look copies.
- Protected, atomically written local Codable files hold drafts, pending submissions, and bounded recent history; small settings use UserDefaults. Scope storage to normalized backend identity and conversation.
- Use a fresh Pal storage/Keychain namespace and a new installation UUID. Do not read or migrate legacy assistant state.
- Push payload and registration shapes are owned by the notification plan. The payload carries a visible preview and installation ID; every tap opens Main, and canonical messages remain backend-owned.

Proposed organization within one app target:

- `App/`: composition, connection session, navigation, lifecycle, configuration.
- `Features/Chat/`, `Features/Tasks/`, `Features/Settings/`: observable feature models and views.
- `Services/`: API transport, live synchronization, local persistence, attachments, notifications.
- `Shared/`: transport models, theme, reusable presentation components.

Use ordinary SwiftUI state, MainActor observable models, and appropriately isolated networking/file work. Introduce protocols at useful testing boundaries. Avoid speculative repository layers or a new application framework.

## Milestones

### 1. Import the presentation baseline and guidance

Implementation tasks:

- [x] Copy the Xcode project, retained views/assets, pinned dependencies, fixtures, and relevant regression tests into `ios/`. Keep the source repository unchanged.
- [x] Record import provenance; exclude local builds, credentials, provisioning artifacts, and environment data.
- [x] Copy/adapt legacy `ios/AGENTS.md` and `ios/README.md`. Fix plan links and retain native-first UI, accessibility, preview/simulator/device validation, and current interaction guidance.
- [x] Condense useful findings from legacy MVP, push, and distribution plans into current iOS documentation: Markdown layout, pagination anchoring, draft/send identity, image preparation, native previews, signing/APNs environments.
- [x] Keep implementation progress in this plan. Document current app behavior and real commands in the README; do not carry historical claims of passing tests as Pal results.
- [x] Retain the established floating page menu, avatar, glass composer, message presentation, and native controls as the accepted UI baseline.
- [x] Remove excluded screens/actions and obsolete protocol behavior as replacement slices become functional. Keep fixture composition outside production view code.
- [x] Establish build configuration without legacy assistant backend defaults. Preserve production identity; use the development variant for disposable tests.

Exit criteria:

- [x] The imported fixture app builds and the retained UI baseline is recorded on an installed simulator.
- [x] Documentation links resolve and app guidance describes the agreed scope.
- [ ] Navigation, keyboard/composer behavior, reading position, and representative Markdown/media cases match the retained baseline.

### 2. Implement Pal Main chat and local state

Implementation tasks:

- [x] Replace legacy client/models with Pal HTTP/SSE decoding, using `destinationId: "ios"` and device timezone on message submission.
- [x] Main owns its foreground stream. A presented task conversation opens a scoped stream and closes it with the screen. Each store subscribes and buffers before its snapshot and merges by entity version.
- [ ] On foreground/reconnect, refresh through each retained conversation's oldest loaded boundary, task lists, and open task details. Preserve scroll anchors; mark inactive retained views stale until refreshed.
- [x] Preserve local arrival effects for newly received foreground messages; history, reconnect recovery, and edits appear without replaying those effects.
- [x] Separate durable pending submissions from canonical history. Preserve drafts edited during sending and recover pending state after relaunch.
- [x] Offer retry only while delivery is unconfirmed; show acknowledged submissions as sent while canonical history reconciliation completes.
- [ ] Track persistence separately from agent handoff outcome: SSE reconciliation must not erase a subsequent HTTP 503 or same-key retry capability. Follow the backend's existing process-local handoff retry limits.
- [ ] Persist upload results before submission. Retry unknown upload outcomes before freezing the message payload; retain identical attachment IDs after an uncertain message submission. Handle expired unattached uploads as a definite pre-submission rejection without silently changing an uncertain request.
- [x] Preserve photo selection, grids, original-byte Quick Look/sharing, documents received from Pal, Markdown selection, and image preparation off the UI actor. Document selection is deferred unless it falls naturally within the retained picker implementation.
- [ ] Render replies with supplied summaries and view membership rules. Offer quote navigation only where a working target can be resolved.
- [x] Use fresh Pal storage keys and installation identity; ordinary subsequent launches restore Pal's own state.
- [x] Adapt the highest-value original regression tests instead of copying incompatible cursor/protocol expectations.

Exit criteria:

- [ ] Actual Swift networking works against disposable Pal for text, photos, received documents, replies, history, and reconnect.
- [ ] HTTP/SSE races, rejection, uncertain response, and relaunch retain one message identity and preserve newer drafts.
- [ ] Reconnect updates older retained rows; switching backend cannot contaminate current state.
- [ ] A clean install starts at Pal connection setup with no inherited drafts or pending inputs.

### 3. Implement lightweight Tasks and direct chat

Implementation tasks:

- [x] Use existing task list/detail/archive endpoints with pagination and version merging. Preserve cards, archive swipe/filter, and clear retry states.
- [x] Open the same conversation screen with `taskId` when a task is selected; show task title/status and an Info presentation for goal/description.
- [x] Keep per-conversation draft, pending send, and reading state across navigation; scope the task stream to its presented conversation screen.
- [ ] Apply Main/task membership rules consistently to messages and reply summaries. Share Task finals by canonical ID.
- [ ] Refetch open detail when a newer task version arrives, tracking fetched detail version separately from list version.
- [x] Keep global working activity distinct from task business status. Archiving affects list visibility and does not stop execution.
- [x] Keep omitted Updates/Schedules/action controls out of the shipped navigation and fixtures.

Exit criteria:

- [x] Main and a task can be navigated and messaged without draft/scroll leakage; task synchronization exists only while its conversation screen is presented.
- [ ] Task commentary stays task-only; finals appear in both views once; direct task input reaches its existing Task Agent.
- [ ] Archive/filter and stale-detail recovery work with actual Pal responses.

### 4. Integrate notifications and validate the clean installation

Implementation tasks:

- [x] Complete the app work in [Native Notifications](native-notifications.md): registration, permissions, suppression, bounded refresh, and Main navigation.
- [ ] Verify a clean install using the existing production identity and compatible signing; read current system notification authorization normally.
- [x] Document the cutover: delete legacy assistant, install Pal, configure its backend, and enable notifications. No application migration code is needed.
- [ ] Run representative simulator UI/accessibility checks and signed physical-device tests for private connectivity, clean installation, direct task chat, and APNs.
- [x] Adapt existing build/export documentation and scripts only as needed. Keep distribution configuration and records private.

Exit criteria:

- [ ] Both this plan and notification acceptance criteria are validated; missing device/signing/provider evidence remains explicitly outstanding.
- [ ] A clean install opens fresh Pal state and subsequent launches preserve it.
- [ ] Retained visual/interaction behavior passes representative Release-device and fixture-simulator checks.

## Tests

- Native decoding/transport integration against Pal, covering Main/task payloads, file responses, and SSE framing.
- One focused synchronization suite: subscribe-before-snapshot race, version precedence, older-page refresh, connection replacement, and shared final visibility.
- One submission suite: HTTP/SSE reordering, committed-message/503 handoff outcome, stable retry after relaunch, staged upload recovery, newer-draft preservation.
- Retained UI regressions: Markdown slow-drag/pagination anchoring, keyboard and bottom-follow, images/Quick Look, task navigation/archive, Dynamic Type and reduced motion/transparency.
- Push tests are owned by the notification plan. No agent prompt/tool changes or new model eval suite are required.

## Validation Commands

Documentation-only planning checks: local-link/template/index review and `git diff --check`.

After importing the project, from repository root:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project ios/Pal/Pal.xcodeproj -scheme Pal -destination 'generic/platform=iOS Simulator' -derivedDataPath .local/pal-derived CODE_SIGNING_ALLOWED=NO build
xcrun simctl list devices available
```

Select an available disposable simulator and run the retained unit/UI targets using `xcodebuild test`; record its exact destination and signing arguments in `ios/README.md`. Add/document a disposable Pal fixture launch command and actual Swift HTTP/SSE integration command during implementation; they do not exist yet.

Existing backend contract checks, from `backend/`:

```bash
npm run test:e2e -- test/client-contract.e2e-spec.ts test/chat.e2e-spec.ts test/files.e2e-spec.ts
```

## Progress Evidence

- The retained native presentation was moved onto Pal's transport, models, Tasks, local namespaces, fixtures, and documentation. The source project and focused full-scheme test pass on a disposable iOS simulator.
- 2026-10-10: Main optimistic chat and direct task conversation UI tests pass. Excluded Updates, Schedules, actions, legacy migration, reset, and cross-server recovery machinery are absent.
- Signed package checks cover production APNs entitlements, conversation ordering, task activity ordering, virtualized Markdown, accurate send recovery, and Read presentation. Distribution identifiers and artifact hashes remain private.

## Overall Exit Criteria

- [ ] The user can delete legacy assistant and install Pal with fresh local state, retaining the agreed UI/UX.
- [ ] Main chat, Tasks/direct task chat, Settings, attachments, and APNs work end to end.
- [ ] Existing first-party contracts support chat/tasks without legacy API compatibility code or new agent controls.
- [ ] Guidance/docs are adapted from legacy assistant and describe current Pal behavior, with traceable provenance.
- [ ] Required simulator, Swift/backend integration, and physical-device evidence is recorded. Implementation and deployment status are distinguished.
