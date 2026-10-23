# Squid gateway lifecycle

## Status

Done

## Goal

Restore production web access and make gateway startup, child failure, and restart reliable while preserving execution and application state.

## Current Behavior

- Web runs Nginx and Squid under a BusyBox shell that clears the previous Squid PID file.
- Either child exiting terminates the gateway, including immediate startup failures.
- The shell handles SIGINT, SIGTERM, and SIGQUIT; Compose restarts exited gateways.

## Milestones

### 1. Restore the production gateway

Implementation tasks:

- Verify deployed and cached gateway/network definitions match.
- Recreate only web through a guarded Komodo plan, then restore temporary deployment flags.
- Verify proxy traffic and preserve execution/API/database container identities.

Exit criteria:

- Gateway healthy, public proxy requests succeed, private proxy destinations denied, other service identities unchanged.

### 2. Make startup and supervision reliable

Implementation tasks:

- Remove the previous gateway PID file before starting Squid.
- Handle either child exiting, including immediate startup failure; stop both on SIGINT, SIGTERM, or the image's SIGQUIT stop signal.
- Add a focused container regression check and document gateway lifecycle.

Exit criteria:

- Stale PID startup, immediate child failure, running child death, graceful termination, and container restart checks pass.

## Tests

- Disposable real-Squid/Nginx regression containers; no application or monitor state changes.

## Validation Commands

```sh
python3 scripts/test-gateway-lifecycle.py
```

## Overall Exit Criteria

- Production web access is restored without restarting execution or changing monitor state.
- Lifecycle fix passes regression checks and is committed locally.
- The permanent immutable gateway image is deployed and passes a production gateway-only restart.

## Rollback

Restore temporary Komodo extra arguments after the targeted recreation. Persistent volumes and image pins remain unchanged. Preserve existing recovery sources.

## Validation Results

- Same-image production web-only recreation restored healthy Squid/Nginx; Apple, Reddit, and Facebook returned 200 through the execution-network proxy endpoint and metadata access returned 403.
- Execution, agent-service, and database container identities and start times stayed unchanged. Temporary Komodo deployment flags were restored.
- All focused lifecycle checks pass against real Squid/Nginx: stale PID startup, forced restart, graceful SIGQUIT stop/restart, automatic recovery after Squid death, and shutdown after running or immediately failing children.
- The original source fails the stale-PID startup regression.
- Production uses the gateway-only release source `71ae197` (production `9ac4edb` plus fix `204e897`) and image `ghcr.io/koonweee/pal-web:71ae197@sha256:624f3ab0d056215f0a3b0a0c355ce1bc2605aa538182679c4ce5acb533ea002b`. All 15 PWA files match the prior image byte for byte; `PAL_RELEASE_ID` remains `9ac4edb`.
- Deployment `6adba23b93f4565575da3e8b` and gateway-only restart `6adba27e93f4565575da3e95` pass. The restart completes in 3.247 seconds; execution, agent-service, PostgreSQL, and Google MCP retain their identities, start times, and image pins. Temporary Build/Stack settings are restored.
- Squid reports a segmentation fault during controlled shutdown, before the successful restart. The replacement process is healthy and serves all proxy checks; no post-start fatal entry was observed. This package shutdown behavior remains outside the supervisor repair.
