# Routed execution egress

## Status

Done

## Goal

Give every execution application public internet access through an independent router container. Enforce private destination restrictions without client proxy configuration or manually installed host firewall rules. Preserve the persistent desktop across router recovery.

## Current Behavior

The Compose runtime uses an IPv4 transit bridge with no host gateway address and a separate nftables router. Production continues to use its separately deployed Squid lifecycle hotfix. Development publishes its staged PWA through a single-network Nginx ingress; web retains service/transit connections for browser and desktop forwarding.

## Milestones

### 1. Integrate the routed runtime

Implementation tasks:

- Package nftables, iproute2 and arping in a small trusted router image.
- Install policy before advertising the transit gateway; disable IPv6 and deny private, link-local and Tailnet destinations.
- Add the router and transit network to supported Compose workflows; retain web/CDP/noVNC ingress restrictions.
- Remove Squid, client proxy settings and superseded lifecycle tooling.

Exit criteria:

- Normal and smoke Compose definitions render consistently, execution has no alternate route, and all internet clients use the router.

### 2. Verify isolation and independent recovery

Implementation tasks:

- Verify public HTTP, arbitrary TCP/UDP and denied reachable private fixtures.
- Verify execution root cannot change router policy, routes or raw packet access.
- Verify delayed startup, router failure/restart/replacement and independent execution restart.
- Run the existing native browser/desktop smoke through the integrated configuration.
- Document supported versions, network allocation, upgrade impact and production acceptance steps.

Exit criteria:

- Policy remains enforced across tested lifecycle operations; connectivity recovers without replacing the desktop; native workflows pass.

## Tests

Use one isolated router regression suite for destination policy, privilege boundaries and lifecycle behavior. Reuse the split-stack native/browser smoke. Preserve development and production state.

## Validation Commands

```sh
python3.12 scripts/test-gateway-lifecycle.py
bash -n scripts/dev-local
sh -n network-gateway/start.sh backend/scripts/split-stack-smoke.sh
node --check backend/scripts/split-stack/check.mjs
git diff --check
```

The normal development Compose render and isolated execution/web/egress image builds also pass. Web build includes strict application/test TypeScript checks. Native integration evidence is retained locally under `.local/routed-gateway-evaluation-20261023/integrated-native/`.

## Overall Exit Criteria

- Routed egress is the supported local Compose implementation and Squid is removed from that implementation.
- Essential policy, recovery and native workflow checks pass.
- Architecture and operational guidance describe the implementation and remaining production-platform acceptance. Production rollout remains a separate release operation.

## Validation Results

- The production Compose-derived gateway regression passes ordinary aiohttp, raw TCP/UDP, a custom port, and blocked reachable private/Tailnet/link-local fixtures. The router can reach every private fixture, proving execution rejection is policy enforcement.
- Delayed bootstrap and execution-first startup pass. Dynamic IPAM uses the upper /25, reserving the router's static address before it starts.
- Execution root cannot change routes or nftables, open raw sockets, use a new user namespace to change parent routing, or bypass policy with IPv4-mapped IPv6.
- Router stop, restart, replacement and automatic recovery preserve execution's namespace and process start identity. Independent execution restart retains restrictions.
- Isolated actual execution/web/egress images pass browser navigation, task/worker grouping, browser/native screenshots, screen/cursor/input checks, public TLS, execution-to-API 403, and noVNC HTTP/WebSocket. Chromium and Xtigervnc PIDs and execution namespace remain identical across router replacement; the native workflow succeeds afterward.
- Live Chromium command lines have no proxy argument. An initial auxiliary process check matched its checking shell; the corrected Chromium-only check passes.
- Six development commands reject the old network layout before Docker mutation. Existing development proxy egress still returns 200; its desktop and data remain running. Disposable containers, volumes, networks and image tags are removed.
- Independent security/lifecycle review finds no blocking issue.

## Release Work

Implementation and local acceptance are complete on OrbStack ARM64, Engine 29.8.2 and Compose 5.5.0. Production continues to run the separately deployed Squid hotfix.

A routed production release needs a manual egress image Build, reviewed immutable image pins, deployment Compose/health-check updates and an unused transit prefix. Migrate web, execution and the execution network together; home/browser data persist and running desktop applications stop. Validate native AMD64/production-kernel behavior and a full Docker-daemon or VM reboot. IPv6 is disabled. Preserve prior image/network definitions and paired application state for rollback.

## Development Cutover and Ingress

Implementation tasks:

- Preserve persistent volumes and back up the stopped shared home, service data and PostgreSQL before replacing the old execution network.
- Deploy current agent, desktop, PWA and router images through the supported development script.
- Publish the dev PWA through a service-only Nginx ingress. OrbStack 2.2.4 forwards the dual-network web port directly to its isolated transit IP; Linux host port access works, while Mac localhost times out. Network priority and interface naming do not repair that platform behavior. The ingress preserves the existing loopback port and Tailnet URL, including Host headers, streaming, uploads and WebSockets. Production Compose is unchanged.
- Have up/rebuild verify the actual published PWA health endpoint. Existing pwa-up owns staging/update notification.

Exit criteria:

- Native browser/desktop, shell/filesystem, public internet, private destination filtering and independent router recovery pass on the migrated dev stack.
- Vite, local PWA and Tailnet API/SSE/noVNC access pass; data counts and private backups are verified.

Development acceptance:

- Current native authentication/login improvements and routed egress are deployed together. Shared home, service data and all checked row counts are preserved: 11 tasks, 510 public messages, 786 Mastra messages and 39 remembered login sites. Local cutover backups and temporary state are removed after acceptance.
- Public Node fetch succeeds for IANA, Apple and Wikipedia. Execution-to-API requests receive 403; Tailnet/metadata requests fail; execution root lacks NET_ADMIN/NET_RAW. The native browser/desktop smoke passes using IANA because example.com rate-limited the initial request. Shell and native filesystem operations pass.
- An independent router restart restores public access while execution identity/start time and Chromium PID remain unchanged. Native authentication skill discovery and vault initialization pass.
- Vite, staged PWA and the existing Tailnet PWA URL pass real-browser API, manifest, SSE contract and noVNC HTTP/WebSocket checks. Normal `./scripts/dev-local up` and `pwa-up` pass without replacing the desktop; the PWA update notice is published. Startup/rebuild check the real published PWA health URL.
- Dev uses seven services, including its Vite and PWA ingress. Production Compose remains five services. Disposable probe containers/networks are removed. The former local latency-only deployment helper is retired; supported dev commands own the routed stack.
