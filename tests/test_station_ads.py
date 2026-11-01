"""Isolated local-ad workflow; no real owners, radios, mail or AI calls."""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch


class LocalAdTests(unittest.TestCase):
    def test_scoped_ads_and_device_delivery(self):
        with tempfile.TemporaryDirectory(prefix='local-ads-', dir=os.environ.get('RADIO_TEST_TMP')) as root:
            with patch.dict(os.environ, {'RADIO_DATA_DIR': root, 'ADMIN_SECRET_KEY': 'local-ad-isolated-test',
                                        'SESSION_COOKIE_SECURE': 'false', 'RADIO_AUTO_BACKUP': '0'}):
                result = subprocess.run([sys.executable, str(Path(__file__).with_name('station_ads_workflow.py'))],
                                        capture_output=True, text=True, timeout=120)
                self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
