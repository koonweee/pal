# Production Android USB Hotplug

## Status

In Progress

## Progress

- Milestones 1 and 2 are implemented and pass focused tests, native Linux device-node validation, systemd verification, and the complete Stack v2 test and application-validation suites.
- The reviewed host filter is installed on production and `android-mcp` alone was recreated against it. The sidecar is healthy, ADB reports `device`, it sees one phone node and no Zigbee node, and every unrelated Pal container and Home Assistant retained its identity.
- Milestone 3 remains open for physical cable disconnect/reconnect and Android smoke and secure-smoke acceptance.

## Goal

Keep the production Android sidecar connected across Linux USB bus and device-number changes without exposing unrelated USB devices or recreating the sidecar after every cable reconnect.

## Current Behavior

- Production maps one transient `/dev/bus/usb/<bus>/<device>` node into `android-mcp`.
- Reconnecting the phone or rebooting the VM can change that node and prevent the container from starting.
- The phone and Home Assistant Zigbee adapter share a guest USB bus, so mapping the complete bus would expand device access.
- Development resolves the configured phone serial before replacing its isolated sidecar and remains unchanged.

## Milestones

### 1. Filtered Host USB View

Implementation tasks:

- Add a bounded host reconciliation helper that resolves the inventory-owned phone serial through sysfs.
- Stage only the matching usbfs character node under a dedicated `/dev` directory.
- Trigger reconciliation from USB add/remove events and a periodic systemd timer.
- Add focused tests for connection, path changes, absence, ambiguity, and invalid usbfs metadata.

Exit criteria:

- Offline tests prove the helper removes stale nodes and fails closed.
- Host installation is idempotent and validates its systemd and udev artifacts.

### 2. Sidecar Consumption

Implementation tasks:

- Bind the filtered host directory read-only at `/dev/bus/usb` in production.
- Permit USB character-device reads and writes through the device cgroup while retaining all capability drops.
- Remove the transient production USB path setting and update operator documentation.

Exit criteria:

- Production configuration renders and passes repository validation.
- The sidecar sees only the staged phone node.

### 3. Production Acceptance

Implementation tasks:

- Install the reviewed host artifacts before changing the Stack.
- Recreate only `android-mcp` and preserve its state directory and ADB authorization.
- Exercise repeated disconnect/reconnect, verify automatic ADB recovery, and confirm Home Assistant Zigbee continuity.

Exit criteria:

- Bus and device-number changes recover without replacing `android-mcp`.
- The Zigbee node remains absent from the sidecar.
- Android smoke and secure-smoke acceptance pass.

## Tests

- Unit-test sysfs resolution, stale-node replacement, disconnect cleanup, duplicate matches, and invalid major/minor values.
- Validate the production Compose and resource contract.
- Run repeated native Android reconnect and interaction acceptance in development and production.

## Validation Commands

```bash
cd /Users/jtkw/Projects/stack-v2
python3 -m unittest scripts.tests.test_pal_android_usb
python3 scripts/validate-apps.py pal
bash -n apps/pal/scripts/install-android-usb-filter.sh
```

## Overall Exit Criteria

- Production Android reconnects automatically across usbfs path changes.
- Only the configured phone is accessible to the Android sidecar.
- No unrelated container or USB workload is restarted or exposed.
