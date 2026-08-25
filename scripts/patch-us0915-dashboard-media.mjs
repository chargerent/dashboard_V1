import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET_STATION_ID = 'US0915';
const NODE_PREFIX = 'us0915_dashboard_media_';
const MEDIA_TAB_ID = 'b98e8eccc9a06c06';
const RUN_MPV_NODE_ID = '20ac637ab4744824';

export const PYTHON_SYNC_SOURCE = String.raw`
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import urllib.parse
import urllib.request

BASE = Path(os.environ.get("CHARGERENT_MEDIA_BASE", "/home/odroid/Desktop/media/dashboard"))
CURRENT = BASE / "current"
PREVIOUS = BASE / "previous"
STATE = BASE / "state.json"
MAX_ITEM_BYTES = 250 * 1024 * 1024
MIN_FREE_BYTES = 256 * 1024 * 1024
ALLOWED_HOSTS = {"firebasestorage.googleapis.com", "storage.googleapis.com"}
CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}


def emit(status, **details):
    print(json.dumps({"status": status, **details}, separators=(",", ":")), flush=True)


def safe_existing_state():
    try:
        value = json.loads(STATE.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def write_json_atomic(destination, value):
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, destination)


def extension_for(item, content_type):
    normalized_type = str(content_type or "").split(";", 1)[0].strip().lower()
    if normalized_type in CONTENT_TYPE_EXTENSIONS:
        return CONTENT_TYPE_EXTENSIONS[normalized_type]
    title_suffix = Path(str(item.get("title") or "")).suffix.lower()
    if title_suffix in set(CONTENT_TYPE_EXTENSIONS.values()):
        return title_suffix
    raise RuntimeError("unsupported_content_type:" + (normalized_type or "unknown"))


def download_item(item, destination, remaining_budget):
    url = str(item.get("url") or "").strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise RuntimeError("unapproved_media_url")

    request = urllib.request.Request(url, headers={"User-Agent": "Chargerent-US0915-media-sync/1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        content_type = response.headers.get("Content-Type", "")
        declared_size = int(response.headers.get("Content-Length") or 0)
        if declared_size > MAX_ITEM_BYTES:
            raise RuntimeError("asset_exceeds_250mb")
        if declared_size and declared_size > remaining_budget:
            raise RuntimeError("insufficient_disk_space")

        extension = extension_for(item, content_type)
        final_path = destination.with_suffix(extension)
        partial_path = final_path.with_suffix(final_path.suffix + ".part")
        written = 0
        with partial_path.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_ITEM_BYTES:
                    raise RuntimeError("asset_exceeds_250mb")
                if written > remaining_budget:
                    raise RuntimeError("insufficient_disk_space")
                output.write(chunk)

        if written <= 0:
            raise RuntimeError("empty_media_download")
        if declared_size and written != declared_size:
            raise RuntimeError("media_size_mismatch")
        os.replace(partial_path, final_path)
        return final_path, written


def main():
    manifest = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
    if manifest.get("stationid") != "US0915":
        raise RuntimeError("station_identity_mismatch")

    items = manifest.get("items") if isinstance(manifest.get("items"), list) else []
    stable_assignment = {
        "stationid": manifest.get("stationid"),
        "mode": "assigned" if items else "cleared",
        "items": items,
    }
    signature = hashlib.sha256(
        json.dumps(stable_assignment, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:20]

    BASE.mkdir(parents=True, exist_ok=True)
    previous_state = safe_existing_state()
    if previous_state.get("signature") == signature:
        emit("unchanged", signature=signature, mode=stable_assignment["mode"])
        return

    if not items:
        next_state = {"signature": signature, "mode": "cleared", "itemCount": 0}
        write_json_atomic(STATE, next_state)
        # Installing the dashboard poller on a kiosk that has never had a
        # dashboard assignment must not restart its existing Google Drive
        # playback. Only restore the legacy playlist when a real dashboard
        # assignment is being removed.
        status = "cleared" if previous_state.get("mode") == "assigned" else "unchanged"
        emit(status, signature=signature, mode="cleared")
        return

    staging = BASE / (".staging-" + signature)
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    try:
        free_bytes = shutil.disk_usage(BASE).free
        remaining_budget = free_bytes - MIN_FREE_BYTES
        if remaining_budget <= 0:
            raise RuntimeError("insufficient_disk_space")

        downloaded = []
        total_bytes = 0
        for index, item in enumerate(items, start=1):
            file_path, item_bytes = download_item(item, staging / f"{index:03d}", remaining_budget - total_bytes)
            downloaded.append(file_path.name)
            total_bytes += item_bytes

        playlist_lines = ["#EXTM3U"]
        playlist_lines.extend(str(CURRENT / file_name) for file_name in downloaded)
        (staging / "playlist.m3u").write_text("\n".join(playlist_lines) + "\n", encoding="utf-8")
        (staging / ".assignment.json").write_text(
            json.dumps({**stable_assignment, "signature": signature}, separators=(",", ":")),
            encoding="utf-8",
        )

        if PREVIOUS.exists():
            shutil.rmtree(PREVIOUS)
        moved_current = False
        if CURRENT.exists():
            CURRENT.rename(PREVIOUS)
            moved_current = True
        try:
            staging.rename(CURRENT)
        except Exception:
            if moved_current and PREVIOUS.exists() and not CURRENT.exists():
                PREVIOUS.rename(CURRENT)
            raise

        next_state = {
            "signature": signature,
            "mode": "assigned",
            "itemCount": len(downloaded),
            "totalBytes": total_bytes,
        }
        write_json_atomic(STATE, next_state)
        play_time = max(1, min(3600, int(items[0].get("playTime") or 20)))
        emit(
            "applied",
            signature=signature,
            itemCount=len(downloaded),
            totalBytes=total_bytes,
            playTime=play_time,
            playlist=str(CURRENT / "playlist.m3u"),
        )
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise


try:
    main()
except Exception as error:
    emit("failed", error=str(error)[:240])
    raise SystemExit(1)
`.trim();

const PYTHON_SYNC_B64 = Buffer.from(PYTHON_SYNC_SOURCE, 'utf8').toString('base64');

function commandBuilderSource() {
  return `const TARGET_STATION_ID = ${JSON.stringify(TARGET_STATION_ID)};
const PYTHON_SYNC_B64 = ${JSON.stringify(PYTHON_SYNC_B64)};

let response = {};
if (msg.payload && typeof msg.payload === "object") {
    response = msg.payload;
} else {
    try {
        response = JSON.parse(String(msg.payload || "").trim());
    } catch (error) {
        response = {};
    }
}
if (Number(response.code) !== 200 || !Array.isArray(response.data)) {
    msg.mediaSync = { status: "failed", error: "invalid_media_response" };
    node.status({ fill: "red", shape: "ring", text: "invalid dashboard media response" });
    return [null, msg];
}

const items = [];
for (const item of response.data) {
    const url = String(item && item.url2 || "").trim();
    const title = String(item && item.title || "").trim();
    if (!url) continue;
    items.push({
        url,
        title,
        playTime: Number(item && item.playTime || 20)
    });
}

const manifest = {
    stationid: TARGET_STATION_ID,
    items
};
const manifestB64 = Buffer.from(JSON.stringify(manifest), "utf8").toString("base64");
const doubleQuote = String.fromCharCode(34);
msg.payload = "/usr/bin/python3 -c " + doubleQuote + "import base64;exec(base64.b64decode('" + PYTHON_SYNC_B64 + "'))" + doubleQuote + " '" + manifestB64 + "'";
msg.mediaSyncRequestedAt = Date.now();
node.status({ fill: "blue", shape: "dot", text: items.length ? "syncing " + items.length + " dashboard asset(s)" : "checking cleared assignment" });
return [msg, null];`;
}

const prepareRequestSource = `const TARGET_STATION_ID = ${JSON.stringify(TARGET_STATION_ID)};
const kiosk = global.get("kiosk") || {};
const stationid = String(kiosk.stationid || "").trim();
if (stationid !== TARGET_STATION_ID) {
    node.status({ fill: "red", shape: "ring", text: "station identity mismatch" });
    return null;
}
msg.payload = "";
return msg;`;

const handleResultSource = `let result;
try {
    result = JSON.parse(String(msg.payload || "").trim());
} catch (error) {
    result = { status: "failed", error: "invalid_sync_result" };
}

const state = {
    ...result,
    checkedAt: Date.now()
};
const kioskMedia = global.get("kiosk.media");
if (kioskMedia && typeof kioskMedia === "object" && !Array.isArray(kioskMedia) &&
    Object.prototype.hasOwnProperty.call(kioskMedia, "dashboard")) {
    const cleanedMedia = { ...kioskMedia };
    delete cleanedMedia.dashboard;
    global.set("kiosk.media", Object.keys(cleanedMedia).length > 0 ? cleanedMedia : undefined);
}
global.set("dashboardMediaSync", state);
msg.mediaSync = state;

if (result.status === "unchanged") {
    node.status({ fill: "green", shape: "ring", text: "dashboard media unchanged" });
    return [null, msg];
}

if (result.status === "failed") {
    node.status({ fill: "red", shape: "ring", text: String(result.error || "sync failed").slice(0, 48) });
    return [null, msg];
}

const stopMpv = "killall -9 mpv >/dev/null 2>&1 || true; sleep 1; ";
if (result.status === "applied") {
    const playTime = Math.max(1, Math.min(3600, Number(result.playTime || 20)));
    msg.payload = stopMpv + "export DISPLAY=:0; mpv --fullscreen --loop-playlist --image-display-duration=" + playTime + " --playlist=/home/odroid/Desktop/media/dashboard/current/playlist.m3u --ontop=yes";
    node.status({ fill: "green", shape: "dot", text: "dashboard media applied" });
    return [msg, msg];
}

if (result.status === "cleared") {
    const screen = global.get("kiosk.screen") || {};
    const timeout = Math.max(1, Math.min(3600, Number(screen.timeout || 30)));
    const imageDuration = String(screen.mode || "picture").toLowerCase() === "picture"
        ? " --image-display-duration=" + timeout
        : "";
    msg.payload = stopMpv + "export DISPLAY=:0; mpv --fullscreen --loop-playlist" + imageDuration + " --playlist=/home/odroid/Desktop/media/PICTURE/ --ontop=yes";
    node.status({ fill: "green", shape: "ring", text: "dashboard media cleared" });
    return [msg, msg];
}

return [null, msg];`;

function buildNodes() {
  return [
    {
      id: `${NODE_PREFIX}group_v1`,
      type: 'group',
      z: MEDIA_TAB_ID,
      name: 'US0915 dashboard media sync — atomic local cache',
      style: { label: true, color: '#3FADB5' },
      nodes: [
        `${NODE_PREFIX}poll_v1`,
        `${NODE_PREFIX}prepare_v1`,
        `${NODE_PREFIX}fetch_v1`,
        `${NODE_PREFIX}build_v1`,
        `${NODE_PREFIX}sync_v1`,
        `${NODE_PREFIX}result_v1`,
        `${NODE_PREFIX}status_v1`,
        `${NODE_PREFIX}error_v1`,
      ],
      x: 54,
      y: 1214,
      w: 1112,
      h: 208,
    },
    {
      id: `${NODE_PREFIX}poll_v1`,
      type: 'inject',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Poll dashboard assignment every 60s',
      props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }],
      repeat: '60',
      once: true,
      onceDelay: '20',
      topic: '',
      payload: '',
      payloadType: 'date',
      x: 210,
      y: 1260,
      wires: [[`${NODE_PREFIX}prepare_v1`]],
    },
    {
      id: `${NODE_PREFIX}prepare_v1`,
      type: 'function',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Verify US0915 + prepare media request',
      func: prepareRequestSource,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 480,
      y: 1260,
      wires: [[`${NODE_PREFIX}fetch_v1`]],
    },
    {
      id: `${NODE_PREFIX}fetch_v1`,
      type: 'exec',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Fetch dashboard playlist',
      command: "/usr/bin/curl -fsS --max-time 20 'https://media-v1assignment-hqnnmh3unq-uc.a.run.app?stationid=US0915'",
      addpay: false,
      append: '',
      useSpawn: 'false',
      timer: '30',
      winHide: false,
      oldrc: false,
      x: 730,
      y: 1260,
      wires: [[`${NODE_PREFIX}build_v1`], [`${NODE_PREFIX}error_v1`], []],
    },
    {
      id: `${NODE_PREFIX}build_v1`,
      type: 'function',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Build safe atomic sync command',
      func: commandBuilderSource(),
      outputs: 2,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 970,
      y: 1260,
      wires: [[`${NODE_PREFIX}sync_v1`], [`${NODE_PREFIX}error_v1`]],
    },
    {
      id: `${NODE_PREFIX}sync_v1`,
      type: 'exec',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      command: '',
      addpay: 'payload',
      append: '',
      useSpawn: 'false',
      timer: '300',
      winHide: false,
      oldrc: false,
      name: 'Stage + verify + activate media',
      x: 240,
      y: 1340,
      wires: [[`${NODE_PREFIX}result_v1`], [`${NODE_PREFIX}error_v1`], []],
    },
    {
      id: `${NODE_PREFIX}result_v1`,
      type: 'function',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Apply playback only after sync success',
      func: handleResultSource,
      outputs: 2,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 520,
      y: 1340,
      wires: [[RUN_MPV_NODE_ID], [`${NODE_PREFIX}status_v1`]],
    },
    {
      id: `${NODE_PREFIX}status_v1`,
      type: 'debug',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Dashboard media status',
      active: true,
      tosidebar: true,
      console: false,
      tostatus: false,
      complete: 'mediaSync',
      targetType: 'msg',
      statusVal: '',
      statusType: 'auto',
      x: 810,
      y: 1340,
      wires: [],
    },
    {
      id: `${NODE_PREFIX}error_v1`,
      type: 'debug',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Dashboard media sync error',
      active: true,
      tosidebar: true,
      console: true,
      tostatus: false,
      complete: 'true',
      targetType: 'full',
      statusVal: '',
      statusType: 'auto',
      x: 1080,
      y: 1340,
      wires: [],
    },
  ];
}

export function patchUs0915DashboardMediaFlow(flow) {
  if (!Array.isArray(flow)) {
    throw new Error('Expected a Node-RED flow array');
  }
  const mediaTab = flow.find((node) => node?.id === MEDIA_TAB_ID && node?.type === 'tab');
  if (!mediaTab || String(mediaTab.label || '').trim().toLowerCase() !== 'media') {
    throw new Error('Expected the V1 media tab before patching');
  }
  const runMpv = flow.find((node) => node?.id === RUN_MPV_NODE_ID && node?.type === 'exec');
  if (!runMpv) {
    throw new Error('Expected the existing run mpv node before patching');
  }

  const preserved = flow.filter((node) => !String(node?.id || '').startsWith(NODE_PREFIX));
  return [...preserved, ...buildNodes()];
}

function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error('Usage: node patch-us0915-dashboard-media.mjs <input-flow.json> <output-flow.json>');
  }
  const flow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const patched = patchUs0915DashboardMediaFlow(flow);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(patched, null, 2)}\n`);
  console.log(`Patched ${TARGET_STATION_ID} dashboard media sync (${flow.length} -> ${patched.length} nodes).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
