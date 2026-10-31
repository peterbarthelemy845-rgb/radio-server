import os,tempfile,unittest,subprocess,sys
from pathlib import Path
from unittest.mock import patch
class ContentModerationTests(unittest.TestCase):
 def test_content_review_workflow(self):
  with tempfile.TemporaryDirectory(prefix='radio-content-',dir=os.environ.get('RADIO_TEST_TMP')) as temp,patch.dict(os.environ,{'RADIO_DATA_DIR':temp,'ADMIN_SECRET_KEY':'isolated-moderation-tests','RADIO_AUTO_BACKUP':'0','SESSION_COOKIE_SECURE':'false'}):
   result=subprocess.run([sys.executable,str(Path(__file__).with_name('moderation_workflow.py'))],text=True,capture_output=True,timeout=120)
   self.assertEqual(result.returncode,0,result.stdout+result.stderr)
