# Telegram Transport Retry

## Status

Done

## Goal

Recover Telegram sends interrupted before TLS establishment and expose polling failure causes.

## Current Behavior

The Telegram driver recognizes the explicit Node pre-TLS ECONNRESET signature as safe to retry. Other transport failures remain uncertain. The delivery dispatcher retries safe transient outcomes with a four-attempt limit and protects partially delivered messages from replay. Polling warnings include redacted underlying causes.

## Milestones

### 1. Safe transport classification and diagnostics

Implementation tasks:

- Classify the Node pre-TLS ECONNRESET signature as retryable; preserve uncertainty for other transport failures and partial delivery.
- Include redacted underlying causes in polling warnings.
- Update the delivery contract and add targeted regression coverage.

Exit criteria:

- Validated: build, all 12 targeted adapter/retry tests, and lint including adapter boundaries pass.

## Tests

- Pre-TLS reset retries before any accepted part; a generic reset remains uncertain.
- A pre-TLS reset after an accepted part remains partial delivery.
- Polling logs preserve cause details and redact the bot token.

## Validation Commands

```bash
cd backend
npm test -- test/telegram-adapter.spec.ts test/delivery-retry.spec.ts
npm run lint
```

## Overall Exit Criteria

- Safe retries use existing bounded backoff; ambiguous and partial sends retain uncertainty.
- Diagnostics expose causes without credentials; validation passes.
- Deployment and replay of existing uncertain deliveries remain outside this implementation.
