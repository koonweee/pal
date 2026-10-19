# Bidirectional Chat Files

## Status

Done

## Goal

Users send arbitrary documents and images to Main or a task. Agents receive local file paths, use their existing filesystem/execution tools to work with the files, and return files as downloadable chat attachments.

## Current Behavior

- `/files` stores and streams arbitrary files up to 25,000,000 bytes. Message associations retain attachments; unattached files and stale temporary/orphaned files expire after 24 hours.
- The coordinator accepts ordered attachments and file-only messages. Main, tasks, and workers receive private metadata with absolute filesystem paths. New storage names preserve extensions needed by native readers.
- `inspect_message` and `inspect_task` resolve durable file references for later requests. Delegation forwards source and selected attachments with metadata and local paths.
- Agents select generated files through structured output path declarations; the backend snapshots them at publication. Existing files can be selected by ID. Text and attachments share one public task-final identity across Main and task chat. HTTP/SSE exposes metadata and download/content URLs.
- The playground supports selection, drag/drop, image paste, concurrent uploads, per-chat drafts/replies/files, inline image grids, and uniform document pills.
- Native workspace reads return text and supported image/PDF media to the model, with a 25,000,000-byte media-read cap shared with uploads. Other document formats use available execution tools and libraries.

## Scope and Decisions

- Pass absolute local paths and original filenames to agents. Resolve paths from stored attachment IDs in the backend. Native workspace tools handle reading and processing.
- Main receives embedded attachment metadata and can use native read-only inspection for routing or quick answers; it delegates substantial file work. Tasks pass relevant paths to workers through existing delegation.
- Keep original uploads unchanged; instructions tell agents to create working copies before modifying them. This is a shared trusted filesystem, so instruction-level immutability is not an isolation boundary.
- Keep the existing storage, public attachment model, APIs, SSE, 25 MB limit, and cleanup policy. Messages retain files; task details contain task metadata and description. Durable task artifacts are deferred.
- Arbitrary formats can be transferred. Reading/editing a particular format depends on agent tools available in the runtime. Verify image viewing explicitly: a path alone does not give a language model visual access.
- Use existing document tools and execution capabilities. Add a dependency or adapter only for a demonstrated gap. A general extraction/conversion subsystem and predefined Office-format support matrix are outside this plan.
- Declare outgoing file paths in structured output. Publication imports them into managed storage and attaches the resulting IDs through the normal public-message path.

## Target Data Shape

### Incoming files

Public APIs remain unchanged: upload through `POST /files`, then send ordered `attachmentIds` through `POST /chat/messages`.

The backend adds a private file manifest to native message contents:

```typescript
{
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  path: string; // Absolute path in the shared runtime.
}
```

Generate paths from trusted storage records. Original filenames remain metadata; agents can create an extension-preserving working copy when a tool requires one. No automatic copying or new file-resolution tool is needed for initial access.

Include the manifest in Main/direct task input and source-message delegation. Add optional selected attachment IDs to delegation if needed to forward files from multiple earlier messages. Resolve and validate IDs in the host. Preserve references in task context/history so later turns and workers can reopen the files after restart or memory compression. Private history-tool responses can enrich public attachment records with paths through the same helper; public HTTP/SSE metadata stays unchanged.

### Outgoing files

Agents select completed outputs in structured public output:

```typescript
{
  text: string;
  replyTo: number | null;
  attachmentIds: string[]; // Existing files to resend.
  files: { path: string; filename: string; contentType: string }[];
}
```

FilesService snapshots each declared local file into managed storage at publication. Relative paths resolve against the agent working directory. Workers return paths to their parent; the parent selects files for public delivery. Message associations retain received and delivered files. Unattached files expire after 24 hours.

A nonempty attachment list permits empty text. Validate IDs and files before publication. Invalid declarations receive one model retry; repeated failure preserves text with a delivery notice. Task finals remain one message shared between Main/task chats, including identical attachments. Main's private task-result context includes attachment metadata and resolved paths.

### Inline Attachment Presentation

Use `ios/Pal/Pal/MessageRow.swift` (`MessageRow` and `ChatImage`) as the layout reference:

- One image: show its natural aspect ratio, fitted within the message width and a bounded height (the reference uses 300 points).
- Two to four images: two equal columns of square, cropped thumbnails.
- Five or more images: three equal columns of square, cropped thumbnails.
- Use small consistent gaps (4 points in the reference), rounded corners, and stable cell sizes during loading/failure. Keep incomplete final rows aligned; show every image.
- Adapt dimensions to the web chat width. Apply the same presentation to user and assistant messages. Opening a thumbnail shows the full image with a download action; support keyboard activation and meaningful accessible labels.
- For other files, use compact wide pills with uniform width and height regardless of filename length. Use one shared responsive size within each layout; filenames must never expand the pill. Include a generated paperclip/file-type graphic, a single-line filename truncated with an ellipsis while retaining its extension, and file size. Generate the graphic in the frontend from metadata with HTML/CSS and an existing icon; no thumbnail-generation backend or AI image generation is required.
- In mixed messages, show the image grid followed by file pills, preserving attachment order within each group. Keep canonical attachment order unchanged in the API.
- Use a generic FILE label when a type cannot be identified. Expose the full filename accessibly and keep download available when a preview fails.

## Milestones

### 1. Incoming File Paths

Implementation tasks:

- [x] Add one backend helper to resolve attachment records into private manifests with local paths.
- [x] Include manifests in Main and direct task input, preserving text, replies, order, and attachment-only messages.
- [x] Enable attachments in the coordinator while preserving serialized acceptance, idempotency, and handoff-failure behavior.
- [x] Carry relevant manifests through source/selected-file delegation and later history lookup. Preserve durable references using message associations.
- [x] Add task/worker instructions for shared paths, original-file preservation, working copies, and clear reporting when a format cannot be read.
- [x] Verify native tools can read a document and visually inspect a local image in the deployed runtime. Add a minimal image-viewing adapter only if native tools cannot return local images to the model.

Exit criteria:

- The real chat endpoint accepts text-plus-files and file-only input.
- A task and worker can open the uploaded bytes using the supplied path.
- A real-model smoke identifies image contents using the existing tool path or a justified minimal adapter.
- Direct task input, active-run follow-ups, delegation, and later requests preserve access without loading file bytes into every prompt.

### 2. Outgoing File Attachments

Implementation tasks:

- [x] Add streamed local-file import using temporary writes, atomic completion, size enforcement, and cleanup on failure.
- [x] Validate readable regular files, filename, and content type. Reject missing files, directories, device files, and oversized outputs; define symlink handling.
- [x] Copy generated files declared in structured output during publication. Message associations retain delivered files; unattached copies expire after 24 hours.
- [x] Extend structured output, parsing, processor, and publication with existing attachment IDs and generated file declarations. Keep the plain-text fallback with an empty list.
- [x] Support file-only output and one native step-level retry with correction feedback for invalid attachment IDs or generated file declarations. Preserve answer text with a delivery notice after repeated failure.
- [x] Preserve phase visibility, replies, ordered attachments, history/SSE, and task-result context.
- [x] Keep tool screenshots private unless selected for delivery. Public HTTP/SSE metadata contains managed attachment references and download URLs.

Exit criteria:

- A task produces a document and image and sends both in one message.
- A file-only task final appears in both chats with the same identity.
- Downloaded bytes remain stable after the source file changes, storage cleanup, and restart.

### 3. Playground and Documentation

Implementation tasks:

- [x] Add multi-file selection, drag/drop, and image paste with removable pending files and per-file status. Pending images/documents use uniform 183 × 52 px pills in a horizontal scrolling row, with fades reflecting hidden files at either edge.
- [x] Upload with bounded concurrency and submit successful attachment IDs in selection order. Allow file-only sends.
- [x] Preserve draft, reply, destination, selected files, and file-count errors per chat; clear count errors on removal. Reconcile optimistic attachments through history/SSE and retain unchanged preview/upload DOM and keyboard focus.
- [x] Implement the count-based image grid and generated file pills specified in Inline Attachment Presentation, including full-image opening, downloads, and loading/failure states.
- [x] Preserve safe inline/download behavior and nosniff; verify content format where required for inline image rendering.
- [x] Document implemented file paths, publication, limits, retention, and any required runtime tools in architecture/backend.md and the relevant READMEs.

Exit criteria:

- Users can send multiple files and receive, preview, and download outputs. Image groups use the one-image, two-column, and three-column layouts; document pills have uniform dimensions regardless of filename length and truncate filenames to fit.
- Failed uploads remain visible and actionable without silently dropping selected files.
- Reload/reconnect restores attachments, and documentation reflects the implementation.

## Tests

Extend existing coverage with the smallest useful cases:

- File E2E: submit through the real coordinator with a recording runtime; cover ordered mixed/file-only input, exact download bytes, missing IDs, and idempotent retry. Reuse existing upload-limit/cleanup tests.
- Runtime: manifests reach Main, direct tasks, source/selected-file delegation, and active input; later history resolves the same files. Verify worker access in the smoke.
- Storage/publication: copied output bytes, file-only shared final, invalid IDs, oversized import cleanup, and delivered-file retention and unsent-file expiry.
- Playground: one mixed-file round trip with preview/download and reload, plus failed-upload retry preserving files and destination. Visually verify 1, 2, 3, 4, 5, and 7 images, mixed documents, long filenames, and loading/failure states at narrow and wide chat widths; avoid separate redundant tests for every count.
- Real-model smoke: inspect a document and image from local paths, delegate file work, generate and send a file, and reopen an earlier attachment after restart.

## Validation Commands

Run targeted suites using the existing PostgreSQL test environment:

```bash
cd backend
npm run build
npm run lint
npm run test:e2e -- test/files.e2e-spec.ts test/chat.e2e-spec.ts
npm test -- test/services.spec.ts test/main-session.spec.ts test/task-agents.spec.ts test/file-agents.spec.ts test/mcp.spec.ts test/task-workers.spec.ts
cd ../frontend-playground
npm run build
npm test -- test/chat.spec.ts
```

Run `npm run files:smoke` with the configured ChatGPT login and a disposable PostgreSQL instance. It validates native Main and worker PDF/image reading, structured document-plus-image output, byte-preserving downloads, memory compression, and reopening earlier files after restart.

## Overall Exit Criteria

- Arbitrary files within the limit travel both ways without byte loss.
- Tasks/workers receive usable paths and can inspect documents and images with available tools.
- Main remains responsive while tasks process files.
- File-only messages, delegation, retries, restart, and shared finals retain usable attachments.
- Playground upload/preview/download works and targeted checks pass.

## Deferred Work

- General document extraction/conversion, automatic pre-processing, search/RAG, and universal format guarantees.
- Object storage, external sharing, per-user authorization, messaging-channel adapters, and filesystem isolation.
- New image-generation services, rich document editors, versioning, durable task artifacts, storage management, resumable uploads, and larger limits.

## Validation Results

- Backend build, type-aware lint, and formatting checks passed.
- PostgreSQL-backed integration checks passed: 6 suites, 16 tests, including native file-only input/output, active follow-ups, source plus selected-file delegation, earlier-message inspection, retention, correction feedback, a recovery tool call, one retry per run, and text preservation after repeated invalid output IDs.
- Playground build, the 20-test feature suite, and six targeted pending-row browser checks passed with Google Chrome. Coverage includes the paperclip file picker, stable previews and focused controls during updates, chat-scoped count errors, selection/drop/paste, three-upload concurrency, selection order, reply/draft/destination retention, retry, image counts 1/2/3/4/5/7, preview loading/failure, downloads, reload, and uniform truncated pills at desktop/mobile widths. Screenshots for all six image counts and both ends of the pending attachment row were inspected at desktop/mobile widths. Pending pills measure 183 × 52 px; scrolling preserves one row and updates both edge fades.
- The configured-model HTTP smoke passed using public activity, storage, and Memory APIs, with completed worker delegation verified from persisted tool results: read a randomized PDF code and image colors, send a document and image together, verify downloaded bytes and shared final identity, compress native memory, restart the backend, and reopen the original file. The previous report remained byte-identical.
- Final file/chat HTTP suites passed: 2 suites, 9 tests, including exact bytes, UTF-8 filenames, image format verification, size enforcement, cleanup, idempotency, and shared file-only finals. Validation used an isolated disposable PostgreSQL instance; its container and temporary smoke database were removed. The rebuilt local application container is running with the current attachment code. Live playground checks confirmed file-ID validation and the multi-file picker, and the corrected paperclip was visually inspected.

## Remaining Work

None. All milestone and overall exit criteria are validated.
