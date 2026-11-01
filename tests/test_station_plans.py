import os,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from station_plans import plan_for,month_key
from datetime import datetime,timezone

class PlanTests(unittest.TestCase):
    def test_prices_and_calendar_boundaries(self):
        for count,price in [(0,0),(10,0),(11,30),(100,30),(101,50),(300,50),(301,None)]:
            self.assertEqual(plan_for(count)['price'],price)
        self.assertEqual(month_key(datetime(2026,11,1,3,30,tzinfo=timezone.utc).timestamp()),'2026-10')
        self.assertEqual(month_key(datetime(2026,11,1,4,30,tzinfo=timezone.utc).timestamp()),'2026-11')

    def test_authenticated_monthly_usage(self):
        with tempfile.TemporaryDirectory(prefix='station-plans-',dir=os.environ.get('RADIO_TEST_TMP')) as root:
            with patch.dict(os.environ,{'RADIO_DATA_DIR':root,'ADMIN_SECRET_KEY':'plans-test-only','SESSION_COOKIE_SECURE':'false','RADIO_AUTO_BACKUP':'0'}):
                result=subprocess.run([sys.executable,str(Path(__file__).with_name('station_plans_workflow.py'))],capture_output=True,text=True,timeout=120)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
