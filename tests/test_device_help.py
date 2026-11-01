import os,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch

class DeviceHelpTests(unittest.TestCase):
    def test_protected_tutorials(self):
        with tempfile.TemporaryDirectory(prefix='device-help-',dir=os.environ.get('RADIO_TEST_TMP')) as root:
            with patch.dict(os.environ,{'RADIO_DATA_DIR':root,'ADMIN_SECRET_KEY':'device-test-only','SESSION_COOKIE_SECURE':'false','RADIO_AUTO_BACKUP':'0','DEVICE_HELP_PASSCODE_HASH':''}):
                result=subprocess.run([sys.executable,str(Path(__file__).with_name('device_help_workflow.py'))],capture_output=True,text=True,timeout=120)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
