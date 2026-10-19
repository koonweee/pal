# iOS Conversation Performance

## Status

Done

## Goal

Measure the leading long-conversation performance proposals, retain improvements that preserve message access and chat behavior, and identify the constraint on further rendering gains.

## Current Behavior

- `ChatScreen` virtualizes message rows with `LazyVStack` and MarkdownUI 2.4.1.
- Parsed Markdown is cached across row reuse, and Markdown image providers cannot fetch external content.
- Scroll geometry updates observable view state during a drag.
- Older pages merge as one batch, with one sort, reconciliation, and save per page.
- The existing fixture provides 80 paginated messages and the retained regression surface.

## Milestones

### 1. Measure isolated proposals

Implementation tasks:

- [x] Add a repeatable long-conversation benchmark and record the eager baseline.
- [x] Measure non-observable scroll metrics, batched page merging, bounded eager rendering, lazy rendering, and native attributed text independently.
- [x] Record responsiveness, CPU, memory, pagination time, and observed interaction regressions.

Exit criteria:

- Comparable results identify which proposals materially improve performance and which introduce UX regressions.

### 2. Retain and validate the winning implementation

Implementation tasks:

- [x] Keep the smallest combination that provides a measured improvement.
- [x] Add only targeted regression coverage exposed by the spike.
- [x] Update iOS documentation with the resulting rendering behavior and evidence.

Exit criteria:

- The retained virtualized renderer and batched pagination pass the store, pagination-anchor, slow-drag, and rich-Markdown regressions.

## Results

The scrolling measurements used five Debug iterations with 200 fixture messages on the iPhone 18 Pro iOS 27 simulator. CPU time and peak physical memory are comparative simulator measurements, not physical-device or Release-build acceptance results.

| Proposal | App CPU | Peak memory | Result |
| --- | ---: | ---: | --- |
| Eager `VStack` baseline | 5.46 s | 194.4 MB | Reference |
| Non-observable scroll metrics | 5.39 s | 195.4 MB | Rejected: within run variance |
| First-row-only geometry | 5.45 s | 193.3 MB | Rejected: negligible change |
| `LazyVStack` | 1.45 s | 60.0 MB | Rejected: a 160-point slow drag moved the reading anchor 691 points |
| 50-row eager suffix | 1.97 s | 79.3 MB | Rejected: older rendered messages became unreachable |
| Native attributed `Text` | 1.80 s | 107.8 MB | Rejected: lost the structured Markdown accessibility hierarchy and Textual presentation |
| MarkdownUI `LazyVStack` | 0.95 s | 51.1 MB | Retained: position and rich-Markdown regressions pass |

Batching a 25-message earlier-history merge reduced average wall time from 8.72 ms to 3.36 ms and CPU time from 7.64 ms to 2.59 ms across ten Debug iterations. It is retained because it sorts, reconciles, and saves once per page without changing rendered content.

The eager renderer's exact slow-drag regression completed 12 consecutive gestures. Each 160-point gesture moved its tracked Markdown heading by 150 points. Textual `LazyVStack` failed the same position-stability gate as the migrated source revision's earlier `List`, collection-view hosting, and Textual lazy-layout experiments.

MarkdownUI resolves the tested block layout without that displacement. Its virtualized renderer passed pagination anchoring and all 12 slow drags, while reducing CPU by 82.6% and peak physical memory by 73.7% from the eager Textual baseline. The retained theme covers headings, lists, horizontally scrolling tables and code, links, and text selection. Remote Markdown images remain disabled because authenticated message attachments use `ChatImage`.

## Tests

- One long-conversation performance scenario using deterministic fixture history.
- Focused store regression for batched page merging.
- Rich-Markdown structure and remote-image isolation regression.
- Existing iOS unit and focused UI suites.

## Validation Commands

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project ios/Pal/Pal.xcodeproj -scheme Pal \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .local/pal-ios CODE_SIGNING_ALLOWED=NO build

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet \
  -project ios/Pal/Pal.xcodeproj -scheme Pal \
  -destination 'platform=iOS Simulator,id=<device-id>' \
  -derivedDataPath .local/pal-ios-tests test
```

## Validation Result

On 2026-10-14 the full `Pal` scheme passed on the iPhone 18 Pro iOS 27 simulator: 12 tests passed, the opt-in benchmark was skipped, and no tests failed. The regular suite includes the batched-merge store regression, Markdown pagination-anchor regression, the 12-step exact slow-drag regression, and rich-Markdown structure and image-isolation coverage.

## Overall Exit Criteria

- The retained changes measurably improve long-conversation interaction or pagination cost.
- Every rendering proposal is classified by measured impact and UX evidence.
- No observed regression appears in the retained pagination path.
- Rendered message rows stay bounded through native lazy virtualization.

## MarkdownUI Virtualization Result

- [x] Replace Textual rendering with MarkdownUI 2.4.1 and restore `LazyVStack`.
- [x] Pass the exact slow-drag and pagination-anchor regressions.
- [x] Measure the 200-message CPU and memory improvement over the eager Textual baseline.
- [x] Preserve structured Markdown, links, selection, tables, code, and protected image behavior.
