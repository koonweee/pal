# Routed Execution Egress Evaluation

## Status

Done

## Goal

Evaluate portable, transparent public internet access for the execution container. Keep private services inaccessible, preserve the persistent desktop across gateway replacement, and require no manually installed host firewall rules. Compare maintained solutions before choosing implementation work. Production continues to use Squid.

## Current Behavior

Execution joins an internal Docker network and uses Squid in web. Chromium has an explicit proxy argument; command clients receive proxy environment variables. Plain Docker bridge networks do not provide destination-based egress policy.

Two shared-network sidecar prototypes have lifecycle failures: a network-owner restart disconnects execution, while restarting execution under an attached filtering helper creates an unfiltered namespace. Compose readiness does not coordinate native runtime restarts.

## Candidate

Execution keeps its own network namespace on a dedicated transit bridge. Docker's documented inhibit_ipv4 option leaves the host bridge without its gateway address. A separate router joins transit and uplink networks, installs nftables policy, and then claims the transit gateway address. Execution has neither NET_ADMIN nor NET_RAW. IPv6 remains disabled for this IPv4 candidate.

The router uses packaged nftables, iproute2 and arping. Policies block private/reserved IPv4 and Tailnet destinations, allow public TCP/UDP, and apply source NAT. Its gateway address is unavailable until policy installation succeeds. A gratuitous ARP announcement refreshes clients after router replacement. Local web/CDP/noVNC paths retain their existing ingress boundary.

## Milestones

### 1. Review Maintained Solutions

Implementation tasks:

- [x] Review Gluetun, Whalewall, DCFW, OpenWrt's official container and Tecnativa Docker Whitelist Gateway against the current policy and deployment constraints.
- [x] Distinguish direct documented support from changes a fork would require.

Exit criteria:

- Candidate gaps and reuse options are explicit.

Findings:

| Solution | Fit |
| --- | --- |
| [Gluetun](https://github.com/passteque/gluetun) | VPN client with a tunnel kill switch; introduces a VPN dependency and commonly shares the client's namespace. |
| [Whalewall](https://github.com/capnspacehook/whalewall) | Runs with host networking and Docker socket access to change global host firewall rules. |
| [DCFW](https://github.com/dimajix/dcfw) | Injects policy into running container namespaces; requires separate validation of startup/restart races. |
| [OpenWrt container](https://github.com/openwrt/docker#rootfs-experimental) | Upstream marks the runtime image experimental and intended for special cases such as CI. |
| [Tecnativa Docker Whitelist Gateway](https://github.com/Tecnativa/docker-whitelist-gateway) | Routed gateway plus namespace-sharing setup helper; domain/IP allowlists require changes for unrestricted public access with private ranges denied. |

These candidates were reviewed from primary documentation and available source; they were not deployed into Pal.

### 2. Validate Routing and Lifecycle

Implementation tasks:

- [x] Verify ordinary aiohttp, raw TCP/UDP, custom destination ports, actual public HTTPS and controlled private endpoints.
- [x] Verify execution root cannot alter routes/rules or use raw packet sockets; check user namespace behavior and IPv4-mapped IPv6.
- [x] Start execution before a delayed router and verify blocked private access throughout bootstrap.
- [x] Kill, restart and replace the router without restarting execution; verify restored connectivity and preserved restrictions.
- [x] Restart execution independently and verify restrictions remain effective.

Exit criteria:

- Public access recovers after policy readiness without an execution restart or a temporary private route.

### 3. Validate Pal's Browser/Desktop Path and Record Decision

Implementation tasks:

- [x] Use a fresh execution desktop and the actual Docker execution adapter, BrowserService, browser extension and native desktop tools.
- [x] Verify noVNC access and execution-to-API denial through an isolated gateway configuration.
- [x] Record local results, production acceptance limits, and implementation recommendation.
- [x] Remove disposable evaluation containers, volumes and image tags; retain evidence.

Exit criteria:

- The current user workflow remains functional in the prototype and the recommendation states its tested scope.

## Tests

One disposable routing suite covers policy, privilege boundaries and independent lifecycle operations. Reuse the existing split-stack browser/desktop smoke with a deterministic HTTP fixture and an evaluation-only browser launcher without proxy settings. Existing development and production state stay outside the test project.

## Validation Commands

Local evidence and runnable prototype files live under .local/routed-gateway-evaluation-20261023. No production service changes are part of this evaluation.

```bash
python3.12 .local/routed-gateway-evaluation-20261023/evaluate.py
docker compose -p pal-routed-gateway-evaluation-20261023 -f .local/routed-gateway-evaluation-20261023/compose.yaml -f .local/routed-gateway-evaluation-20261023/compose-native.yaml run --rm service
```

## Overall Exit Criteria

- A concrete comparison and tested recommendation identify the required custom configuration.
- Local failure/recovery probes are complete and their limits are recorded.
- Production rollout, full VM/daemon reboot acceptance and IPv6 routing remain separate work.

## Evaluation Results and Decision

The local routed candidate passes the policy, privilege, delayed-start, independent restart/replacement and native workflow checks. Router failure blocks outbound traffic. New connections recover after readiness without restarting execution. Desktop network namespace, Chromium PID and Xtigervnc PID remain unchanged across router restart and automatic recovery. Existing TCP sessions may need to reconnect after router state is lost.

The native smoke passes BrowserService navigation, extension task/worker grouping, browser/desktop screenshots, desktop input, noVNC HTTP/WebSocket and the execution-to-API denial fixture. Apple and Reddit HTTPS return 200 through the router. The private endpoints are controlled reachable fixtures on the router's uplink; their rejection is distinguished from an absent service.

Use the standard distribution nftables, iproute2 and arping packages with a small owned policy and bootstrap. No custom networking daemon is needed. Among the reviewed premade solutions, none directly matches public access with private destination denial, independent namespaces and no host policy controller.

This prototype uses Docker 29.8.2 and Compose 5.5.0 on local OrbStack. It disables IPv6 and makes no production change. Native AMD64/production-kernel validation, minimum supported versions, nonoverlapping deployment IPAM, and full daemon/VM reboot acceptance remain release requirements. The gateway has NET_ADMIN and NET_RAW for routing and the ARP announcement; execution has neither. The actual deployment must preserve the existing web ingress boundary.

Evidence is retained locally in .local/routed-gateway-evaluation-20261023/evaluation.json, results.json, native-results.json and auto-recovery-results.json. Disposable resources are removed after validation.
