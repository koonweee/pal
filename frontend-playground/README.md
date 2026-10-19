# Pal Frontend Playground

A small browser client for persistent Main and task conversations. It has its own dependencies, lockfile, build, tests, and local copies of the public API types. It uses HTTP/SSE for chat and embeds a shared desktop viewer over HTTP/WebSocket.

The production image serves the static build on port 8080 and proxies the browser API and desktop paths to the Pal runtime. Its 25 MiB request-body ceiling leaves room for multipart framing around the backend's 25,000,000-byte per-file limit. Native clients continue to use the backend's root API paths through the same origin.

## Run

Requires Node.js 24 and a running Pal backend. Follow the backend setup in `../backend/README.md`, including ChatGPT login, and start the backend separately.

From this directory:

```bash
npm install
npm run dev
```

With containerized Pal, start `pal` through the backend Compose recipe and keep Vite running on the Mac. The default backend URL works; if `PORT` changes the published backend port, set `PAL_BACKEND_URL` accordingly.

Open http://127.0.0.1:5173. The development server proxies `/api/chat/*`, `/api/tasks/*`, `/api/stream`, and attachment downloads to http://127.0.0.1:3000. The browser uses the same origin for HTTP and SSE. The proxy closes aborted backend streams so the browser reconnects after backend shutdown or recreation.

To use another backend, copy `.env.example` to `.env` and set `PAL_BACKEND_URL`, then restart Vite. Configuration belongs to this project. No backend configuration changes are required.

```bash
PAL_BACKEND_URL=http://127.0.0.1:3001 npm run dev
```

For access over a Tailnet address, bind the playground to that address with `npm run dev -- --host <tailnet-ip>` and open its port 5173. `PAL_BACKEND_URL` remains the address reachable from the machine running Vite.

## Desktop

The desktop icon on the left of the composer opens Pal's noVNC viewer in a bottom sheet sized to the 4:3 desktop. Close it with the close button, the backdrop, or Escape while focus is outside the viewer. The viewer loads when the playground starts and stays rendered off screen while closed, preserving its connection and state. Human and agent input share the same session without handover controls.

The header has paste, keyboard, and fullscreen icon buttons. Paste reads text from the client clipboard, sends it through the existing noVNC connection, and presses Shift+Insert in the focused desktop app. It supports Unicode text; browser clipboard access requires HTTPS or localhost and may prompt for permission. Clipboard failures appear in the sheet. A frontend module runs in the viewer frame and reuses its existing UI/RFB connection.

On touch devices, the keyboard button toggles noVNC’s native typing input and reflects whether it is focused. Fullscreen keeps the header visible and expands the same viewer. It uses browser fullscreen where noVNC supports it; Safari uses the available browser viewport. The sheet fits above the phone keyboard. Exit using the fullscreen icon, close button, or Escape outside the viewer.

Vite proxies `/desktop/*`, including WebSocket upgrades, to `PAL_DESKTOP_URL` (default `http://127.0.0.1:6080`) in both dev and preview. Set this independently of `PAL_BACKEND_URL` when ports or hosts differ. The browser uses the playground origin, including over a Tailnet connection. The embedded viewer uses a versioned asset path, and the proxy requires cache revalidation for desktop files so existing browser sessions load the patched JavaScript.

Touch devices use trackpad input: slide one finger to move the cursor, tap to click at the cursor, tap with two fingers to right-click, and drag with two fingers to scroll at the fitted scale. Pinch to magnify locally; two-finger drags pan while magnified. Tap then quickly drag, or hold then drag, to drag with the left button. Disable **Trackpad mode (touch)** in the viewer settings for direct touch input. The image includes the [pinned noVNC patch](../backend/desktop/novnc-trackpad.README.md).

The viewer scales its image while the remote display stays at 1200×900. noVNC reconnects after a session disconnect. If the desktop service was unavailable when the page loaded, use **Reconnect desktop** once it is available. The button appears when the desktop is disconnected; it stays hidden during connection and while connected. Chat remains usable during desktop outages.

## Chat

- Appearance follows the system light/dark preference and updates while the page is open. Dark mode uses an OLED palette with a true black background, neutral charcoal surfaces, and high-contrast text.
- Main and task history load on selection, with older pages available on demand.
- Task navigation includes paginated active and archived lists. The selected task shows its title, goal, description, status, and archive/unarchive control. Archiving hides it from the active list while work continues.
- The composer sends to the selected conversation and retains separate drafts when switching chats. Task finals share one message identity across task and Main views. Main includes unscoped messages and task assistant finals; task chat includes every matching task message. The client derives membership from role, task ID, and persisted phase.
- The composer expands with the draft, up to 180px; its themed scrollbar appears when more space is needed.
- Enter sends; Shift+Enter inserts a newline. Follow-ups stay available while Pal is working.
- User messages appear immediately without a pending label. Messages use rounded bubbles, right-aligned for you and left-aligned for Pal. Only the latest user message shows a subtle Read receipt and timestamp beneath its bubble when persistence is confirmed by SSE or a history snapshot, before agent acceptance. Idempotency keys reconcile optimistic bubbles with saved messages. Reconnect and reload preserve receipts, including when a later agent handoff fails. Assistant messages arrive through SSE.
- Reply on a saved user or assistant bubble quotes it in the composer. Cancel clears the selection; sending attaches the Pal message ID. Visible quotes open the original message, loading older history and briefly highlighting it when needed. Task-only quotes on shared finals appear only inside their task chat.
- The screen follows new messages when you are at the bottom. Loading older messages preserves your place.
- SSE reconnection refetches the selected chat's loaded history, loaded task-list pages, and open task details. Live events are buffered during snapshots, merged by ID/version, and filtered into the selected view. Failed history, task-list, and task-detail snapshots retry automatically after 2 seconds, doubling up to 30 seconds between attempts. Selecting a different thread or filter cancels obsolete retries. Pagination and write failures retain their explicit retry controls.
- The Working indicator gives a rough view of activity across Main and task runs.
- Send failures retain the draft and show an error. A handoff failure can leave the message in history. Sending again creates a fresh submission; there is no automatic retry.
- Assistant Markdown is sanitized. User input is displayed as plain text. Attachments support download and full-image viewing. One image retains its proportions; two to four use a two-column square grid, and five or more use three columns. Documents use uniform 244 × 72 px pills (constrained by available width), with a paperclip/type graphic, truncated filename preserving its extension, and size.

The browser sends its inferred IANA timezone as message metadata for Main and task submissions.

The screen supports Main and task text chat. On mobile, the full-width selected-thread button opens a sidebar with Main, tasks, and the Archived filter. Selecting a thread closes the sidebar; Escape, the close button, or the backdrop also dismiss it. Desktop shows the thread list beside chat. Attach arbitrary files with the paperclip button or drag/drop; paste clipboard images into the composer. Up to 100 files are allowed per message, with a 25 MB limit per file and three concurrent uploads. Send becomes available after all selected files upload successfully. Retry or remove failed uploads. Pending images and documents use matching 183 × 52 px pills in one horizontal scrolling row. Edge fades indicate more files in the scroll direction; filenames and status text truncate, with full text available on hover. File-count errors stay with their chat and clear when a selected file is removed. Unchanged image previews and upload controls stay mounted during updates, preserving loading state and keyboard focus. File-only messages are supported; file selections, text, and replies persist separately per chat. Action selection is deferred.

## Validate

The header’s settings icon opens **Connected services**, with a server list and an **Add server** button. **Manage** groups Edit, Sign in again, Forget login, and Remove server. Add/Edit opens a separate form. Choose authentication and **Save server**; OAuth servers offer **Sign in**, with an authorization link and automatic status updates while sign-in is pending. Once login is saved, **Apply changes** refreshes all connections when Pal is idle. Busy Apply returns an error and can be retried after work finishes. Connection failures show a **Retry connections** action alongside their details.

OAuth offers a client ID or client metadata URL. Secret fields stay blank when editing; a blank client secret retains the saved value, and **Remove saved client secret** clears it. Bearer tokens use a password field and are saved as an Authorization header. Custom headers use name/value rows: leave all saved values blank to retain them, enter every value when replacing them, or remove all rows to clear them. Forget login and Remove server ask for confirmation. OAuth callbacks use the backend’s `PAL_PUBLIC_URL`, independently of the playground proxy. Register `<PAL_PUBLIC_URL>/mcp/oauth/callback` with the provider. The management API and client contract are documented in [backend architecture](../architecture/backend.md#connected-services-mcp).

Provider endpoints, OAuth registration, and scopes belong in private instance configuration. Task agents use connected tools; Main delegates service requests. MCP Apps are unsupported.

```bash
npm run build
npx playwright install chromium
npm test
```

If Google Chrome is installed, `PLAYWRIGHT_CHANNEL=chrome npm test` uses it without downloading Chromium. Set `PLAYWRIGHT_PORT` if the default test port 5174 is occupied. Tests run a controlled HTTP/SSE backend and a separate Vite server; they do not use your conversation or ChatGPT login.

Manual check with the real backend:

1. Send a question and verify the user message and assistant response appear.
2. Ask for a longer answer, then send a correction while the Working indicator is visible.
3. Reload and confirm the conversation remains, with one copy of each message.
4. Load older history, stop and restart the backend, and verify the connection recovers and refreshes the loaded range.
5. Delegate work through Main, open the task, and send a correction directly. Check that task commentary stays in the task and its final appears in both chats.
6. Archive the task, open it from the archived list, and unarchive it. Check a narrow browser window and confirm the task composer remains usable.

`npm run format` formats the playground source and tests. `npm run check` performs TypeScript checking. `npm run build` includes that check and creates `dist/`. `npm run preview` serves the build with the same local backend proxy on port 5173.
