# Native Notifications

## Status

In Progress. Required for the first release of the [native iOS app](native-ios.md); implementation follows the iOS baseline import.

## Goal

Deliver Pal notification intent to the replacement iOS app through APNs, with a small application integration and provider-specific adapter. Keep the boundary usable by a future Android/FCM adapter.

Keep the current participating-destinations policy. Android implementation, notification preferences, badges, actionable notification buttons, and exactly-once device delivery are deferred.

## Current Behavior

- [Backend architecture](../architecture/backend.md) defines canonical `ios` and `web` audiences and persisted `notificationDestinationIds`.
- `ChatService.insert` resolves destinations inside the message transaction. It creates delivery jobs for participating secondary destinations and provider-neutral notification intent for configured native destinations.
- Existing `delivery_jobs` and the secondary dispatcher deliver chat messages to providers such as Telegram. APNs is a notification transport with separate adapter-owned registration and dispatch state; it has no secondary ingress or external chat-message references.
- The replacement app owns registration, permission, bounded refresh, foreground suppression, and Main tap routing. Its implementation adapts the useful native lifecycle from legacy assistant without its legacy protocol or state.
- The first-party API assumes private Tailnet access. Registration uses that same owner boundary.
- The sole user deletes legacy app and installs Pal using the production bundle identity. Any old legacy assistant push registration is disabled manually; app-side legacy migration/recovery is excluded.

## Target Data Shape

Implemented boundaries:

- Application/delivery code persists provider-neutral notification intent with message publication and exposes narrow claim/acknowledgment operations.
- Shared notification adapter infrastructure owns installation registration and per-installation delivery outcomes.
- APNs code owns Apple credentials, topic/environment validation, payload formatting, HTTP/2 requests, and provider error classification.
- Composition wires configured transports. Core imports no APNs SDK, token model, payload type, or adapter implementation.
- A future FCM adapter supplies its own registration details and delivery implementation; adding `android` as a canonical destination remains explicit configuration/policy work.

Records:

- Notification intent: ID, message ID, destination ID, publication time, fanout state. Unique on message/destination; created only for configured notification audiences.
- Adapter-owned installation: installation UUID, destination/provider, provider token, environment, enabled state, registration generation, and timestamps.

The first release keeps one active iOS installation for the sole owner. Registering another installation disables the previous one. The adapter claims each intent and delivers it to that installation directly; a later registration never replays settled or cancelled history. Registration generation prevents an old invalid-token result from disabling a replacement token. No record contains private agent transcripts or workspace paths.

iOS registration routes are `PUT /notifications/ios/installations/:id` with token and APNs environment, and idempotent `DELETE` for revocation. Host configuration binds these to the iOS destination and allowed app topic/environment; clients cannot choose arbitrary audiences or topics.

Provider-neutral dispatch receives an intent and loads its canonical message through `ChatService`. Outcomes distinguish accepted, known-retryable rejection, invalid registration, permanent failure, and uncertain acceptance. Provider acceptance is not proof of device presentation.

The APNs payload contains a bounded plain-text preview, sound, background-refresh flag, and installation ID. Every notification opens Main, including notifications for task messages. The client validates the installation before navigation and fetches canonical state normally. The canonical message and task IDs are unnecessary in the payload.

## Milestones

### 1. Add the durable application boundary

Implementation tasks:

- [x] Finalize the minimal schemas and application contracts above; use existing Nest/Drizzle transaction and worker patterns.
- [x] Persist eligible notification intent in `ChatService.insert` alongside the message. Eligibility checks the configured destination's membership in `notificationDestinationIds`.
- [x] Expose application operations for enqueue, claim, interrupted-send recovery, state transitions, and focused inspection.
- [x] Keep one active adapter-owned installation with generation checks and explicit interrupted-work recovery.
- [x] Enable intent creation only for configured transports; do not enqueue an unserviceable web notification backlog.
- [x] Verify existing boundary checks with APNs imports confined to adapter code.
- [x] Document new contracts in backend architecture after implementation. Preserve existing agent tools, guidance, destination policy, and secondary delivery behavior.

Exit criteria:

- [x] Rollback removes both message and intent; commit creates one eligible intent and the message/destination uniqueness key prevents duplicates.
- [x] Disabled/unconfigured destinations, commentary, history reads, and message updates create no unsolicited notification jobs.
- [ ] Main and task finals eligible for iOS both dispatch; global `notify` alone never triggers an iOS alert.
- [x] Core remains provider-neutral under architecture lint.

### 2. Implement registration and APNs delivery

Implementation tasks:

- [x] Add private registration/revocation endpoints and adapter services; validate installation IDs, token input, environment, and configured topic.
- [x] Handle token replacement, single-active-installation replacement, disable/re-enable, and registration generation changes. A stale provider response cannot disable a newer registration.
- [x] Use native Node HTTP/2 and crypto rather than adding a provider dependency.
- [x] Keep credentials in backend configuration; document introduced variables in `.env.example`. Validate required values together; redact tokens, keys, and raw payloads from logs.
- [x] Implement bounded payload construction and plain-text previews; match APNs topic, push type, priority, expiration, and sandbox/production environment.
- [x] Retry known-safe transient rejections with bounded backoff. Retain uncertain sends as uncertain; do not claim exactly-once alerts or blindly resend after an ambiguous acceptance.
- [x] Handle invalid-token responses with registration-generation checks; settle permanent configuration/payload failures visibly.
- [x] Cancel intent when no active installation is available. Start/stop the worker through the Nest lifecycle, preserving chat availability during provider failure.
- [x] Record the 24-hour expiration and four-attempt retry policy in architecture and test state classification.

Exit criteria:

- [ ] Fake-provider integration covers acceptance, retryable rejection, invalid registration, uncertainty, restart, and revoked-recipient cancellation.
- [x] Late registration receives no settled or cancelled historical backlog; token changes cannot invalidate a fresh registration.
- [x] Backend notification failures leave canonical message persistence and chat synchronization intact.

### 3. Integrate native lifecycle

Implementation tasks:

- [x] Adapt legacy native permission, app-delegate, and notification handling into the new app session/service structure.
- [x] Register on launch/foreground as appropriate, persist one installation identity securely, and refresh backend registration when token or connection changes.
- [x] Replace the local installation identity when the configured backend changes. Durable cross-server revocation and recovery are excluded for the sole-user clean-install workflow.
- [x] Use a fresh Pal storage/Keychain namespace; never load legacy assistant registration records.
- [x] Suppress foreground banners/sound, perform bounded best-effort background refresh, and navigate to Main on tap using normal versioned synchronization.
- [x] Read current system authorization accurately. Notification failures do not block conversation use.
- [x] Document the sole-user cutover as deleting legacy assistant and installing Pal with fresh state.

Exit criteria:

- [ ] Fixture tests cover foreground suppression, permission states, Main taps, stale installation payloads, and backend switching.
- [ ] Background refresh preserves draft/pending state and cannot overwrite a newer foreground snapshot.
- [ ] Unavailable private connectivity yields recoverable app state and normal foreground synchronization.

### 4. Validate signed delivery

Implementation tasks:

- [x] Check actual signed bundle topic, APNs entitlement, registration environment, and provisioning; keep simulator fixtures distinct from provider delivery.
- [ ] Run a bounded physical-device acceptance pass for Main and task notification delivery, Main tap routing, foreground suppression, and unavailable-network recovery.
- [ ] Validate clean installation and subsequent relaunch using fresh Pal state.
- [x] Record results and prerequisites in the iOS README and these plans. Configure or deploy production only when requested.

Exit criteria:

- [ ] APNs provider acceptance and real-device behavior are separately recorded.
- [x] Apple package provisioning is verified; APNs provider credentials and private backend/device connectivity remain explicit acceptance criteria.
- [ ] The iOS plan can satisfy its push release gate.

## Tests

- PostgreSQL integration covers eligible intent creation and excludes commentary.
- Deterministic unit coverage checks Main-only payload routing, bounded previews, and delivery outcome/retry classification.
- Registration HTTP coverage verifies single-active replacement and idempotent revocation.
- Reuse native notification fixture tests; extend for Main tap routing and connection scope.
- Use signed physical-device evidence for real APNs acceptance. No model changes/evals are required for deterministic notification plumbing.

## Validation Commands

From `backend/` after implementation:

```bash
npm run build
npm run lint
npm test -- test/notifications.spec.ts
npm test
```

Migration `0013_mean_gargoyle.sql` creates the intent and installation tables. The focused notification suite and full service suite apply committed migrations to disposable PostgreSQL state.

Native build/test commands are owned by [Native iOS](native-ios.md). Record the exact simulator and signed-device commands used; fixtures cannot complete the signed-delivery milestone.

## Progress Evidence

- 2026-10-10: Migration `0013_mean_gargoyle.sql`, provider-neutral intent persistence, single-active iOS registration, APNs HTTP/2 delivery, bounded plain-text previews, retry classification, and native lifecycle are implemented. `npm run build`, type-aware lint with adapter-boundary checks, the focused notification suite, and all 43 backend tests pass.
- 2026-10-10: The full Pal iOS unit/UI scheme passes on the iPhone 18 Pro simulator with installation-scoped notification handling.
- Signed-package verification confirms production APNs entitlements and a valid Ad Hoc profile. Distribution records remain private; device registration, visible delivery, and tap routing remain physical-device acceptance work.
- 2026-10-16: APNs payloads and the iOS tap handler route every notification to Main, including task-message notifications. Backend build, lint, the isolated payload regression, the iOS simulator build, and the full Pal simulator test scheme pass. PostgreSQL-backed notification cases remain unrun locally because port 5433 is unavailable.

## Overall Exit Criteria

- [ ] Eligible canonical messages create durable notification work atomically and route to registered iOS installations.
- [ ] APNs details remain in adapter/configuration code; core exposes a small provider-neutral notification boundary.
- [ ] Existing Telegram delivery and first-party snapshot/SSE behavior remain compatible.
- [ ] Replacement app handles permissions, stale registrations, foreground/background behavior, and Main taps.
- [ ] Required real-device delivery evidence is recorded; Android remains an extension point with no speculative implementation.

## References

- [Apple: Registering your app with APNs](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns)
- [Apple: Sending notification requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)
- [Apple: Handling APNs responses](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns)
- [Apple: Background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)
