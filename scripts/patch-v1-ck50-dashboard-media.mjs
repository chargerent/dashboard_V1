import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NODE_PREFIX = 'v1_ck50_dashboard_media_';
const MEDIA_TAB_ID = 'b98e8eccc9a06c06';
const RUN_MPV_NODE_ID = '20ac637ab4744824';
const MQTT_BROKER_NODE_ID = '8597d2b7.ba618';
const ASSIGNMENT_ENDPOINT = 'https://media-v1assignment-hqnnmh3unq-uc.a.run.app';
const DEFAULT_MEDIA_IMAGE_PATH = '/home/odroid/Desktop/media/dashboard/default/default.jpg';
const DEFAULT_MEDIA_PLAYLIST_PATH = '/home/odroid/Desktop/media/dashboard/default/playlist.m3u';
const DASHBOARD_MEDIA_STATE_PATH = '/home/odroid/Desktop/media/dashboard/state.json';
const DASHBOARD_MEDIA_PLAYLIST_PATH = '/home/odroid/Desktop/media/dashboard/current/playlist.m3u';

export const PYTHON_SYNC_SOURCE = String.raw`
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import urllib.parse
import urllib.request

BASE = Path(os.environ.get("CHARGERENT_MEDIA_BASE", "/home/odroid/Desktop/media/dashboard"))
CURRENT = BASE / "current"
PREVIOUS = BASE / "previous"
DEFAULT = BASE / "default"
DEFAULT_IMAGE = Path(os.environ.get("CHARGERENT_DEFAULT_MEDIA", str(DEFAULT / "default.jpg")))
DEFAULT_PLAYLIST = DEFAULT / "playlist.m3u"
STATE = BASE / "state.json"
LEGACY_LOCAL_MEDIA = Path(os.environ.get("CHARGERENT_LEGACY_MEDIA_ROOT", "/home/odroid/Desktop/media")) / "PICTURE"
MAX_ITEM_BYTES = 250 * 1024 * 1024
MAX_DEFAULT_BYTES = 10 * 1024 * 1024
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


def clear_directory_contents(directory):
    if not directory.exists():
        return 0
    if not directory.is_dir() or directory.is_symlink():
        raise RuntimeError("unsafe_legacy_media_path")
    removed = 0
    for child in directory.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()
        removed += 1
    return removed


def remove_assignment_cache():
    removed = 0
    for directory in (CURRENT, PREVIOUS):
        if directory.exists():
            if not directory.is_dir() or directory.is_symlink():
                raise RuntimeError("unsafe_dashboard_media_cache")
            shutil.rmtree(directory)
            removed += 1
    return removed


def ensure_default_playlist():
    if not DEFAULT_IMAGE.is_file() or DEFAULT_IMAGE.is_symlink():
        raise RuntimeError("default_media_missing")
    DEFAULT.mkdir(parents=True, exist_ok=True)
    temporary = DEFAULT_PLAYLIST.with_suffix(DEFAULT_PLAYLIST.suffix + ".tmp")
    temporary.write_text("#EXTM3U\n" + str(DEFAULT_IMAGE) + "\n", encoding="utf-8")
    os.replace(temporary, DEFAULT_PLAYLIST)


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def ensure_default_media(value):
    descriptor = value if isinstance(value, dict) else {}
    if not descriptor:
        if DEFAULT_IMAGE.is_file() and not DEFAULT_IMAGE.is_symlink() and DEFAULT_IMAGE.stat().st_size > 0:
            return False, "local"
        raise RuntimeError("default_media_descriptor_missing")

    url = str(descriptor.get("url") or "").strip()
    expected_sha256 = str(descriptor.get("sha256") or "").strip().lower()
    content_type = str(descriptor.get("contentType") or "").split(";", 1)[0].strip().lower()
    version = str(descriptor.get("version") or "").strip()
    try:
        expected_size = int(descriptor.get("size") or 0)
    except Exception:
        expected_size = 0

    if not re.fullmatch(r"[a-f0-9]{64}", expected_sha256):
        raise RuntimeError("invalid_default_media_sha256")
    if content_type != "image/jpeg" or not version:
        raise RuntimeError("invalid_default_media_descriptor")
    if expected_size <= 0 or expected_size > MAX_DEFAULT_BYTES:
        raise RuntimeError("invalid_default_media_size")

    if DEFAULT_IMAGE.is_file() and not DEFAULT_IMAGE.is_symlink():
        if DEFAULT_IMAGE.stat().st_size == expected_size and file_sha256(DEFAULT_IMAGE) == expected_sha256:
            return False, version

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise RuntimeError("unapproved_default_media_url")

    if DEFAULT.exists() and (not DEFAULT.is_dir() or DEFAULT.is_symlink()):
        raise RuntimeError("unsafe_default_media_path")
    DEFAULT.mkdir(parents=True, exist_ok=True)
    partial_path = DEFAULT / ".default.jpg.part"
    if partial_path.exists():
        partial_path.unlink()

    request = urllib.request.Request(url, headers={"User-Agent": "Chargerent-V1-media-sync/1"})
    written = 0
    digest = hashlib.sha256()
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            response_type = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            declared_size = int(response.headers.get("Content-Length") or 0)
            if response_type != content_type:
                raise RuntimeError("default_media_content_type_mismatch")
            if declared_size and declared_size != expected_size:
                raise RuntimeError("default_media_size_mismatch")
            with partial_path.open("wb") as output:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > MAX_DEFAULT_BYTES or written > expected_size:
                        raise RuntimeError("default_media_size_mismatch")
                    digest.update(chunk)
                    output.write(chunk)

        if written != expected_size:
            raise RuntimeError("default_media_size_mismatch")
        if digest.hexdigest() != expected_sha256:
            raise RuntimeError("default_media_sha256_mismatch")
        os.replace(partial_path, DEFAULT_IMAGE)
        write_json_atomic(DEFAULT / "default.json", {
            "version": version,
            "sha256": expected_sha256,
            "size": expected_size,
        })
        return True, version
    except Exception:
        if partial_path.exists():
            partial_path.unlink()
        raise


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

    request = urllib.request.Request(url, headers={"User-Agent": "Chargerent-V1-media-sync/1"})
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
    expected_stationid = str(sys.argv[2] if len(sys.argv) > 2 else "").strip().upper()
    if not re.fullmatch(r"[A-Z]{2}[0-9]{4}", expected_stationid):
        raise RuntimeError("invalid_station_identity")
    manifest = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
    manifest_stationid = str(manifest.get("stationid") or "").strip().upper()
    if manifest_stationid != expected_stationid:
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
    default_updated, default_version = ensure_default_media(manifest.get("defaultMedia"))
    ensure_default_playlist()
    previous_state = safe_existing_state()
    legacy_files_removed = clear_directory_contents(LEGACY_LOCAL_MEDIA)
    assignment_cache_removed = 0
    if not items:
        assignment_cache_removed = remove_assignment_cache()

    cached_assignment_ready = (
        (bool(items) and (CURRENT / "playlist.m3u").is_file())
        or (not items and DEFAULT_PLAYLIST.is_file())
    )
    if previous_state.get("signature") == signature and cached_assignment_ready:
        unchanged_details = {
            "signature": signature,
            "mode": stable_assignment["mode"],
            "legacyFilesRemoved": legacy_files_removed,
            "assignmentCacheRemoved": assignment_cache_removed,
            "defaultUpdated": default_updated,
            "defaultVersion": default_version,
        }
        if items:
            unchanged_details.update({
                "itemCount": len(items),
                "playTime": max(1, min(3600, int(items[0].get("playTime") or 20))),
                "playlist": str(CURRENT / "playlist.m3u"),
            })
        else:
            unchanged_details.update({
                "itemCount": 0,
                "playTime": 20,
                "playlist": str(DEFAULT_PLAYLIST),
            })
        emit("unchanged", **unchanged_details)
        return

    if not items:
        next_state = {"signature": signature, "mode": "cleared", "itemCount": 0}
        write_json_atomic(STATE, next_state)
        status = "cleared" if (
            previous_state.get("mode") == "assigned"
            or legacy_files_removed > 0
            or assignment_cache_removed > 0
            or default_updated
        ) else "unchanged"
        emit(
            status,
            signature=signature,
            mode="cleared",
            itemCount=0,
            playTime=20,
            playlist=str(DEFAULT_PLAYLIST),
            legacyFilesRemoved=legacy_files_removed,
            assignmentCacheRemoved=assignment_cache_removed,
            defaultUpdated=default_updated,
            defaultVersion=default_version,
        )
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
            defaultUpdated=default_updated,
            defaultVersion=default_version,
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
  return `const PYTHON_SYNC_B64 = ${JSON.stringify(PYTHON_SYNC_B64)};
const stationid = String(msg.mediaStationId || "").trim().toUpperCase();
if (!/^[A-Z]{2}[0-9]{4}$/.test(stationid)) {
    msg.mediaSync = { status: "failed", error: "invalid_station_identity" };
    return [null, msg];
}

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
    stationid,
    items,
    defaultMedia: response.defaultMedia && typeof response.defaultMedia === "object"
        ? {
            url: String(response.defaultMedia.url || "").trim(),
            sha256: String(response.defaultMedia.sha256 || "").trim().toLowerCase(),
            contentType: String(response.defaultMedia.contentType || "").trim().toLowerCase(),
            version: String(response.defaultMedia.version || "").trim(),
            size: Number(response.defaultMedia.size || 0)
        }
        : null
};
const manifestB64 = Buffer.from(JSON.stringify(manifest), "utf8").toString("base64");
const doubleQuote = String.fromCharCode(34);
msg.payload = "/usr/bin/python3 -c " + doubleQuote + "import base64;exec(base64.b64decode('" + PYTHON_SYNC_B64 + "'))" + doubleQuote + " '" + manifestB64 + "' '" + stationid + "'";
msg.mediaSyncRequestedAt = Date.now();
node.status({ fill: "blue", shape: "dot", text: items.length ? "syncing " + items.length + " dashboard asset(s)" : "checking cleared assignment" });
return [msg, null];`;
}

const prepareRequestSource = `const ASSIGNMENT_ENDPOINT = ${JSON.stringify(ASSIGNMENT_ENDPOINT)};
const kiosk = global.get("kiosk") || {};
const stationid = String(kiosk.stationid || "").trim().toUpperCase();
const hardwareType = String(kiosk.hardware && kiosk.hardware.type || "").trim().toUpperCase();
if (!/^[A-Z]{2}[0-9]{4}$/.test(stationid)) {
    node.status({ fill: "red", shape: "ring", text: "invalid station identity" });
    return null;
}
if (hardwareType && hardwareType !== "CK50") {
    node.status({ fill: "yellow", shape: "ring", text: "dashboard media requires CK50" });
    return null;
}
msg.mediaStationId = stationid;
msg.payload = "/usr/bin/curl -fsS --max-time 20 '" + ASSIGNMENT_ENDPOINT + "?stationid=" + stationid + "'";
return msg;`;

const prepareRotationSource = `const kiosk = global.get("kiosk") || {};
const hardwareType = String(kiosk.hardware && kiosk.hardware.type || "").trim().toUpperCase();
const screenType = String(kiosk.hardware && kiosk.hardware.screen || "").trim();
const attempt = Math.max(0, Number(msg.rotationAttempt || 0));
const maxAttempts = 12;

if (hardwareType && hardwareType !== "CK50") {
    node.status({ fill: "grey", shape: "ring", text: "CK50 rotation not applicable" });
    return [null, null];
}

if (hardwareType !== "CK50" || !screenType) {
    if (attempt >= maxAttempts) {
        const state = { status: "failed", error: "screen_identity_unavailable", checkedAt: Date.now() };
        global.set("dashboardMediaRotation", state);
        node.status({ fill: "red", shape: "ring", text: "screen identity unavailable" });
        return [null, null];
    }
    msg.rotationAttempt = attempt + 1;
    node.status({ fill: "yellow", shape: "ring", text: "waiting for CK50 screen identity" });
    return [null, msg];
}

let expectedOrientation = "";
let rotateCommand = "";
const selectOutput = "OUTPUT=$(DISPLAY=:0 xrandr --query 2>/dev/null | awk '/ connected/{print $1; exit}')" +
    " && test x$OUTPUT != x";
if (screenType === "32in") {
    expectedOrientation = "right";
    rotateCommand = selectOutput +
        " && DISPLAY=:0 xrandr --output $OUTPUT --mode 1920x1080 --rotate right >/dev/null 2>&1";
} else if (screenType === "E32in") {
    expectedOrientation = "left";
    rotateCommand = selectOutput +
        " && DISPLAY=:0 xrandr --output $OUTPUT --mode 1920x1080 --rotate left >/dev/null 2>&1" +
        " && ID=$(DISPLAY=:0 xinput --list 2>/dev/null | grep 'ET3243L' | grep -v 'UNKNOWN' | head -1 | sed -n 's/.*id=\\([0-9][0-9]*\\).*/\\1/p')" +
        " && test x$ID != x" +
        " && DISPLAY=:0 xinput set-prop $ID 'Coordinate Transformation Matrix' 1 0 0 0 1 0 0 0 1 >/dev/null 2>&1";
} else {
    const state = {
        status: "failed",
        error: "unsupported_ck50_screen_type",
        screenType,
        checkedAt: Date.now()
    };
    global.set("dashboardMediaRotation", state);
    node.status({ fill: "red", shape: "ring", text: "unsupported CK50 screen: " + screenType.slice(0, 20) });
    return [null, null];
}

const orientationCheck = "DISPLAY=:0 xrandr --query 2>/dev/null | grep ' connected ' | grep -Fq ' " + expectedOrientation + " '";
const resolutionCheck = "DISPLAY=:0 xrandr --query 2>/dev/null | grep -Fq ' connected 1080x1920+'";
msg.rotationAttempt = attempt;
msg.rotationScreenType = screenType;
msg.rotationExpected = expectedOrientation;
msg.payload = "if " + rotateCommand + " && " + orientationCheck + " && " + resolutionCheck +
    "; then printf 'rotation_match|" + screenType + "|" + expectedOrientation +
    "'; else printf 'rotation_error|" + screenType + "|" + expectedOrientation + "'; fi";
global.set("dashboardMediaRotation", {
    status: "applying",
    screenType,
    expectedOrientation,
    attempt,
    checkedAt: Date.now()
});
node.status({ fill: "blue", shape: "ring", text: "applying " + screenType + " " + expectedOrientation + " rotation" });
return [msg, null];`;

const finalizeRotationSource = `const result = String(msg.payload || "").trim().split(/\\r?\\n/).filter(Boolean).pop() || "";
const expectedToken = "rotation_match|" + String(msg.rotationScreenType || "") + "|" + String(msg.rotationExpected || "");
if (result === expectedToken) {
    const state = {
        status: "active",
        screenType: String(msg.rotationScreenType || ""),
        orientation: String(msg.rotationExpected || ""),
        resolution: "1080x1920",
        verifiedAt: Date.now()
    };
    global.set("dashboardMediaRotation", state);
    msg.mediaRotation = state;
    node.status({ fill: "green", shape: "dot", text: state.screenType + " " + state.orientation + " verified" });
    return [msg, null];
}

const attempt = Math.max(0, Number(msg.rotationAttempt || 0)) + 1;
if (attempt > 12) {
    const state = {
        status: "failed",
        error: "rotation_verification_failed",
        screenType: String(msg.rotationScreenType || ""),
        expectedOrientation: String(msg.rotationExpected || ""),
        checkedAt: Date.now()
    };
    global.set("dashboardMediaRotation", state);
    node.status({ fill: "red", shape: "ring", text: "CK50 rotation verification failed" });
    return [null, null];
}
msg.rotationAttempt = attempt;
node.status({ fill: "yellow", shape: "ring", text: "retrying CK50 rotation " + attempt + "/12" });
return [null, msg];`;

const localStartupSource = `const defaultImage = ${JSON.stringify(DEFAULT_MEDIA_IMAGE_PATH)};
const defaultPlaylist = ${JSON.stringify(DEFAULT_MEDIA_PLAYLIST_PATH)};
const stateFile = ${JSON.stringify(DASHBOARD_MEDIA_STATE_PATH)};
const currentPlaylist = ${JSON.stringify(DASHBOARD_MEDIA_PLAYLIST_PATH)};
const defaultDirectory = defaultPlaylist.slice(0, defaultPlaylist.lastIndexOf("/"));
const shellQuote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";
const defaultImageQ = shellQuote(defaultImage);
const defaultPlaylistQ = shellQuote(defaultPlaylist);
const defaultDirectoryQ = shellQuote(defaultDirectory);
const stateFileQ = shellQuote(stateFile);
const currentPlaylistQ = shellQuote(currentPlaylist);
msg.payload = "mkdir -p " + defaultDirectoryQ +
    "; test -s " + defaultImageQ +
    "; printf '#EXTM3U\\n%s\\n' " + defaultImageQ + " > " + defaultPlaylistQ + ".tmp" +
    "; mv " + defaultPlaylistQ + ".tmp " + defaultPlaylistQ +
    "; if test -s " + stateFileQ + " && grep -Fq '\\"mode\\":\\"assigned\\"' " + stateFileQ +
    " && test -s " + currentPlaylistQ + "; then playlist=" + currentPlaylistQ +
    "; else playlist=" + defaultPlaylistQ + "; fi" +
    "; killall -9 mpv >/dev/null 2>&1 || true; sleep 1" +
    "; export DISPLAY=:0; mpv --fullscreen --loop-playlist --image-display-duration=20 --playlist=$playlist --ontop=yes";
node.status({ fill: "blue", shape: "ring", text: "restoring managed media locally" });
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

const stopMpv = "killall -9 mpv >/dev/null 2>&1 || true; sleep 1; ";
if (result.status === "unchanged") {
    const playTime = Math.max(1, Math.min(3600, Number(result.playTime || 20)));
    const expectedPlaylist = result.mode === "assigned"
        ? ${JSON.stringify(DASHBOARD_MEDIA_PLAYLIST_PATH)}
        : ${JSON.stringify(DEFAULT_MEDIA_PLAYLIST_PATH)};
    const expectedPlayerRunning = "ps -C mpv -o args= 2>/dev/null | grep -Fq -- '--playlist=" + expectedPlaylist + "'";
    msg.payload = "if ! " + expectedPlayerRunning + "; then " + stopMpv +
        "export DISPLAY=:0; mpv --fullscreen --loop-playlist --image-display-duration=" + playTime +
        " --playlist=" + expectedPlaylist + " --ontop=yes; fi";
    node.status({ fill: "blue", shape: "ring", text: result.mode === "assigned" ? "verifying dashboard playback" : "verifying default media" });
    return [msg, msg];
}

if (result.status === "failed") {
    node.status({ fill: "red", shape: "ring", text: String(result.error || "sync failed").slice(0, 48) });
    return [null, msg];
}

if (result.status === "applied") {
    const playTime = Math.max(1, Math.min(3600, Number(result.playTime || 20)));
    msg.payload = stopMpv + "export DISPLAY=:0; mpv --fullscreen --loop-playlist --image-display-duration=" + playTime + " --playlist=" + ${JSON.stringify(DASHBOARD_MEDIA_PLAYLIST_PATH)} + " --ontop=yes";
    node.status({ fill: "green", shape: "dot", text: "dashboard media applied" });
    return [msg, msg];
}

if (result.status === "cleared") {
    msg.payload = stopMpv + "export DISPLAY=:0; mpv --fullscreen --loop-playlist --image-display-duration=20 --playlist=" + ${JSON.stringify(DEFAULT_MEDIA_PLAYLIST_PATH)} + " --ontop=yes";
    node.status({ fill: "green", shape: "dot", text: "default media active" });
    return [msg, msg];
}

return [null, msg];`;

const prepareAckSource = `const sync = msg.mediaSync && typeof msg.mediaSync === "object" ? msg.mediaSync : {};
const kiosk = global.get("kiosk") || {};
const stationid = String(kiosk.stationid || msg.mediaStationId || "").trim().toUpperCase();
const provisionid = String(kiosk.provisionid || "").trim();
if (!/^[A-Z]{2}[0-9]{4}$/.test(stationid) || !provisionid) {
    node.status({ fill: "red", shape: "ring", text: "cannot identify media acknowledgement" });
    return [null, null];
}

const base = {
    stationid,
    provisionid,
    signature: String(sync.signature || ""),
    itemCount: Math.max(0, Number(sync.itemCount || 0)),
    sourceStatus: String(sync.status || "unknown"),
    error: String(sync.error || "").slice(0, 240)
};

function acknowledgement(status, error) {
    const reportedAt = new Date().toISOString();
    const reportedMedia = {
        ...base,
        status,
        reportedAt,
        error: String(error || base.error || "").slice(0, 240)
    };
    kiosk.reportedMedia = { ...reportedMedia };
    kiosk.mediaReportedAt = reportedAt;
    global.set("kiosk", kiosk);
    return {
        topic: "ack/" + stationid + "/media",
        qos: 1,
        retain: false,
        payload: reportedMedia
    };
}

if (sync.status === "failed") {
    node.status({ fill: "red", shape: "ring", text: "media load error" });
    return [acknowledgement("error", sync.error || "media_sync_failed"), null];
}

if (sync.status === "applied") {
    const verifyMsg = { ...msg, mediaAckBase: { ...base, expectedMode: "assigned" } };
    node.status({ fill: "blue", shape: "dot", text: "media downloaded; verifying player" });
    return [acknowledgement("downloaded", ""), verifyMsg];
}

if (sync.status === "unchanged" && sync.mode === "assigned") {
    msg.mediaAckBase = { ...base, expectedMode: "assigned" };
    return [null, msg];
}

if (sync.status === "cleared" || (sync.status === "unchanged" && sync.mode === "cleared")) {
    msg.mediaAckBase = { ...base, expectedMode: "cleared" };
    return [null, msg];
}

return [null, null];`;

const buildPlaybackCheckSource = `const ack = msg.mediaAckBase && typeof msg.mediaAckBase === "object" ? msg.mediaAckBase : {};
const expectedMode = ack.expectedMode === "cleared" ? "cleared" : "assigned";
const playlist = expectedMode === "assigned"
    ? ${JSON.stringify(DASHBOARD_MEDIA_PLAYLIST_PATH)}
    : ${JSON.stringify(DEFAULT_MEDIA_PLAYLIST_PATH)};
msg.mediaAckBase = { ...ack, expectedMode, expectedPlaylist: playlist };
msg.payload = "if ps -C mpv -o args= 2>/dev/null | grep -Fq -- '--playlist=" + playlist + "'; then printf media_player_match; else printf media_player_mismatch; fi";
return msg;`;

const finalizePlaybackAckSource = `const ack = msg.mediaAckBase && typeof msg.mediaAckBase === "object" ? msg.mediaAckBase : {};
const kiosk = global.get("kiosk") || {};
const stationid = String(ack.stationid || kiosk.stationid || "").trim().toUpperCase();
const provisionid = String(ack.provisionid || kiosk.provisionid || "").trim();
if (!/^[A-Z]{2}[0-9]{4}$/.test(stationid) || !provisionid) return null;

const matched = String(msg.payload || "").trim() === "media_player_match";
const expectedMode = ack.expectedMode === "cleared" ? "cleared" : "assigned";
const status = matched ? (expectedMode === "assigned" ? "playing" : "cleared") : "out_of_sync";
const reportedAt = new Date().toISOString();
const reportedMedia = {
    stationid,
    provisionid,
    signature: String(ack.signature || ""),
    itemCount: Math.max(0, Number(ack.itemCount || 0)),
    sourceStatus: String(ack.sourceStatus || "unknown"),
    status,
    reportedAt,
    error: matched ? "" : "expected_playlist_not_active"
};

kiosk.reportedMedia = { ...reportedMedia };
kiosk.mediaReportedAt = reportedAt;
global.set("kiosk", kiosk);
node.status(matched
    ? { fill: "green", shape: "dot", text: status === "playing" ? "dashboard media playing" : "default media active" }
    : { fill: "yellow", shape: "ring", text: "media player out of sync" });
return {
    topic: "ack/" + stationid + "/media",
    qos: 1,
    retain: false,
    payload: reportedMedia
};`;

function buildNodes() {
  return [
    {
      id: `${NODE_PREFIX}group_v1`,
      type: 'group',
      z: MEDIA_TAB_ID,
      name: 'V1 CK50 dashboard media sync — atomic local cache',
      style: { label: true, color: '#3FADB5' },
      nodes: [
        `${NODE_PREFIX}local_start_v1`,
        `${NODE_PREFIX}rotation_prepare_v1`,
        `${NODE_PREFIX}rotation_exec_v1`,
        `${NODE_PREFIX}rotation_result_v1`,
        `${NODE_PREFIX}rotation_retry_v1`,
        `${NODE_PREFIX}local_start_build_v1`,
        `${NODE_PREFIX}poll_v1`,
        `${NODE_PREFIX}prepare_v1`,
        `${NODE_PREFIX}fetch_v1`,
        `${NODE_PREFIX}build_v1`,
        `${NODE_PREFIX}sync_v1`,
        `${NODE_PREFIX}result_v1`,
        `${NODE_PREFIX}ack_prepare_v1`,
        `${NODE_PREFIX}verify_delay_v1`,
        `${NODE_PREFIX}verify_build_v1`,
        `${NODE_PREFIX}verify_exec_v1`,
        `${NODE_PREFIX}verify_result_v1`,
        `${NODE_PREFIX}ack_mqtt_v1`,
        `${NODE_PREFIX}status_v1`,
        `${NODE_PREFIX}error_v1`,
      ],
      x: 54,
      y: 1214,
      w: 1392,
      h: 428,
    },
    {
      id: `${NODE_PREFIX}local_start_v1`,
      type: 'inject',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Restore CK50 orientation + media after boot',
      props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }],
      repeat: '',
      once: true,
      onceDelay: '8',
      topic: '',
      payload: '',
      payloadType: 'date',
      x: 240,
      y: 1540,
      wires: [[`${NODE_PREFIX}rotation_prepare_v1`]],
    },
    {
      id: `${NODE_PREFIX}rotation_prepare_v1`,
      type: 'function',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Select CK50 screen rotation from hardware',
      func: prepareRotationSource,
      outputs: 2,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 510,
      y: 1540,
      wires: [[`${NODE_PREFIX}rotation_exec_v1`], [`${NODE_PREFIX}rotation_retry_v1`]],
    },
    {
      id: `${NODE_PREFIX}rotation_exec_v1`,
      type: 'exec',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Apply + verify CK50 rotation',
      command: '',
      addpay: 'payload',
      append: '',
      useSpawn: 'false',
      timer: '20',
      winHide: false,
      oldrc: false,
      x: 790,
      y: 1540,
      wires: [[`${NODE_PREFIX}rotation_result_v1`], [`${NODE_PREFIX}error_v1`], []],
    },
    {
      id: `${NODE_PREFIX}rotation_result_v1`,
      type: 'function',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Require verified rotation before media',
      func: finalizeRotationSource,
      outputs: 2,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 1060,
      y: 1540,
      wires: [[`${NODE_PREFIX}local_start_build_v1`], [`${NODE_PREFIX}rotation_retry_v1`]],
    },
    {
      id: `${NODE_PREFIX}rotation_retry_v1`,
      type: 'delay',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Wait for CK50 screen/X',
      pauseType: 'delay',
      timeout: '5',
      timeoutUnits: 'seconds',
      rate: '1',
      nbRateUnits: '1',
      rateUnits: 'second',
      randomFirst: '1',
      randomLast: '5',
      randomUnits: 'seconds',
      drop: false,
      allowrate: false,
      outputs: 1,
      x: 500,
      y: 1620,
      wires: [[`${NODE_PREFIX}rotation_prepare_v1`]],
    },
    {
      id: `${NODE_PREFIX}local_start_build_v1`,
      type: 'function',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Select managed playlist or default image',
      func: localStartupSource,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 1300,
      y: 1540,
      wires: [[RUN_MPV_NODE_ID]],
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
      name: 'Verify CK50 + prepare station media request',
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
      command: '',
      addpay: 'payload',
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
      wires: [[RUN_MPV_NODE_ID], [`${NODE_PREFIX}status_v1`, `${NODE_PREFIX}ack_prepare_v1`]],
    },
    {
      id: `${NODE_PREFIX}ack_prepare_v1`,
      type: 'function',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Report downloaded or prepare playback proof',
      func: prepareAckSource,
      outputs: 2,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 860,
      y: 1380,
      wires: [[`${NODE_PREFIX}ack_mqtt_v1`], [`${NODE_PREFIX}verify_delay_v1`]],
    },
    {
      id: `${NODE_PREFIX}verify_delay_v1`,
      type: 'delay',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Wait for mpv to settle',
      pauseType: 'delay',
      timeout: '3',
      timeoutUnits: 'seconds',
      rate: '1',
      nbRateUnits: '1',
      rateUnits: 'second',
      randomFirst: '1',
      randomLast: '5',
      randomUnits: 'seconds',
      drop: false,
      allowrate: false,
      outputs: 1,
      x: 220,
      y: 1460,
      wires: [[`${NODE_PREFIX}verify_build_v1`]],
    },
    {
      id: `${NODE_PREFIX}verify_build_v1`,
      type: 'function',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Build active playlist check',
      func: buildPlaybackCheckSource,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 470,
      y: 1460,
      wires: [[`${NODE_PREFIX}verify_exec_v1`]],
    },
    {
      id: `${NODE_PREFIX}verify_exec_v1`,
      type: 'exec',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      command: '',
      addpay: 'payload',
      append: '',
      useSpawn: 'false',
      timer: '15',
      winHide: false,
      oldrc: false,
      name: 'Verify active mpv playlist',
      x: 720,
      y: 1460,
      wires: [[`${NODE_PREFIX}verify_result_v1`], [`${NODE_PREFIX}error_v1`], []],
    },
    {
      id: `${NODE_PREFIX}verify_result_v1`,
      type: 'function',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Mark media playing or out of sync',
      func: finalizePlaybackAckSource,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: 1010,
      y: 1460,
      wires: [[`${NODE_PREFIX}ack_mqtt_v1`]],
    },
    {
      id: `${NODE_PREFIX}ack_mqtt_v1`,
      type: 'mqtt out',
      z: MEDIA_TAB_ID,
      g: `${NODE_PREFIX}group_v1`,
      name: 'Report dashboard media state',
      topic: '',
      qos: '1',
      retain: 'false',
      respTopic: '',
      contentType: '',
      userProps: '',
      correl: '',
      expiry: '',
      broker: MQTT_BROKER_NODE_ID,
      x: 1300,
      y: 1420,
      wires: [],
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

function disableObsoleteLegacyMediaNodes(flow) {
  const legacyMediaGroupIds = new Set(
    flow
      .filter((node) => (
        node?.type === 'group'
        && node?.z === MEDIA_TAB_ID
        && String(node?.name || '').trim().toLowerCase() === 'load media'
      ))
      .map((node) => node.id),
  );
  const mountDriveGroupIds = new Set(
    flow
      .filter((node) => (
        node?.type === 'group'
        && node?.z === MEDIA_TAB_ID
        && String(node?.name || '').trim().toLowerCase() === 'mount drive'
      ))
      .map((node) => node.id),
  );

  return flow.map((node) => {
    const isLegacyGroup = legacyMediaGroupIds.has(node?.id);
    const isLegacyGroupChild = legacyMediaGroupIds.has(node?.g);
    let isObsoleteMountNode = false;
    if (mountDriveGroupIds.has(node?.g)) {
      const searchable = JSON.stringify({
        name: node?.name,
        command: node?.command,
        append: node?.append,
        filename: node?.filename,
        rules: node?.rules,
        func: node?.func,
        payload: node?.payload,
      }).toLowerCase();
      isObsoleteMountNode = (
        searchable.includes('rclone mount gdrive:')
        || searchable.includes('/home/odroid/desktop/gdrive/picture/')
        || searchable.includes('/home/odroid/desktop/gdrive/logo.jpg')
        || (node?.type === 'exec' && String(node?.name || '').trim().toLowerCase() === 'run mount')
      );
    }

    return isLegacyGroup || isLegacyGroupChild || isObsoleteMountNode
      ? { ...node, d: true }
      : node;
  });
}

export function patchV1Ck50DashboardMediaFlow(flow) {
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
  const mqttBroker = flow.find((node) => node?.id === MQTT_BROKER_NODE_ID && node?.type === 'mqtt-broker');
  if (!mqttBroker) {
    throw new Error('Expected the existing kiosk MQTT broker before patching');
  }

  const preserved = disableObsoleteLegacyMediaNodes(
    flow.filter((node) => !String(node?.id || '').startsWith(NODE_PREFIX)),
  );
  return [...preserved, ...buildNodes()];
}

function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error('Usage: node patch-v1-ck50-dashboard-media.mjs <input-flow.json> <output-flow.json>');
  }
  const flow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const patched = patchV1Ck50DashboardMediaFlow(flow);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(patched, null, 2)}\n`);
  console.log(`Patched reusable V1 CK50 dashboard media sync (${flow.length} -> ${patched.length} nodes).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
