import importlib.util
from pathlib import Path
import os
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('maintenance', Path(__file__).with_name('chargerent-storage-maintenance.py'))
maintenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)


class RetentionTests(unittest.TestCase):
    def test_keeps_active_two_rollbacks_and_in_progress_artifacts(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            now = time.time() + 30 * 86400
            active = root / 'active'; active.mkdir()
            paths = [active]
            for index in range(5):
                item = root / ('release-' + str(index)); item.mkdir()
                os.utime(item, (now - (index + 2) * 86400,) * 2)
                paths.append(item)
            recent = root / 'in-progress'; recent.mkdir(); os.utime(recent, (now, now)); paths.append(recent)
            link = root / 'outside-link'; link.symlink_to(root.parent, target_is_directory=True); paths.append(link)
            removed = maintenance.choose_old(paths, {active}, now)
            self.assertNotIn(active, removed)
            self.assertNotIn(recent, removed)
            self.assertNotIn(link, removed)
            self.assertNotIn(root / 'release-0', removed)
            self.assertNotIn(root / 'release-1', removed)
            self.assertIn(root / 'release-4', removed)

    def test_refuses_symlinks_active_descendants_and_unapproved_roots(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            release = root / 'release'; release.mkdir()
            live = release / 'live'; live.mkdir()
            with self.assertRaises(RuntimeError):
                maintenance.validate_candidate(release, True, [root], {live})
            with self.assertRaises(RuntimeError):
                maintenance.validate_candidate(release, True, [], set())
            link = root / 'link'; link.symlink_to(release, target_is_directory=True)
            with self.assertRaises(RuntimeError):
                maintenance.validate_candidate(link, True, [root], set())

    def test_current_and_retained_rollback_apks_are_protected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'current.json').write_text('{"file":"live.apk"}')
            rollback = root / 'rollback'; rollback.mkdir()
            (rollback / 'current.json').write_text('{"file":"rollback.apk"}')
            original = maintenance.RELEASE_ROOT
            try:
                maintenance.RELEASE_ROOT = root
                self.assertEqual(maintenance.current_apk_names([]), {'live.apk', 'rollback.apk'})
                self.assertEqual(maintenance.current_apk_names([rollback]), {'live.apk'})
                (root / 'current.json').write_text('{"file":"../outside.apk"}')
                with self.assertRaises(RuntimeError):
                    maintenance.current_apk_names([])
            finally:
                maintenance.RELEASE_ROOT = original


if __name__ == '__main__':
    unittest.main()
