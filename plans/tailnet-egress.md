# Tailnet execution egress

## Status

In Progress

## Goal

Give Pal browser and code execution transparent HTTPS access to self-hosted Tailnet applications through a dedicated `pal-agent-vm` machine identity. Preserve the execution container's existing privilege and private-network boundaries.

## Current Behavior

- Execution uses the independent nftables egress router for public IPv4 and cannot reach Tailnet or private ranges.
- Execution has no network administration capability, TUN device or alternate route.
- Production runs on a Tailnet-connected host whose identity must not be inherited by agent traffic.

## Milestones

### 1. Add the Tailnet route

Implementation tasks:

- Package pinned Tailscale binaries in the egress image and supervise an optional kernel client.
- Persist deployment-owned node state outside execution.
- Allow only Tailnet TCP 443 and DNS through nftables while preserving public egress and private-range denial.
- Keep local development unenrolled by default.

Exit criteria:

- The gateway test proves transparent allowed HTTPS/DNS, denied Tailnet ports, unchanged public access and fail-closed lifecycle behavior.

### 2. Enroll and validate production

Implementation tasks:

- Add the `tag:pal-agent` Tailnet identity and least-privilege grants in Stack v2.
- Build and pin the reviewed egress image, deploy only the gateway, and enroll it once as `pal-agent-vm`.
- Route production execution DNS through internal resolvers and validate browser/code access plus denied ports.

Exit criteria:

- The independent node identity persists across gateway replacement and production acceptance passes without granting execution network administration.

## Tests

- One disposable gateway lifecycle suite for public, private and Tailnet paths.
- Shell syntax, Compose rendering and Stack v2 policy/application validation.
- Production HTTPS/DNS success and representative SSH/database/management-port denial.

## Validation Commands

```bash
python3 scripts/test-gateway-lifecycle.py
sh -n network-gateway/start.sh network-gateway/health.sh
docker compose -f backend/compose.yaml config --quiet
git diff --check
```

## Overall Exit Criteria

- Pal execution reaches self-hosted HTTPS applications as `pal-agent-vm` and cannot initiate other Tailnet or private-network traffic.
- Public internet egress, independent router recovery and persistent desktop behavior remain intact.
- Deployment configuration, enrollment procedure and backup ownership reflect the live state.
