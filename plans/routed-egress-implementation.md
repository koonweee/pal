# Routed execution egress

## Status

Done

## Goal

Give every execution application public internet access through an independent router container. Enforce private destination restrictions without client proxy configuration or manually installed host firewall rules. Preserve the persistent desktop across router recovery.

## Current Behavior

The [evaluation](routed-egress-gateway.md) validates an IPv4 Docker bridge with no host gateway address and a separate nftables router. The normal runtime uses Squid in web. Production's immediate Squid lifecycle hotfix is an independent deployment.

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
