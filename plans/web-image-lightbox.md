# Web Image Lightbox

## Status

Done

## Goal

Present conversation images as compact square thumbnails and open them in an image-first lightbox with input-appropriate navigation.

## Result

- Conversation images render as compact square thumbnails that shrink within narrow message bubbles.
- Selecting a thumbnail opens a full-viewport, image-first lightbox with backdrop, Escape, and explicit close controls.
- Multiple images navigate by swiping on the image on touch devices, arrow buttons on fine-pointer devices, and keyboard arrows.
- Single images omit navigation, and closing restores focus to the opening thumbnail.
- The lightbox shares Pal's blurred panel backdrop and blocks its gestures from reaching message swipe-to-reply.
- The full-screen lightbox content uses the shared raised backdrop effect without the panel fill.

## Milestones

### 1. Compact conversation gallery

Implementation tasks:

- Render image attachments as small square thumbnails that wrap within the message.
- Preserve loading, failure, download, and accessible naming behavior.

Exit criteria:

- Single and multiple image messages use the compact square treatment without overflowing narrow viewports.

### 2. Navigable lightbox

Implementation tasks:

- Replace the card preview with a full-viewport image-first lightbox.
- Close on backdrop click and Escape while keeping clicks on the image inside the lightbox.
- Add touch swipe, fine-pointer arrow buttons, and keyboard arrow navigation within one message.

Exit criteria:

- Multiple images can be navigated with each applicable input method, single images omit navigation, and focus returns to the opening thumbnail.

### 3. Shared raised backdrop

Implementation tasks:

- Split the raised backdrop effect from its panel fill and apply only the effect to the full-screen lightbox content.
- Keep the shared overlay and lightbox interaction behavior unchanged.

Exit criteria:

- The lightbox shares the desktop drawer's raised backdrop effect while retaining a transparent content surface.

## Tests

- Extend the focused attachment Playwright coverage for compact wrapping, lightbox dismissal, touch swipe, pointer controls, keyboard navigation, failure fallback, and focus restoration.

## Validation Commands

```bash
cd frontend
npm run check
npx playwright test test/attachments.spec.ts
npm run check:ui
npm run trim
```

## Overall Exit Criteria

- Conversation image thumbnails and the lightbox match the agreed interaction design.
- Existing attachment upload, persistence, download, and preview failure behavior remains intact.
- Focused frontend checks pass and the local development stack is rebuilt with representative image messages available for manual review.
