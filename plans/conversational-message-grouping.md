# Conversational Message Grouping

## Status

Done

## Goal

Use the configured casual messaging style and natural message grouping while delivering complete Task answers to Main and Telegram.

## Current Behavior

Shared voice and texting files guide Main and Task. Voice also applies to workers. The structured text field accepts one string or an ordered array. Every array item becomes one message with the same phase and destinations; Task commentary is task-only and final_answer blocks appear in Main and participating Telegram chats.

## Milestones

### 1. Guidance and validation

- [x] Add concrete casual-voice examples and guidance on restraint, contextual replies, and natural message boundaries.
- [x] Keep shared policies in voice/texting and Task visibility responsibilities in task guidance.
- [x] Add ordered text arrays after the single-string real-model sample delivered only the first requested answer part. Keep one quote on the first message and files on the last.
- [x] Validate real-model tone/grouping and complete multi-message Task delivery.

Exit criteria: native output and delivery checks confirm all answer parts remain visible; bounded model samples demonstrate the intended style or identify a contract limitation.

### 2. Deploy

- [x] Validate build/lint, commit, back up, deploy, and verify instruction assets.

Exit criteria: healthy deployment with current guidance and preserved data.

## Tests

- Bounded real-model synthetic coupon answer and short follow-up with recording-only publication.
- Native Task publication and secondary delivery tests verify every array item retains final visibility; parser tests cover quote/file placement and malformed arrays.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
```

## Overall Exit Criteria

- [x] Casual voice and natural grouping are implemented, validated, and deployed without losing any part of Task answers.

## Validation

Build and lint/boundary checks pass. Ten targeted output/Main/Task/file tests and three secondary-delivery integration tests pass. Native Task array output retains final_answer for every part in Main and task history. Secondary integration verifies every grouped part reaches the driver in order.

Recording-only real-model samples used synthetic coupon facts and the loaded production Task guidance. The original single-string contract returned only the first answer part when asked for separate messages. With the text-array contract, the model returned three final-answer messages covering the direct answer, workaround with payment/collection limits, and alternative. A separate immediate follow-up produced “not yet.” These are bounded model samples, not guarantees about wording or message count. No live Telegram messages were sent.

## Deployment

Private deployment verification confirms valid backups, unchanged record invariants, healthy API/desktop/frontend services, tested-code identity, and clean startup logs.
