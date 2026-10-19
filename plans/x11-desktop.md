# X11 Desktop and Native Computer Tools

## Status

Done

## Goal

Give Main and the user a shared Xfce desktop inside the existing Pal container. Main operates the desktop through Mastra's native computer tools; the user views and controls the same desktop from the frontend playground.

## Current Behavior

- The runtime image runs NestJS, Main, Xfce/X11, the accepted apps, and a shared noVNC service as `pal`. Compose persists `/data` and publishes API/viewer ports on host loopback.
- Supervisor starts the API after desktop readiness and restarts desktop services independently. Persistent home settings survive recreation; runtime session files remain ephemeral.
- Main's static Workspace exposes LocalFilesystem and X11Sandbox. The pinned `@mastra/core@1.76.0` registers native computer tools from the X11 computer capability, retaining local command/background-process tools.
- The playground opens noVNC from the composer in a bottom sheet sized to the 4:3 desktop. The viewer stays rendered while closed, uses Vite's HTTP/WebSocket proxy, and shows Reconnect only when disconnected. Desktop-disabled development keeps chat available.
- The image and live desktop are validated on Linux ARM64.

## Accepted Decisions

- Run Nest, Main, Xfce, and desktop applications in the existing container as `pal`. Main and the human share one desktop.
- Use Xfce on X11, TigerVNC's virtual X server, and noVNC embedded in the playground. Target Pal-provisioned environments.
- Use a single 1200×900 display at 100% scaling, with a US keyboard layout and Unicode text entry. Viewer resizing scales the image without changing the desktop resolution.
- Install Chromium, Xfce Terminal, Thunar, and fonts covering ordinary web content, Chinese/Japanese/Korean, and emoji.
- Preserve profiles, browser cookies, desktop preferences, and saved files under the existing persistent home. Restart with a fresh desktop session; running applications and unsaved documents are not preserved. Durable system dependencies belong in the image.
- Human and agent input can overlap. There is no takeover lock, input arbitration, or automatic agent pause.
- Implement the native Mastra computer capability, including an optional configured viewer URL. Keep screenshots in private tool results and preserve existing public text publication.
- Require desktop readiness before normal container API startup completes. After startup, desktop failure leaves chat and shell available; computer calls fail clearly until the desktop recovers.
- Use basic standard process supervision and bounded startup checks. Desktop-disabled host development remains supported.
- Preserve current agent permissions and private ingress assumptions. No new X11-specific security layer is required.
- Accessibility tooling is excluded because it is outside Mastra's desktop contract.

## Integration Contracts

### Desktop runtime

- Keep the existing application and data paths. GUI processes and agent commands share `DISPLAY`, the session D-Bus address, and any required X authority/runtime-directory settings.
- Use ephemeral runtime files for session sockets and process locks. Seed persistent preferences only when absent.
- Keep one supervised desktop session with its X server, D-Bus session, and Xfce components, plus the WebSocket bridge and API. Use Supervisor's existing retry, process-group, logging, and shutdown facilities.
- A bounded API startup check waits for an operational X display and window manager. Supervisor start order alone does not prove readiness.
- Later desktop restarts do not restart the API. The adapter reconnects through current X11 services rather than retaining a dead connection.
- Preserve standalone login command overrides and graceful Main shutdown within the existing Compose stop budget.

### Mastra adapter

- Add a small X11 computer adapter and a LocalSandbox subclass exposing it through `readonly computer`. Reuse native command execution, filesystem access, and background-process management.
- Implement the pinned `SandboxComputer` interface:

| Method | Contract |
| --- | --- |
| `screenshot()` | PNG bytes as `Uint8Array`, with `mediaType: 'image/png'`. |
| `leftClick(x, y)`, `rightClick(x, y)`, `doubleClick(x, y)` | Button actions at display-pixel coordinates. |
| `moveMouse(x, y)` | Move the pointer. |
| `drag(from, to)` | Press, move, and release between two positions. |
| `scroll(direction, amount)` | Up/down scroll in positive integer ticks. |
| `type(text)` | Literal text entry into the focused application, including Unicode. |
| `press(key)` | One key or a simultaneous chord, using Mastra key names. |
| `getScreenSize()` | Current width and height. |
| `getCursorPosition()` | Current pointer coordinates. |
| `streamUrl()` | Configured browser-accessible viewer URL, or null when unconfigured. |

- Prefer supported X11 utilities/libraries for capture and XTEST input; start with xdotool/libxdo for input and window queries. Select the smallest capture dependency that returns correct PNG bytes on the container architecture.
- Normalize key names and scroll units in the adapter. Pass user text as data through argument arrays or stdin. Bound subprocess execution and release pressed keys/buttons on failure.
- Validate Unicode text entry with the chosen input primitive before finalizing it; document any additional primitive required to meet that contract.
- Let Mastra register its computer tools, format media results, and perform its default post-action screenshots. Do not duplicate its wait tool, screenshot orchestration, or tool schemas.
- Enable the adapter explicitly through validated configuration, on by default in Compose and off for ordinary host development. Reuse standard `DISPLAY`; document introduced flags and optional viewer URL in `.env.example`.
- Preserve current Main identity, model/authentication path, memory, publication behavior, and approval settings. No database migration or chat API change is expected.

### Playground viewer

- Serve the packaged noVNC application through websockify in the container and embed it in a bottom sheet opened by the desktop icon on the left of the composer. Keep the viewer rendered off screen when closed.
- Add a dedicated Vite HTTP/WebSocket proxy for the desktop service in both dev and preview configurations. Keep browser URLs on the playground origin.
- Publish the desktop HTTP/WebSocket service on host loopback; keep raw VNC internal for this scope. Follow the current private-network deployment model.
- Use noVNC's supported shared-input, scale, and reconnect options. Preserve the fixed 1200×900 desktop and show connection failures through its existing UI.
- Preserve keyboard focus between chat and the viewer. Viewing or interacting does not change Main's execution state.
- Treat the viewer as optional in desktop-disabled development; chat remains usable when the viewer is unavailable.
- Use an explicit externally reachable viewer URL for `streamUrl()` when configured. Do not infer a user's browser origin from container networking.

## Milestones

### 1. Build and Start the Desktop

Implementation tasks:

- [x] Extend the runtime image with Xfce, TigerVNC, D-Bus, Chromium, terminal/file manager, fonts, noVNC/websockify, Supervisor, and required X11 utilities.
- [x] Configure the desktop as `pal` at 1200×900 with 100% scaling. Disable automatic screen blanking/locking and session restoration for unattended operation.
- [x] Establish shared session environment settings for desktop apps, Nest, and agent commands. Keep runtime files ephemeral and existing persistent home ownership intact.
- [x] Add standard supervision and bounded startup readiness. Group desktop processes so an X server failure can recreate a usable session without replacing the API.
- [x] Configure foreground logs and orderly shutdown. Preserve standalone compiled login execution.
- [x] Launch Chromium as `pal` with a persistent profile and verify its default sandbox works in the deployment. Resolve concrete container compatibility failures before introducing browser flags.
- [x] Extend Compose with the loopback desktop service port and desktop-enabled configuration; adjust shared memory only as required for reliable Chromium operation.

Exit criteria:

- [x] A clean image builds on the current Linux ARM64 environment; all baseline apps launch on the same desktop.
- [x] The display is 1200×900, text/emoji render, and startup reaches an operational window manager without a login dialog.
- [x] Existing files and first-use preferences survive recreation; a fresh session starts without restoring old running apps.
- [x] Desktop-disabled development and standalone login still work.
- [x] Shutdown fits the existing stop budget and terminates the desktop process group.

### 2. Add the Native Computer Capability

Implementation tasks:

- [x] Implement the X11 adapter against the installed Mastra types and attach it through the LocalSandbox subclass.
- [x] Add configuration plumbing through environment validation, MastraAgentRuntime, and createMainSession.
- [x] Validate every required method against a disposable desktop fixture, including exact PNG dimensions, pointer position, buttons, drag, scroll, literal/Unicode typing, and modifier chords.
- [x] Retain native Mastra media handling and post-action screenshots; verify AgentController exposes the computer tools alongside existing workspace tools.
- [x] Verify tool screenshots reach the configured model as image content through the existing ChatGPT provider path.
- [x] Ensure temporary display loss produces bounded tool errors and subsequent calls work after desktop recovery.

Exit criteria:

- [x] Main receives the native computer tool set only when desktop support is enabled.
- [x] All computer methods produce the expected observable desktop behavior.
- [x] Existing file, command, background-process, and cancellation behavior remains intact.
- [x] Screenshot/tool payloads remain private while Main's ordinary text continues through chat history/SSE.
- [x] No custom accessibility or duplicate computer tools are introduced.

### 3. Embed the Desktop in the Playground

Implementation tasks:

- [x] Embed the packaged noVNC viewer in a responsive bottom sheet opened from the composer; preserve its mount, rendering, and connection while closed.
- [x] Add and document the desktop target configuration and Vite HTTP/WebSocket proxy for dev and preview.
- [x] Configure shared connections, local image scaling, and native reconnect behavior.
- [x] Validate manual mouse/keyboard interaction, chat/viewer focus, and coexistence with agent activity.
- [x] Handle an unavailable desktop without disrupting chat or its SSE reconnect behavior.

Exit criteria:

- [x] The playground shows the same desktop Main screenshots and controls.
- [x] Human interaction works without a takeover flow or pausing Main.
- [x] Browser viewport changes preserve the remote resolution and correct pointer coordinates.
- [x] The viewer reconnects after desktop/container restart; chat recovers through its existing path.
- [x] Dev and preview proxy both desktop assets and WebSocket traffic.

### 4. Validate the Complete Workflow and Document Deployment

Implementation tasks:

- [x] Run a bounded real-model task using a local browser fixture: inspect visible content through screenshots, click/type through native computer tools, and publish the observed result.
- [x] Verify browser-profile persistence with a harmless local cookie and saved settings, alongside a saved file; recreate only Pal and check all three.
- [x] Exercise desktop failure/recovery after startup and verify chat/shell availability during the outage.
- [x] Record actual idle and browser-active resource use for the chosen image without introducing resource-budget infrastructure.
- [x] Update backend/playground READMEs, configuration examples, and architecture documentation to describe implemented startup, viewer routing, persistence, adapter ownership, and failure behavior.
- [x] Update this plan and the index only after exit criteria are validated.

Exit criteria:

- [x] The real-model task demonstrates visual observation and action through the existing model/auth path.
- [x] Persistence, recovery, shutdown, and playground interaction pass in the live container.
- [x] Required checks pass and documentation reflects the implemented behavior.

## Tests

- One Linux desktop smoke suite with a disposable GUI/browser fixture covers the 11 adapter methods and actual input results. Include Unicode, literal shell-like text, modifiers, dragging, and a display outage; avoid separate tests that only mirror subprocess arguments.
- Extend the existing Main controlled-model integration scenario to cover computer tool registration, PNG image delivery to the next model step, and private tool-result publication. Keep the desktop-disabled case within existing coverage.
- Extend playground coverage for chat/viewer coexistence and unavailable-viewer behavior. Validate the real noVNC/WebSocket path and reconnect in the container smoke sequence rather than implementing a fake VNC server.
- One container lifecycle sequence covers startup, app launch, persistence, desktop recovery, viewer reconnect, and shutdown.
- One bounded real-model smoke confirms actual screenshot understanding and computer-tool use. Use disposable local content and avoid external accounts.

## Validation Commands

From `backend/`:

```bash
npm run build
npm run lint
npm test -- test/main-session.spec.ts
npm run test:e2e
docker compose build pal
docker compose up -d --wait postgres
docker compose up -d pal
npm run desktop:smoke
npm run desktop:smoke -- --agent
docker compose stop pal
docker compose up -d --force-recreate pal
```

`desktop:smoke` exercises the running container with disposable fixtures. `desktop:smoke -- --agent` adds a bounded visual task using the configured model and an isolated test schema. The commands preserve production conversations and named volumes; migrations/login follow the existing bootstrap procedure.

From `frontend-playground/`:

```bash
npm run build
PLAYWRIGHT_CHANNEL=chrome npm test
```

Run the full backend service suite if implementation changes shared lifecycle/configuration behavior beyond the targeted Main scenario. Record live smoke results before marking milestones done.

## Deferred Work

- Wayland, accessibility trees/actions, dedicated browser automation, and screenshot attachments in public chat.
- Multiple desktops/agents, takeover controls, input arbitration, and session restoration of running applications.
- GPU-dependent workloads, audio, microphone/webcam, multiple monitors, and dynamic desktop resizing.
- New authentication/approval systems or X11-specific security controls.
- Direct VM provisioning, remote-provider abstractions, snapshots, and application self-update workflows.

## Overall Exit Criteria

- [x] The existing container boots a persistent-home Xfce/X11 environment with the accepted apps and display settings.
- [x] Main uses native Mastra computer tools while retaining its existing shell/filesystem capabilities and chat contracts.
- [x] The playground provides a working shared desktop viewer with manual input and reconnect.
- [x] Desktop failures are bounded and recoverable without taking down an already-running chat/shell session.
- [x] Persistence and shutdown behavior match the accepted decisions.
- [x] Validation evidence is recorded and plan/index status is accurate.

## References

- [Mastra computer capability](https://mastra.ai/reference/workspace/sandbox#computer-capability); implementation must follow the installed core types.
- [TigerVNC virtual display and configuration](https://tigervnc.org/doc/Xvnc.html).
- [noVNC embedding and reconnect/resize options](https://novnc.com/noVNC/docs/EMBEDDING.html).
- [Supervisor process configuration](https://supervisord.org/configuration.html).
- [Playwright Chromium sandbox configuration](https://playwright.dev/docs/docker#crawling-and-scraping) and [profile provenance](../backend/desktop/seccomp.README.md).
- [Chromium profile lock handling](https://chromium.googlesource.com/chromium/chromium/%2B/master/chrome/browser/process_singleton_linux.cc).

## Validation Evidence

- 2026-10-06: The ARM64 runtime image builds and boots Xfce at 1200×900. Native Pillow capture returns a PNG with matching dimensions. Xfce Terminal, Thunar, Noto Sans, Noto CJK, and Noto Color Emoji are installed.
- Backend build/lint pass. All seven service/Main tests and six end-to-end tests pass. The Main regression confirms native computer tool registration, image content in the model's next prompt, private tool results, and existing command cancellation.
- Playground build and all three browser tests pass. Live Chrome checks pass for noVNC through dev and preview HTTP/WebSocket proxies, manual keyboard input, returning focus to chat, and narrow layouts without changing the remote resolution.
- Stopping/restarting the desktop leaves the API process and chat available; the viewer reconnects. Container stop completes in 1.82 seconds. Recreation preserves a home-file fixture and an Xfce settings fixture; desktop and chat reconnect.
- xdotool's zero-delay input dropped Unicode characters; 12 ms still lost a character. A 50 ms delay passed three repeated samples containing accented Latin, Chinese, Japanese, Greek, and emoji. The adapter uses that delay for Unicode chunks and bounds each subprocess.
- A real configured-model check passed in an isolated test schema using a disposable Xfce Terminal fixture: Main called screenshot, type, and press-key tools to read and enter a random visible code. No shell/filesystem tools were used and the production conversation was unchanged.
- An idle container sample before the model check measured 482.2 MiB and 0.09% CPU on the current host. A browser-active sample measured 618.6 MiB and 2.15% CPU. These are point-in-time readings, not capacity limits.
- Chromium's default Docker seccomp restrictions prevented namespace creation. Compose now uses Moby seccomp v0.2.3 with the three namespace allowances documented by Playwright. `chrome://sandbox` confirms namespace, PID/network namespace, Seccomp-BPF, and TSYNC protection; no browser sandbox-disable flags or additional container capabilities are used.
- `npm run desktop:smoke` passes every method against Chromium, including literal/Unicode text, drag, scroll, chords, and display-loss errors. `npm run desktop:smoke -- --agent` exits successfully after Main reads a random code from the browser screenshot, types it, clicks Confirm, and reports it using only native computer tools. A bounded removal retry resolves the observed Chromium profile-cleanup race.
- The final image builds and preserves saved preferences rather than overwriting startup defaults. A harmless persisted cookie, browser local storage, Xfce preference, and home-file fixture survive Pal recreation. Compose uses a stable hostname to resolve the observed Chromium profile-lock failure after recreation. Browser state was committed by closing the fixture normally before replacement; all fixtures were removed.
- A disposable desktop-disabled container serves chat with no desktop processes. The standalone compiled device-login entrypoint invokes the supported auth workflow independently; validation stubs login to avoid replacing credentials.

- The composer desktop icon opens a compact bottom sheet. Browser coverage confirms eager viewer mounting, preserved input state across toggles, dismissal/focus, 4:3 sizing, and connection-dependent Reconnect visibility. Live Tailscale checks retain one VNC connection while toggling the sheet; the 390×844 layout uses a 355 px sheet without vertical letterboxing.

- The final ARM64 image includes `fonts-noto-cjk`. Fontconfig selects Noto Sans CJK SC and verifies coverage for Simplified/Traditional Chinese, Japanese, and Korean sample characters. The package is also installed and cached in the running desktop.

## Remaining Work

None. Deferred scope remains listed above.
