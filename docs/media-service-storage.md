# Chargerent backend storage maintenance

Installed on Google VM `kiosk-monitoring` on 2026-10-14. No Amazon relay changes are involved.

The 39 GiB root filesystem reached 98% utilization. Repeated dashboard deployment copies included several 2.4 GiB MDM archives, while journals used approximately 3.3 GiB and a Node crash dump used 2.2 GiB. The media state write failed with `ENOSPC`; its rejected save promise then blocked subsequent writes even after space became available.

Cleanup left approximately 15 GiB free and 62% filesystem utilization. The hosted media save queue now reports an individual failed write without blocking later writes. Retrying a duplicate upload persists its library entry before reporting success. The patch passed 37 targeted checks, including an actual filesystem failure, retry, restart durability, hosted access controls, and video processing. Live state writes resumed after the media service restart.

## Automatic retention

`chargerent-storage-maintenance.timer` runs approximately hourly and invokes `/usr/local/sbin/chargerent-storage-maintenance --apply`. The script defaults to dry-run when called without `--apply`.

Permitted deployment roots:

- `/home/george/dashboard-releases` and `/home/george/dashboard-backups`, sharing one rollback pool.
- `/opt/chargerent-media/builds`, preserving the active `current` target.
- `/opt/chargerent-media/releases/rollback` and `backups`.
- APK files directly inside `/opt/chargerent-media/releases` and its named release channels.
- Channel rollback directories.

Each pool keeps two recent rollback copies in addition to active paths and artifacts less than 24 hours old. APKs referenced by current metadata or retained rollback metadata remain protected. Dated release names and change times handle copied directories whose modification times were preserved. Open process files and working directories are protected. Symlink artifacts, invalid metadata, unexpected paths, or files changed after planning stop deletion.

Only diagnostic files named `core.*` in `/var/lib/apport/coredump` are eligible for core cleanup. Dumps exceeding 256 MiB are removed after one hour; at most two older bounded dumps are retained. Recent or open dumps remain protected.

The script fails visibly with `LOW_DISK_SPACE` when fewer than 5 GiB remain. This is a failed server unit and journal entry, not an email notification. Inspect it through systemd or the existing server monitoring.

## Logs and crash dumps

- `/etc/systemd/journald.conf.d/90-chargerent-retention.conf` caps persistent journals at 512 MiB, keeps 5 GiB free, and limits retention to 14 days.
- Media and PM2 systemd drop-ins cap core dumps at 256 MiB. The cap was also applied to the existing PM2 process tree without restarting Node-RED.
- `/etc/security/limits.d/90-chargerent-core.conf` applies the same core limit to future `george` and `chargerent-media` login sessions.

## Before a release

Confirm free space before uploading artifacts:

```sh
df -h /
sudo /usr/local/sbin/chargerent-storage-maintenance
```

If needed, apply the approved retention policy:

```sh
sudo /usr/local/sbin/chargerent-storage-maintenance --apply
```

Back up only changed files and necessary rollback artifacts. Do not duplicate the complete MDM archive, dependency caches, or unrelated deployment trees. Hard link unchanged installers on the same filesystem when a rollback needs them. This policy does not authorize a deployment that the user has not requested.

## Verification and recovery

```sh
systemctl status chargerent-storage-maintenance.timer --no-pager
systemctl show chargerent-storage-maintenance.service --property=Result,ExecMainStatus
journalctl -u chargerent-storage-maintenance.service -n 30 --no-pager
curl --fail http://127.0.0.1:8766/api/health
stat /var/lib/chargerent-media/state.json
```

A final dry-run after cleanup returned no deletion candidates. The dashboard and public media health endpoints returned HTTP 200; anonymous library access remained HTTP 401. Current global and channel APKs must remain present and match their published hashes.

The media source and last good persistent state were backed up before the fix in `/opt/chargerent-media/backups/20261014T124432Z-upload-recovery/`. A code rollback must preserve the current persistent state. Do not overwrite current state with this older snapshot just to undo code.

Retention never targets `/var/lib/chargerent-media`, `/etc/chargerent-media`, `/home/george/.node-red`, or live `/var/www/portal` content.
