# PWA Push Notifications

## Status

In Progress: iPhone registration and visible test delivery are confirmed. Remaining device acceptance is pending.

## Goal

Deliver Main-requested alerts to multiple active PWA/browser installations through Web Push, with independent delivery outcomes and current-installation controls.

## Product Decisions

- Main chooses whether each publication requests an alert. Device opt-in enables delivery of those requested alerts.
- Every subscribed installation receives requested alerts, including an actively used installation.
- Native iOS and PWA registrations are independent; both may notify on the same phone.
- Alerts show a bounded message preview and the configured assistant name. Reaction bodies use `reacted <emoji> to “<message preview>”`, capped at 200 Unicode characters of plain-text message content with an ellipsis inside the closing quote. Empty-text targets use `reacted <emoji>`.
- Tapping opens Main at its latest messages, preserving existing drafts.
- Preferences enables/disables notifications for the current installation only.
- Provider TTL is zero: unavailable devices receive no stored notification on reconnection.
- Retry explicit transient provider rejections. Unclassified network errors and ambiguous sends become uncertain and are not retried. Pre-send failures are retryable only when the library directly exposes reliable evidence.
- Required device acceptance: iPhone Home Screen PWA and desktop Chrome.

Implementation defaults: explicit opt-in, no historical replay to newly enabled subscriptions, at most four send attempts, and a five-minute publication-to-send deadline. These are host policies, not user/model settings.

Deferred: device management lists, remote revocation, physical-device pairing, foreground suppression/presence tracking, notification action buttons, per-device content preferences, background `pushsubscriptionchange` handling, and additional browser acceptance requirements.

Per-installation notification counts and badge acknowledgment are specified in [PWA Notification Badges](pwa-badges.md).

Subscription reconciliation runs when the app opens. A subscription that expires or changes while the app remains closed may stop receiving alerts until the next launch. If the browser has no subscription, enabling again requires an explicit user action.

## Current Behavior

- [Backend architecture](../architecture/backend.md) defines canonical `web` and `ios` audiences. Main's `sendToUser` supplies `notify`; host resolution includes all enabled canonical audiences. Task logs have no notification destinations; Main decides whether to publish task results.
- [ChatService](../backend/src/chat/chat.service.ts) commits messages/reactions and eligible notification intents atomically. [Configuration](../backend/src/config/configuration.ts) enables APNs and Web Push independently when each provider's configuration is complete.
- [NotificationRepository](../backend/src/notifications/notification.repository.ts) owns durable intent, unique per message/destination/version. Native intents track one send and expire after 24 hours. Web intents expire after five minutes and atomically expand into independent per-installation deliveries.
- [Native dispatch](../backend/src/adapters/notifications/native-notification.dispatcher.ts) targets one active iOS installation. Native registration and delivery behavior remain in their existing scope.
- [The service worker](../frontend/src/pwa/sw.ts) caches the static shell, handles update messages, displays push payloads, and routes notification taps to Main. [PWA lifecycle](../frontend/src/pwa/use-pwa-lifecycle.ts) owns registration and activation in production builds and connects the notification subscription owner.
- Gateway and service-worker route rules already include network-only notification endpoints. Tailnet HTTPS provides the application origin; Web Push requires outbound access to browser push services.
- [React PWA cutover](react-pwa-rewrite.md) remains a separate acceptance milestone. Implement this feature in `frontend/` and validate the actual staged React artifact.

## Target Data Shape

- Keep provider-neutral `notification_intents` and existing message/destination/version identity. Configure `web` only when VAPID configuration is complete. Use a five-minute expiry for web intents; retain native expiry.
- Add terminal intent state `expanded` for web fanout. It means delivery targets were durably materialized, not provider acceptance or device display. Web outcomes live exclusively on child deliveries; existing native states keep their meaning.
- Add adapter-owned `web_push_installations`: server-assigned installation UUID, unique subscription endpoint, `p256dh` and `auth` keys, generation, enabled state, generation activation time, and timestamps. The endpoint identifies a registration; upsert returns its server-assigned ID without requiring a separate durable client UUID. Registration is idempotent; changing subscription keys or re-enabling advances generation. A changed endpoint creates a new registration; invalid old endpoints are disabled on provider rejection. Enabling one installation does not disable another.
- Add adapter-owned `web_push_deliveries`: intent ID, installation ID, captured generation, state, attempt count, next-attempt time, error code, and timestamps. Enforce unique intent/installation identity. Expiry comes from the intent.
- Atomic fanout locks a pending web intent, selects enabled registrations whose current generation was active by publication time, inserts child deliveries, and marks the intent expanded in one transaction. No recipients settles it as cancelled. Repeated expansion cannot add or duplicate recipients.
- Before each send, require the captured installation generation to remain enabled/current; cancel stale work. Late registration and replacement subscriptions receive future alerts only.
- Fixed-audience API: `GET /notifications/web/config` returns availability and the public VAPID key; `POST /notifications/web/installations` idempotently upserts by endpoint and returns the record ID; idempotent `DELETE /notifications/web/installations/:id` disables it. No subscription-list endpoint or client-selected destination/provider.
- Registration responses contain only fields needed by the current-installation UI. Subscription secrets and private VAPID keys never appear in responses or logs.
- Push payload: assistant name, bounded plain-text preview, intent ID for notification tagging. Tap target is the fixed Main route; the payload contains enough content to display without fetching Pal.

## Milestones

### 1. Durable subscriptions and independent delivery work

Implementation tasks:

- [x] Add migrations, registration service/repository, and fixed-web DTO/controller endpoints under adapter ownership.
- [x] Add VAPID public/private key and contact configuration to `backend/.env.example`; keep keys stable across restarts and frontend releases. Derive web availability from complete configuration.
- [x] Validate subscription key shape and HTTPS push endpoints. Restrict outbound sends to supported push-service endpoints, reject redirects/internal destinations, and keep endpoint/key values out of diagnostics.
- [x] Add web intent expiry and atomic fanout through a narrow transactional notification boundary. Keep provider-specific registration queries inside the adapter.
- [x] Enforce idempotent registration, endpoint uniqueness across tabs and launches, generation changes, and independent revocation.
- [x] Include the new endpoints in the appropriate browser-origin protection and generated OpenAPI/client workflow.
- [x] Retain existing native intent and registration behavior, including migration compatibility for queued APNs work.

Exit criteria:

- Two subscriptions coexist; registering either repeatedly creates no duplicate recipient.
- Publication creates durable eligible web intent atomically; disabled configuration creates no web backlog.
- Crash/retry during fanout produces exactly one child per eligible installation.
- Late registrations, re-enabled generations, and revoked installations receive no older work.
- Existing native notification tests pass against the migrated schema.

### 2. Web Push provider and bounded dispatch

Implementation tasks:

- [x] Use `web-push` for VAPID/encryption within `adapters/web-push`; controllers call the registration service and repositories own persistence.
- [x] Dispatch independently claimed child deliveries, allowing one failed installation to retry without resending successful ones.
- [x] Send with `TTL: 0`, a finite request deadline, and payload limits that account for encryption overhead. Use InstanceSettingsService for the assistant name and a bounded plain-text preview; use the reaction snapshot for reaction alerts.
- [x] Cancel superseded reactions and expired work before sending.
- [x] Retry explicit transient provider responses up to four attempts, using the existing 1s/5s/30s progression and honoring Retry-After within the five-minute publication deadline. Expired work is cancelled after downtime.
- [x] Mark accepted responses terminal without assuming display. Disable expired/invalid subscriptions only if their generation is still current. Classify configuration/payload errors as permanent.
- [x] Mark unclassified network errors, ambiguous sends, and interrupted in-flight deliveries uncertain. Add pre-send retries only if the library directly exposes reliable evidence; avoid custom transport instrumentation. Preserve pending safe retries across restart.
- [x] Keep the provider-neutral core free of Web Push imports. Leave APNs implementation in its existing scope. Extract shared helpers only if implementation reveals substantial matching duplication; avoid a new universal provider framework.

Exit criteria:

- One accepted send plus one transient failure retries only the failed recipient.
- All attempts carry TTL zero; no accepted/uncertain attempt is replayed.
- Invalidating an old generation cannot disable a replacement subscription.
- Provider failure never rolls back the canonical message or disrupts SSE/APNs.

### 3. Current-installation controls and notification interaction

Implementation tasks:

- [x] Add concise notification controls to Preferences with supported, unavailable, disabled, enabled, denied, and retryable-error states.
- [x] Request permission only from an explicit enable action. On iPhone, explain Home Screen installation when required.
- [x] Reuse the existing lifecycle owner's service-worker registration; do not introduce a second registration owner or force update activation.
- [x] Use the browser's current PushSubscription as the client source of truth. On launch, register the existing subscription and retain the returned backend ID for current-session revocation. Recover registration failures without repeatedly prompting or maintaining a separate durable client UUID.
- [x] Disable by unsubscribing in the browser first, then revoking the backend record when its ID is available. If unsubscribe fails, show failure. If backend cleanup fails after unsubscribe, the installation is locally disabled; provider rejection cleans up stale registrations. No durable client disable queue is needed.
- [x] Reconcile subscription replacement on app launch. Read the current browser subscription before registration, and never recreate an absent subscription automatically. Defer background subscription-change event handling.
- [x] Handle push with event.waitUntil and showNotification using only payload/static shell resources. Display alerts even when a client is visible; SSE does not create an additional OS alert.
- [x] Handle notificationclick by focusing an existing same-origin client or opening Main. Deliver a fixed navigation instruction to the React owner, select Main/latest messages, preserve drafts, and use normal snapshot/SSE recovery. Avoid arbitrary payload URLs and unnecessary reloads.
- [x] Keep subscription identity scoped to the origin/service-worker registration and preserve it through ordinary application updates.

Exit criteria:

- Each installation can independently enable and disable notifications; denied permission and failed registration have truthful UI. Backend cleanup failure after successful unsubscribe cannot cause launch reconciliation to resubscribe.
- A received push displays with the application closed or foregrounded.
- A tap opens Main/latest messages in existing and cold clients without losing drafts.
- Display requires no Tailnet fetch; opening fresh chat still requires normal connectivity.
- The existing safe-update lifecycle remains functional.

### 4. Device acceptance and documentation

Implementation tasks:

- [x] Update architecture and deployment documentation with web subscription ownership, fanout semantics, TTL-zero behavior, configuration, and outbound connectivity requirements.
- [ ] Validate the staged production React PWA over Tailnet HTTPS on iPhone Home Screen and desktop Chrome.
- [ ] Verify both installations receive the same requested alert, including a foreground installation, and one can be disabled independently.
- [ ] Verify background/closed-app delivery, preview/name, Main tap routing, and retained subscriptions after a frontend update.
- [ ] Disconnect a device from the internet during publication, reconnect it, and verify no delayed alert. Separately disable Tailscale while retaining internet and verify payload display; restore Tailnet access for chat recovery.
- [ ] Verify coexistence with native iOS notifications on the same phone without changing native registration policy.
- [ ] Record actual device/browser versions and results; keep physical acceptance unchecked until observed. Coordinate any deployment with explicit authorization.

Exit criteria:

- Required device checks pass with recorded evidence, including offline discard and two-installation delivery.
- Documentation describes implemented behavior and remaining platform limitations.

## Tests

Use a small set of behavioral tests:

- PostgreSQL integration: atomic intent/fanout, two-recipient partial success, idempotent subscriptions, generation/revocation races, no late replay, restart/expiry, superseded reaction cancellation, and native migration compatibility.
- Provider fixtures: TTL zero and bounded payload, retry/permanent/invalid/uncertain outcomes, and endpoint restrictions. Cover Retry-After and the publication deadline in dispatcher integration tests.
- Focused frontend tests: explicit opt-in, denied/unavailable state, launch reconciliation, failed registration, unsubscribe failure, backend cleanup failure after unsubscribe, and existing-tab Main navigation with a draft.
- Production service-worker browser tests: synthetic push display requests and click routing through the built worker, with the platform notification API stubbed. Existing update-lifecycle tests cover registration/activation; real subscription preservation across an update remains device acceptance. Synthetic events do not substitute for real push-service/device acceptance.

## Validation Commands

Implementation adds focused web-push suites and extends existing PWA coverage. Run the relevant targeted tests, then required checks:

```bash
cd backend
npm run build
npm run lint
npm test -- test/notifications.spec.ts test/web-push.spec.ts
npm run openapi:check

cd ../frontend
npm run api:check
npm run check
npm run test:unit -- web-push notification-navigation
npm run check:ui
npm run trim
npm run test:pwa
```

Regenerate OpenAPI and the frontend client when adding the routes. Adjust the targeted suite filenames to their implemented locations. Use `./scripts/dev-local rebuild` for authorized integrated validation because this change includes backend/API work.

## Overall Exit Criteria

- [ ] Multiple active web installations receive independent, bounded notification delivery without retrying successful recipients.
- [x] Main's existing notify choice remains the only model-facing notification control; Task tools and guidance require no changes.
- [ ] Offline devices accumulate no provider backlog; transient retries are bounded and ambiguous sends are not retried.
- [x] Registration, revocation, generation changes, and restart recovery preserve the stated invariants.
- [x] PWA settings and click routing work alongside the existing service-worker update lifecycle.
- [ ] iPhone Home Screen and desktop Chrome acceptance passes; existing native behavior remains intact.

## References

- [Web Push TTL semantics, RFC 8030 §5.2](https://www.rfc-editor.org/rfc/rfc8030.html#section-5.2)
- [WebKit: Web Push for iOS and iPadOS](https://webkit.org/blog/13878/)
- [WebKit: user-visible push requirement](https://webkit.org/blog/12945/meet-web-push/)
- [Node web-push library](https://github.com/web-push-libs/web-push)

## Implementation Progress

Milestones 1–3 are implemented with migration `0017_web_push.sql`, generated OpenAPI/client contracts, focused delivery tests, and production-worker browser coverage. Their OS presentation and real subscription lifecycle acceptance remains in milestone 4.

Automated validation: 10 backend notification tests, 10 first-party contract end-to-end tests, 14 frontend unit tests, and 9 production PWA browser tests pass. Backend build/lint/OpenAPI drift checks and frontend type/API/ownership/unused-code checks pass. Headless notification permission is denied by the local browser environment; the synthetic worker test stubs showNotification and does not prove OS display.

Local stack rebuild/migration and the staged React PWA refresh pass. The Tailnet notification-config endpoint returns HTTP 200 with delivery available; a browser smoke check confirms worker readiness and the permission-denied Preferences state. The local development environment has a dedicated VAPID identity in ignored environment storage. Current device acceptance evidence and remaining checks are listed below.

## Device Acceptance Evidence

2026-10-19, local Tailnet staging:

| Check | Observed result |
| --- | --- |
| Desktop browser | A headed isolated Chrome profile completed permission and subscription checks. |
| Permission and subscription | Browser permission was granted; real subscriptions registered through the PWA without UI errors. |
| Provider acceptance | Canonical foreground test publications reached `accepted` with no provider error. |
| Foreground presentation | Unverified. No notification object was observed within 25 seconds. A separate real `showNotification` call resolved with site permission granted, but immediate `getNotifications` returned no entries. Desktop capture did not establish visible presentation. |
| Closed app, offline discard, update retention, and tap focus | Pending device acceptance. |
| iPhone Home Screen PWA | Apple Web Push registration and visible test delivery succeeded. |
| Test cleanup | Disposable browser registrations are revoked. |

Visible iPhone test delivery is confirmed. Tap routing, simultaneous device delivery, desktop presentation, closed-app delivery, independent device disabling, offline discard, Tailnet-disconnected display, native coexistence, and subscription retention across an update remain required.

## Production deployment

The private Tailscale deployment uses matching backend/PWA artifacts and a dedicated stable VAPID pair. Migration, payload, API/SSE, responsive preferences, and service health checks pass. Main retains notification judgment; each installation enables notifications independently in Preferences → App.
