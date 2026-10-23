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
- Permanent image rollout remains separate from immediate same-image recovery.

## Rollback

Restore temporary Komodo extra arguments after the targeted recreation. Persistent volumes and image pins remain unchanged. Preserve existing recovery sources.

## Validation Results

- Same-image production web-only recreation restored healthy Squid/Nginx; Apple, Reddit, and Facebook returned 200 through the execution-network proxy endpoint and metadata access returned 403.
- Execution, agent-service, and database container identities and start times stayed unchanged. Temporary Komodo deployment flags were restored.
- All focused lifecycle checks pass against real Squid/Nginx: stale PID startup, forced restart, graceful SIGQUIT stop/restart, automatic recovery after Squid death, and shutdown after running or immediately failing children.
- The original source fails the stale-PID startup regression.
- The permanent source fix is committed locally; production still runs the recovered prior image. Image publishing and rollout are remaining release work.
