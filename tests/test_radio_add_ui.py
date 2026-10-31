import shutil,subprocess,unittest
from pathlib import Path

class RadioAddUiTests(unittest.TestCase):
 @unittest.skipUnless(shutil.which('node'),'Node is needed for the browser state-machine check')
 def test_single_page_consent_and_radio_acknowledgement(self):
  result=subprocess.run([shutil.which('node'),str(Path(__file__).with_name('check-radio-add-ui.cjs'))],capture_output=True,text=True,timeout=30)
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
