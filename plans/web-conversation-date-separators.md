# Web Conversation Date Separators

## Status

Done

## Goal

Segment the web conversation into local calendar days with compact centered date labels.

## Current Behavior

- Messages render as independently measured virtual rows in chronological order.
- The conversation has no visible boundary between calendar days.
- Existing row measurement and layout reconciliation preserve scroll position while history changes.

## Milestones

### 1. Date labels

Implementation tasks:

- Add one separator before the first loaded message of each local calendar day.
- Label the current and previous day as `Today` and `Yesterday`.
- Format other dates as abbreviated month and day, adding the year only outside the current year.

Exit criteria:

- Consecutive messages from one day share one separator.
- Separators use the browser's local calendar day and the requested labels.

### 2. Virtualized layout and validation

Implementation tasks:

- Keep separators within the existing virtual-row measurement and scroll anchoring model.
- Style separators as centered muted text without divider lines.
- Add focused unit and browser coverage.

Exit criteria:

- Separators render without breaking message spacing, history loading, or bottom anchoring.
- Frontend checks and focused tests pass.

## Tests

- Unit coverage for same-day keys and all four label cases.
- Browser coverage for one separator per day and centered muted presentation.

## Validation Commands

```bash
cd frontend
npm run check
npm run test:unit
npx playwright test test/chat.spec.ts --grep "segments messages by date"
npm run check:ui
npm run trim
```

## Overall Exit Criteria

- Conversation dates are easy to scan on desktop and touch layouts.
- Existing conversation interactions and virtualization remain intact.

## Validation

- Strict frontend and test TypeScript checks pass.
- All seven unit-test files pass, including the date-label cases.
- All 16 conversation browser scenarios pass.
- UI ownership and unused-code/dependency checks pass.
