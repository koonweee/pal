# Web Send Scrolling

## Status

Done

## Goal

Reveal the exact end of the active conversation as one coordinated layout change whenever the user sends a message.

## Current Behavior

- Every local send reveals the real conversation container's exact end; sends from an earlier reading position use a brief smooth scroll.
- Bottom-pinned conversation insertions place the new row at its final position immediately while existing rows animate to their new positions.
- The optimistic and persisted versions share one virtualizer identity and reserve the same reply-action and read-receipt geometry.
- Read receipts appear with a reduced-motion-safe opacity and position transition.

## Milestones

### 1. Local-send scroll ownership

Implementation tasks:

- Expose a local-send key from the chat controller.
- On each local send, smoothly scroll the real conversation container to its end regardless of its prior position.
- Reconcile the exact final position after layout settles and honor reduced-motion preferences.

Exit criteria:

- A send from any scroll position reaches the actual conversation bottom.
- Incoming messages do not pull an unpinned reader to the bottom.
- The send transition uses smooth scrolling unless reduced motion is requested.

### 2. Stable optimistic handoff

Implementation tasks:

- Keep one virtualized row identity while a local message becomes persisted.
- Reserve reply-action and latest-user receipt geometry before persistence.
- Reveal the read receipt with a subtle reduced-motion-safe transition.

Exit criteria:

- Persistence does not remount or resize the optimistic message row.
- The read receipt appears without shifting the conversation.
- Focused read-receipt and send-scroll regressions pass.

### 3. Bottom-anchored layout transitions

Implementation tasks:

- [x] Place new outgoing, assistant, and typing rows at their final bottom-anchored position before paint.
- [x] Animate already-visible rows from their previous positions into the new layout.
- [x] Keep the existing smooth-scroll path for sends made away from the conversation bottom.

Exit criteria:

- New bottom-pinned rows never rise into view from beneath the composer.
- Outgoing messages, assistant messages, and the typing indicator share the same layout-transition behavior.
- Reduced motion skips the layout animation while preserving exact bottom alignment.

## Tests

- Add one browser regression that sends while unpinned and verifies smooth-scroll intent and the exact final position.
- Extend read-receipt coverage to verify stable row identity, stable geometry, and the receipt transition.
- Verify a pinned insertion animates existing rows while the new row starts at its final position.

## Validation Commands

```bash
cd frontend
npm run check
npm test -- test/chat.spec.ts
npm run check:ui
npm run trim
```

## Overall Exit Criteria

- Every local web send settles at the true bottom of the active conversation without rising from beneath the composer.

## Validation

- Strict application and test TypeScript checks pass.
- All ten chat browser scenarios pass, including stable optimistic persistence, the read transition, smooth scrolling from an unpinned position, and exact final alignment.
- The layout-transition regression covers outgoing, assistant, and typing entrances, verifies existing-row motion, and rejects vertical motion on new rows.
- Unit, UI ownership, and unused-code checks pass.
- A real mobile-sized dev recording keeps the message and virtual-row heights unchanged when persistence and Read arrive.
