# Agent File Simplification

## Status

Done

## Goal

Keep files attached to messages, give Main native read-only inspection for routing and quick answers, and send generated files through structured output. Durable task artifacts are deferred for separate design.

## Current Behavior

- Incoming and quoted messages and delegation embed attachment IDs, metadata, and local paths.
- Main reads text/images/PDFs with native read_file; tasks and workers have the full native workspace tools.
- inspect_message and optional inspect_task history reopen older message attachments.
- Public output contains text, replyTo, attachmentIds for existing files, and files with generated paths, filenames, and content types. Publication copies generated files into download storage.
- Message associations retain uploaded and delivered files. Unattached files expire after 24 hours. Task entities contain metadata and descriptions.

## Milestones

### 1. Remove Task Attachment Storage

Implementation tasks:

- [x] Remove task attachment fields, associations, retention methods, and file injection into task instructions.
- [x] Preserve delegation manifests, earlier-message lookup, immutable copies, and shared final delivery.
- [x] Generate and validate a forward migration dropping task_attachments while preserving task/message/file records.
- [x] Update architecture and file documentation to describe message retention.

Exit criteria:

- Task details expose task metadata and description. Files remain available through incoming messages, delegation, and public history.
- Delivered files survive cleanup; unattached files expire after 24 hours.

### 2. Simplify Agent File Access and Delivery

Implementation tasks:

- [x] Add native read_file to Main's available tools for quick inspection.
- [x] Preserve embedded metadata and older-message lookup.
- [x] Replace prepare_attachment with generated file declarations in structured output and copy files at publication.
- [x] Apply the single retry to invalid IDs, paths, and file declarations while preserving text after repeated failure.
- [x] Update instructions and native/HTTP regression coverage for Main's read-only tool set, generated output, and immutable downloads.

Exit criteria:

- Main can inspect incoming text/images/PDFs without filesystem write or command tools.
- Generated files publish through JSON path declarations with stable download bytes and correction feedback.

### 3. Validate and Update Local Runtime

Implementation tasks:

- [x] Run backend build/lint, targeted service/native-agent/HTTP suites, and playground build/attachment checks.
- [x] Run the configured-model file smoke for Main inspection, worker delegation, structured output, memory compression, and reopening files after restart.
- [x] Rebuild the local application, apply the validated migration, and verify API readiness.
- [x] Remove disposable validation resources.

Exit criteria:

- Checks pass with message-only retention and simplified file tools, and the local backend serves the updated contract.

## Tests

- Extend existing file HTTP coverage for delivered-file retention, immutable bytes, unsent-file expiry, and task details.
- Extend native file coverage for read-only Main inspection and generated-file retry with a recovery tool call. Reuse delegation and active-input coverage.
- Extend the real-model restart smoke to verify native Main inspection and direct generated-file declarations.
- Reuse playground mixed-file sending and task switching checks with the updated task type.
- Exercise the forward migration against populated old-schema fixtures and confirm tasks, messages, and file records survive.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- test/services.spec.ts test/main-session.spec.ts test/task-agents.spec.ts test/file-agents.spec.ts test/mcp.spec.ts test/task-workers.spec.ts
npm run test:e2e -- test/files.e2e-spec.ts test/chat.e2e-spec.ts
npm run files:smoke
cd ../frontend-playground
npm run build
npm test -- test/chat.spec.ts --grep 'uploads mixed|preserves selected|delegates into task'
```

Use a disposable PostgreSQL instance for database validation and the configured ChatGPT login for the smoke.

## Overall Exit Criteria

- Task schema, API, runtime context, and retention contain no task-level attachments.
- Main reads incoming files through native read-only tools; metadata remains embedded and older-message lookup remains available.
- Agents select generated files in structured output; backend copies them at publication without a preparation tool.
- Message-associated files remain downloadable and reopenable after cleanup, compression, and restart.
- Unpublished outputs expire through ordinary unattached-file cleanup.
- Current documentation and the local runtime match the contract.

## Deferred Work

Durable task artifacts and general document conversion need separate design.

## Validation Results

- Backend build, type-aware lint, targeted formatting, and git diff checks passed.
- PostgreSQL-backed service/native-agent checks passed: 6 suites, 16 tests. File/chat HTTP checks passed: 2 suites, 9 tests.
- Playground build and three targeted browser checks passed, covering task switching, mixed-file upload/preview/download, and selected-file retry.
- The configured-model smoke passed: Main read the incoming PDF and image through native read_file, delegated to a native worker, delivered a generated document and image through structured output, preserved shared final identity and exact bytes, compressed memory, restarted, and reopened the original document. Prior output bytes remained identical.
- The forward migration passed against populated old-schema fixtures: task attachment storage was removed while task, message, attachment, and message-association records survived.
- The local application image was rebuilt, migration applied, and container restarted. Backend and live playground API checks confirmed readiness and task details without an attachment list.
- The disposable validation database/container and smoke filesystem were removed.

## Remaining Work

None. Milestone and overall exit criteria are validated.
