# PWA Message Outbox

## Status

Done

## Goal

Let the PWA accept ordinary composer messages during a connection outage, keep their optimistic bubbles across reloads, and send them after a healthy reconnect without creating duplicates.

## Current Behavior

- Ordinary messages can be composed and queued while the event stream is disconnected.
- Optimistic messages and their original idempotency keys persist across reloads.
- The browser retries queued entries after reconnect, and the backend returns the original result for an identical retry.

## Target Data Shape

The browser stores a bounded versioned outbox containing the message text, uploaded attachment metadata, destination, optional quote, idempotency key, creation and expiry times, and delivery state. Entries are valid for automatic delivery for 24 hours.

## Milestones

### 1. Durable Outbox

Implementation tasks:

- Add validated local outbox storage with a 24-hour automatic-delivery window.
- Restore queued and failed optimistic messages on startup.
- Keep queued entries until their POST succeeds.

Exit criteria:

- A queued message survives reload with its original idempotency key.
- Expired entries remain visible for explicit retry or dismissal and are not sent automatically.

### 2. Reconnect Delivery

Implementation tasks:

- Allow ordinary composer sends after authoritative history has loaded even while disconnected.
- Drain queued messages in creation order after stream reconnection and history synchronization.
- Preserve the existing explicit failure, retry, and dismissal behavior for server rejections.

Exit criteria:

- Offline sends render optimistically and clear the composer immediately.
- Reconnect or refresh followed by reconnect creates one canonical message through the idempotent API contract.

## Tests

- Unit coverage for validation, persistence, expiry, and storage bounds.
- One browser workflow covering disconnect, optimistic send, reload, reconnect, and delivery.
- Existing failed-send browser coverage continues to pass.

## Validation Commands

```bash
cd frontend
npm run check
npm run test:unit
npx playwright test test/chat.spec.ts
npm run check:ui
npm run trim
```

## Overall Exit Criteria

- Disconnection alone does not disable a ready text/attachment send.
- Queued messages survive reload and send only within 24 hours after a healthy reconnect.
- Retries reuse the original idempotency key, and canonical history/SSE messages replace optimistic bubbles without duplication.
