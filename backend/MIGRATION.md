# Offline runtime migration

Use a maintenance window. The migration tool prepares copies in a new Compose project. Retain the original containers, images, volumes, checkout/configuration, and ingress routing until acceptance. Do not run the old and new agents concurrently.

## Prepare

1. Record the old Compose project/container IDs, source revision, environment-file location, and Tailscale route. Disable client access, close Chromium cleanly and wait for exit, and stop all application writers, including the legacy Pal container. Keep its PostgreSQL container running for the consistent dump.
2. Build the current agent-service, execution, and web images. Do not run dev-local up against the existing installation.
3. From the repository root, prepare a new private backup directory and unused target project:

~~~bash
python3 scripts/migrate-runtime.py \
  --legacy LEGACY_STOPPED_CONTAINER \
  --postgres LEGACY_RUNNING_POSTGRES \
  --project pal-dev-split \
  --backup /private/backups/pal-cutover
~~~

The tool refuses running legacy Pal and pre-existing target volumes. It exports the writable root filesystem and /data, saves container configuration, inventories changed paths and database path references, and takes a custom-format PostgreSQL dump. Backups contain credentials; protect the directory and exclude it from version control.

The execution base is imported from a sanitized archive. It preserves system packages, their package database, and utilities/configuration outside application/private/runtime directories. It excludes /opt/pal, /data, /root, /home, /tmp, /run, and logs. Known service environment credentials and provider-authentication token copies are checked in retained files. Unknown credentials in arbitrary files require operator review; a legacy agent-controlled container is not a trusted clean image.

Review legacy-filesystem-changes.txt and legacy-paths.json. If required tools live in excluded directories, move them into an execution-owned location before taking the final stopped snapshot, or reinstall them in the execution image. Review symlinks and external path references. Conflicting home workspace/incoming files stop migration rather than overwrite data.

The source /data may be a named volume or bind mount. Restored PostgreSQL retains the existing pal role password.

The new volumes contain:

| Volume | Contents |
| --- | --- |
| agent_home | Legacy /data/home, /data/workspace under workspace, inspection copies under incoming |
| service_data | /data/agent authentication, canonical /data/uploads, other data under private legacy |
| postgres_data | Restored complete application and Mastra database |

The complete home retains browser profile and keyring files with UID/GID 1000. compose.env retains the legacy hostname and sanitized execution base/image. Stale Chromium singleton locks are removed. Execution-local symlinks and native filesystem path mapping resolve historical /data/home, /data/workspace, and /data/uploads references. /data/agent remains private.

## Cut over

4. Review the protected backups and manifest. Retain the exact old environment file and application revision. Copy the three settings from the generated compose.env into the target Compose interpolation environment. For dev-local, append them to backend/.env.development; the script uses it for both Compose interpolation and backend configuration.
5. Stop the remaining old frontend and PostgreSQL containers to free the loopback ports. Keep every old container and volume. Production uses an unused target project name via --project-name; the development script uses pal-dev-split.
6. Build and start the target. Development uses ./scripts/dev-local up. For production, run docker compose --env-file TARGET_ENV --project-name TARGET_PROJECT build, run the database migration as a one-shot agent-service command, then up -d --wait. Keep PAL_EXECUTION_BASE configured for later execution rebuilds.
7. Verify conversations, schedules, historical attachment inspection/download, private model login, browser account sessions through noVNC, home files, and installed utilities. Confirm private service paths/environment/socket are unavailable inside execution. Restart only agent-service and confirm the desktop and an unrelated process survive.
8. Switch the retained ingress origin to the new gateway and reconnect the PWA. Keep the hostname, scheme, and port stable for its installation and OAuth callbacks. Accept new writes only after these checks pass.

## Roll back

Disable ingress and stop every target application writer. Stop the target project without deleting volumes. Restart the retained legacy PostgreSQL, Pal, and frontend containers with their original configuration and routing. Those volumes remain at the same cutover point; target writes exist only in the new volumes.

Rollback discards the target branch's later writes. If those writes must be retained, export and reconcile them before switching back. Do not restore one database independently of its matching attachment/auth/home snapshot.

If the retained source was changed or damaged, restore postgres.dump and legacy-data.tar into fresh recovery volumes, using the retained old image/configuration and exported legacy-rootfs.tar for writable-layer recovery. Rehearse that recovery before re-enabling ingress. The migration tool never removes source state.

## Rehearsal

Run npm run runtime:migration:smoke from backend. It uses disposable source and target projects with synthetic records and account state, verifies the copied database/files/browser/keyring/packages, makes a target-only filesystem edit, and switches back to the original matching state. Protected rehearsal archives remain under .local/migration-rehearsal-*.
