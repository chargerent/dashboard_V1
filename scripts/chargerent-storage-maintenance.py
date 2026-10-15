#!/usr/bin/env python3
"""Prune only Chargerent deployment artifacts and old diagnostic core dumps.

Dry-run is the default. Active paths, current APK metadata, two rollback
copies, and artifacts younger than 24 hours are always retained.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import time

GIB = 1024 ** 3
GRACE_SECONDS = 24 * 60 * 60
KEEP_ROLLBACKS = 2
DIRECTORY_ROOTS = (
    Path('/home/george/dashboard-releases'),
    Path('/home/george/dashboard-backups'),
    Path('/opt/chargerent-media/builds'),
    Path('/opt/chargerent-media/releases/rollback'),
    Path('/opt/chargerent-media/releases/backups'),
)
RELEASE_ROOT = Path('/opt/chargerent-media/releases')
CORE_ROOT = Path('/var/lib/apport/coredump')
CURRENT = Path('/opt/chargerent-media/current')
PROTECTED_BASES = (
    Path('/var/www/portal'), Path('/var/www/chargerent-public'),
    Path('/var/www/stationfinder'), Path('/var/lib/chargerent-media'),
    Path('/etc/chargerent-media'), Path('/home/george/.node-red'),
)


def within(path, parent):
    return path == parent or parent in path.parents


def active_paths():
    result = {path.resolve() for path in PROTECTED_BASES}
    if not CURRENT.is_symlink() or not CURRENT.resolve().is_dir():
        raise RuntimeError('The active media release could not be verified.')
    result.add(CURRENT.resolve())
    for process in Path('/proc').glob('[0-9]*'):
        references = [process / 'cwd', process / 'exe']
        try:
            references.extend((process / 'fd').glob('[0-9]*'))
        except OSError:
            pass
        for reference in references:
            try:
                result.add(reference.resolve(strict=True))
            except (OSError, RuntimeError):
                pass
    return result


def protected(path, active):
    target = path.resolve()
    return any(within(value.resolve(), target) for value in active)


def artifact_time(path):
    info = path.stat()
    # Copied releases can preserve an old directory mtime. Their dated names
    # and creation/change time prevent pruning a newly staged release.
    stamp = max(info.st_mtime, info.st_ctime)
    for value in re.findall(r'(?<!\d)(20\d{6})(?!\d)', path.name):
        try:
            stamp = max(stamp, datetime.strptime(value, '%Y%m%d').replace(tzinfo=timezone.utc).timestamp())
        except ValueError:
            pass
    return stamp


def choose_old(paths, active, now, keep=KEEP_ROLLBACKS):
    eligible = []
    for path in paths:
        if path.is_symlink() or protected(path, active) or now - artifact_time(path) < GRACE_SECONDS:
            continue
        eligible.append(path)
    def order(path):
        versions = re.findall(r'(?:^|[-_])v(\d+)(?:[^0-9]|$)', path.name)
        return artifact_time(path), int(versions[-1]) if versions else 0, path.name
    eligible.sort(key=order, reverse=True)
    return eligible[keep:]


def artifact_roots():
    roots = list(DIRECTORY_ROOTS)
    channels = RELEASE_ROOT / 'channels'
    if channels.exists():
        if channels.is_symlink():
            raise RuntimeError('The media channels root must not be a symlink.')
        for channel in channels.iterdir():
            if re.fullmatch(r'[a-f0-9]{64}', channel.name) and channel.is_dir() and not channel.is_symlink():
                roots.append(channel / 'rollback')
    return roots


def current_apk_names(removed_directories):
    """Preserve references from all current and retained rollback metadata."""
    refs = set()
    manifests = list(RELEASE_ROOT.rglob('current.json'))
    if RELEASE_ROOT / 'current.json' not in manifests:
        raise RuntimeError('Current media APK metadata is missing.')
    for manifest in manifests:
        if any(within(manifest, removed) for removed in removed_directories):
            continue
        if manifest.is_symlink():
            raise RuntimeError('Media APK metadata must be a regular file.')
        metadata = json.loads(manifest.read_text())
        name = metadata.get('file')
        if not isinstance(name, str) or Path(name).name != name or not name.endswith('.apk'):
            raise RuntimeError('Media APK metadata has an invalid file reference.')
        refs.add(name)
    return refs


def build_plan(active, now):
    directories = []
    roots = artifact_roots()
    # Dashboard rollback snapshots share one retention pool.
    dashboard = []
    for root in roots:
        if not root.exists():
            continue
        if root.is_symlink():
            raise RuntimeError('Artifact retention roots must not be symlinks.')
        children = [path for path in root.iterdir() if path.is_dir() and not path.is_symlink()]
        if root in DIRECTORY_ROOTS[:2]:
            dashboard.extend(children)
        else:
            directories.extend(choose_old(children, active, now))
    directories.extend(choose_old(dashboard, active, now))
    references = current_apk_names(directories)
    apk_roots = [RELEASE_ROOT]
    channels = RELEASE_ROOT / 'channels'
    if channels.exists():
        apk_roots.extend(path for path in channels.iterdir()
                         if re.fullmatch(r'[a-f0-9]{64}', path.name)
                         and path.is_dir() and not path.is_symlink())
    files = []
    for root in apk_roots:
        apks = [path for path in root.glob('*.apk')
                if path.is_file() and path.name not in references]
        files.extend(choose_old(apks, active, now))
    if CORE_ROOT.exists() and not CORE_ROOT.is_symlink():
        cores = [path for path in CORE_ROOT.glob('core.*')
                 if path.is_file() and not path.is_symlink()]
        # Oversized historical dumps are disposable diagnostics; recent files
        # may still be written by Apport and are not touched.
        oversized = [path for path in cores if path.stat().st_size > 256 * 1024 ** 2
                     and now - path.stat().st_mtime >= 60 * 60]
        files.extend(oversized)
        older_cores = [path for path in cores if path not in oversized
                       and now - path.stat().st_mtime >= 60 * 60
                       and not protected(path, active)]
        older_cores.sort(key=lambda path: path.stat().st_mtime, reverse=True)
        files.extend(older_cores[KEEP_ROLLBACKS:])
    return directories, files, roots, apk_roots


def validate_candidate(path, directory, roots, active):
    if path.is_symlink() or protected(path, active):
        raise RuntimeError('Refusing to remove an active or symlink artifact: ' + str(path))
    allowed = roots if directory else roots + [CORE_ROOT]
    if path.parent not in allowed or path.parent.is_symlink():
        raise RuntimeError('Removal is outside a permitted artifact root: ' + str(path))
    if path.resolve().parent != path.parent:
        raise RuntimeError('Artifact parent resolves outside its permitted root.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    active = active_paths()
    now = time.time()
    directories, files, directory_roots, apk_roots = build_plan(active, now)
    plan = [(path, True) for path in directories] + [(path, False) for path in files]
    signatures = {}
    for path, directory in plan:
        validate_candidate(path, directory, directory_roots if directory else apk_roots, active)
        info = path.stat()
        signatures[path] = (info.st_ino, info.st_mtime_ns)
    print(json.dumps({'apply': args.apply, 'candidates': [str(path) for path, _ in plan],
                      'freeGiBBefore': round(shutil.disk_usage('/').free / GIB, 2)}), flush=True)
    if args.apply:
        if os.geteuid() != 0:
            raise RuntimeError('Applying server retention requires root privileges.')
        # Recheck live references immediately before deleting any artifact.
        active = active_paths()
        for path, directory in plan:
            validate_candidate(path, directory, directory_roots if directory else apk_roots, active)
            info = path.stat()
            if signatures[path] != (info.st_ino, info.st_mtime_ns):
                raise RuntimeError('An artifact changed after planning; cleanup stopped.')
            if not directory and path.suffix == '.apk' and path.name in current_apk_names(directories):
                raise RuntimeError('An APK became referenced after planning; cleanup stopped.')
            if directory:
                shutil.rmtree(path)
            else:
                path.unlink()
            print('Removed ' + str(path), flush=True)
    free = shutil.disk_usage('/').free
    print(json.dumps({'freeGiBAfter': round(free / GIB, 2), 'minimumFreeGiB': 5}), flush=True)
    if free < 5 * GIB:
        raise SystemExit('LOW_DISK_SPACE: fewer than 5 GiB remain after permitted retention.')


if __name__ == '__main__':
    main()
