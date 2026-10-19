# Local Development Stack

## Status

Done

## Goal

Run the complete Pal stack from local source on the development Mac, with the React app available on loopback with hot reload. Keep development data, agent authentication, and external delivery isolated from production.

## Current Behavior

- `backend/compose.yaml` builds the backend, Main and Task agents, shared X11 desktop, and noVNC into one local image and runs PostgreSQL separately.
- `frontend/` runs under Vite with API and noVNC same-origin proxies.
- The normal backend environment can enable production Telegram and APNs credentials, so it is not an appropriate default for an isolated development runtime.

## Milestones

### 1. Isolated Development Topology

Implementation tasks:

- [x] Add a development Compose overlay with an isolated project, local source build, persistent development data, and a hot-reloading Vite service.
- [x] Bind every published port to Mac loopback.
- [x] Use a development backend environment that omits Telegram and APNs credentials by default.

Exit criteria:

- [x] `http://localhost:5173` serves the full local stack and frontend source changes hot reload.
- [x] Development database, agent state, and credentials are distinct from production.
- [x] No development service listens on a LAN or Tailnet address.

### 2. Repeatable Lifecycle and Documentation

Implementation tasks:

- [x] Add a checked-in lifecycle command that builds, migrates, starts, inspects, and stops the stack.
- [x] Document first-time ChatGPT login, local MCP OAuth callbacks, optional delivery credentials, rebuild behavior, and safe teardown.
- [x] Link the workflow from the repository and component documentation.

Exit criteria:

- [x] A future agent can deploy the stack from repository instructions without reconstructing its topology.
- [x] Missing interactive credentials produce one actionable login instruction.
- [x] Stopping the stack preserves development data and authentication.

### 3. End-to-End Validation

Implementation tasks:

- [x] Run configuration, TypeScript, and build checks for the changed files.
- [x] Start the isolated stack and verify health, frontend assets, SSE, HMR, and the real noVNC HTTP/WebSocket path through the loopback origin.
- [x] Run one bounded real-agent conversation when development authentication is available.

Exit criteria:

- [x] Automated checks pass and the local development URL works on the Mac.
- [x] Development ChatGPT device login is complete and persisted in the isolated agent volume.

### 4. Optional Tailnet Serve

Implementation tasks:

- [x] Add scoped lifecycle commands that expose only the loopback Vite origin through Tailscale Serve and remove only the managed HTTPS endpoint.
- [x] Preserve every unrelated Tailscale Serve route and refuse to replace a conflicting port.
- [x] Align Vite host admission and the backend public/OAuth origin with the generated Tailnet URL while Serve is enabled.
- [x] Document persistence, shutdown, credentials, and WebSocket validation.

Exit criteria:

- [x] The development app is reachable through a tailnet-only HTTPS URL without publishing any container port beyond loopback.
- [x] HTTP, SSE, HMR, and noVNC are tested through the Serve origin.
- [x] A future agent can enable, inspect, and disable the route without resetting other Serve configuration.

## Tests

- Compose configuration contains loopback listeners only.
- Frontend strict TypeScript and production build pass.
- Backend build and focused health checks pass.
- Live smoke covers HTTP health, SSE, Vite HMR, noVNC WebSocket, and one real agent response when authenticated.
- Tailnet smoke covers HTTP health, SSE, a real HMR update, and the connected noVNC canvas through the HTTPS Serve origin.

## Validation Commands

```bash
./scripts/dev-local config

cd frontend
npm run check
npm run build

cd ../backend
npm run build

cd ..
./scripts/dev-local up
./scripts/dev-local status
```

## Overall Exit Criteria

- One documented command runs the full isolated local stack and serves the hot-reloading web app on Mac loopback.
- The local Main and Task agent runtime and shared desktop are usable through the web app.
- Production data, production agent state, and production delivery credentials are not used by default.
- Future agents can identify required credentials, rebuild backend changes, inspect logs, and preserve or intentionally remove development state.
- Optional Tailnet access preserves the loopback-only container boundary and unrelated Tailscale Serve routes.
- Production-style `Pal Dev` staging runs beside loopback-only hot reload and owns the single conflict-checked Tailnet route for installation and update testing.

## Validation Evidence

- The merged Compose configuration publishes Vite, backend, noVNC, and PostgreSQL only on `127.0.0.1` at ports `5173`, `13000`, `16080`, and `15433`. A direct request to the Mac's Tailnet address failed as expected.
- `frontend`: strict application/test TypeScript and the production Vite build passed.
- `backend`: Nest build, type-aware Oxlint, and adapter-boundary checks passed.
- The running stack reports healthy PostgreSQL and backend services; `http://localhost:5173/api/health` returns `{ "status": "ok" }`.
- A headless Chromium session observed the SSE response, Vite HMR WebSocket and real update frame, noVNC WebSocket, connected desktop state, and visible canvas through the local frontend.
- The isolated Main agent accepted one labeled smoke message and published the exact final response `LOCAL DEV READY`.
- Tailscale Serve exposes a generated Tailnet-only HTTPS route to the production-style PWA at `127.0.0.1:14173`; Vite hot reload remains on Mac loopback at `127.0.0.1:5173`.
- The Tailnet PWA provides same-origin API, SSE, noVNC, manifest, service-worker, and update behavior while preserving unrelated Serve routes.
- `./scripts/dev-local serve`, `unserve`, and `pwa-up` own the production-style `Pal Dev` image and its scoped route.
