"""No real radios, email or outbound connections are used by these checks."""
import os,tempfile,unittest,time,json,hashlib,secrets
from pathlib import Path
from unittest.mock import patch


class RadioLinkTests(unittest.TestCase):
 def test_physical_pairing_and_acknowledged_station_add(self):
  with tempfile.TemporaryDirectory(prefix='radio-links-',dir=os.environ.get('RADIO_TEST_TMP')) as temp,patch.dict(os.environ,{'RADIO_DATA_DIR':temp,'ADMIN_SECRET_KEY':'isolated-radio-link-tests-not-production','RADIO_AUTO_BACKUP':'0','SESSION_COOKIE_SECURE':'false'}):
   # Fresh subprocess execution avoids shared module path state with other tests.
   import subprocess,sys
   result=subprocess.run([sys.executable,str(Path(__file__).with_name('radio_link_workflow.py'))],capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stdout+result.stderr)

if __name__=='__main__':unittest.main()
