# Chargerent client-dashboard access

Use these access methods for this project unless the user explicitly requests a different method. These instructions apply to backend and kiosk access; they do not authorize unrelated production changes.

Before Chargerent work, read the global access runbook:

`/Users/georgegazelian/.config/codex/access/chargerent-dashboard.md`

Also read `/Users/georgegazelian/Projects/AGENTS.md` for the full kiosk procedure and Amazon relay boundary. Keep the essential access rules below available in this repository even when the parent instructions are not automatically loaded.

Never print private keys, Firebase service account JSON, Node-RED credentials, passwords, or production secrets. Refer to secret file paths and check their existence without exposing contents.

## Backend Node-RED

Use direct SSH to the Google Cloud VM `kiosk-monitoring` in project `node-red-alerts`, zone `us-central1-a`:

```bash
ssh -o BatchMode=yes -i /Users/georgegazelian/.ssh/google_compute_engine george@34.56.244.66
```

- Node-RED editor: `http://34.56.244.66:1880/`
- PM2 process: `node-red`
- Saved flow file: `/home/george/.node-red/hq.json`
- Logs: `/home/george/.pm2/logs/node-red-out.log` and `/home/george/.pm2/logs/node-red-error.log`

Start with read-only identity, process, and HTTP checks. Inspect the live deployed Node-RED editor/runtime when diagnosing or editing flows. A saved file or local export is only a fallback or comparison; state explicitly when the live flow could not be verified.

Back up `hq.json` before authorized backend flow edits. Determine whether activation requires a Node-RED deploy or PM2 restart, and verify the running backend after the change.

## Kiosk SSH

Always use the persistent emergency SSH route equivalent to the dashboard's `ssh connect` command. Use the requested kiosk; `US0118` is the default test kiosk for kiosk-flow work when none is named.

1. Resolve the selected kiosk's current `provisionid` from dashboard/Firestore data. Do not guess or reuse a stale mapping.
2. Use the dashboard's authenticated command WebSocket, or connect to the backend above and publish the equivalent request through its configured `Mosquito Broker` connection:

   ```text
   topic: admin/req-emergency
   qos: 2
   retain: false
   payload: {"action":"start ssh","stationid":"<CURRENT_PROVISIONID>","admin":"<request-id>"}
   ```

   The MQTT field `stationid` contains the current provision ID, not the display station ID.
3. Confirm relay connectivity and that its loopback port `7070` is listening using read-only checks.
4. Pass SSH through the local alias `chargerent-relay` to the kiosk:

   ```bash
   ssh -J chargerent-relay -p 7070 odroid@127.0.0.1
   ```

   The alias uses `ubuntu@chargerent.io` with `/Users/georgegazelian/.ssh/chargerent_relay.pem`. That key authenticates the relay hop only. Use the selected kiosk's own credential for the second hop. US0118's credential is stored in macOS Keychain under service `chargerent-US0118-ssh`, account `odroid`. Retrieve credentials only at execution time into a hidden in-memory authentication flow; never print them or place them in command arguments, files, or logs.
5. Verify the actual destination hostname and station/provision identity before inspecting or changing the kiosk. A dashboard connection indicator or open relay port alone is insufficient.
6. Inspect the selected kiosk's live Node-RED runtime. The usual saved flow is `/home/odroid/.node-red/flows_odroid.json`; treat saved exports as fallback/comparison only.
7. Close a tunnel opened for the task when finished using the same topic and identifiers with `"action":"stop ssh"`; confirm the kiosk response and relay-port closure.

The emergency listener at `/home/odroid/Desktop/UI/sh/emergency.sh` runs outside `nodered.service`, allowing this tunnel to survive kiosk Node-RED restarts. Do not use the legacy `cmd/ck/<STATIONID>/req-ssh` route.

Treat `chargerent.io` as transit-only infrastructure for kiosk access. Never write files or change configuration, services, processes, users, permissions, firewall rules, or any other state on the Amazon relay. The narrowly scoped read-only rental-ingestion diagnostic exception is documented in the parent instructions and applies only when explicitly requested. Verify that the SSH session has reached the intended kiosk before any kiosk edits.

## Backend deployment storage

The Google backend has hourly artifact retention through `chargerent-storage-maintenance.timer`. The script is `/usr/local/sbin/chargerent-storage-maintenance`; its source and policy are documented in `docs/media-service-storage.md`.

Before an authorized backend release, run its dry-run and confirm at least 5 GiB of free space. If space is low, run the approved retention script with `--apply` before staging a release. Keep the active release, current APK references, and two recent compatible rollback copies.

Do not copy the entire `mdm` installer archive into dashboard staging or backup directories. Back up changed files and required rollback artifacts; use hard links for unchanged installers on the same filesystem. Do not include dependency caches or unrelated historical releases in new backups.

Never prune live media assets, campaign state, device registries, credentials, Node-RED flows, or the served dashboard as deployment-artifact cleanup. The retention script only permits the documented artifact roots and diagnostic core files.
