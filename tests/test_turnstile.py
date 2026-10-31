import os
import unittest
import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch
from flask import Flask
import turnstile_protection as protection


class TurnstileTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'TURNSTILE_SITE_KEY': 'test-site', 'TURNSTILE_SECRET_KEY': 'test-secret'})
        self.env.start()
        self.app = Flask(__name__)
        self.app.secret_key = 'test-only'
        self.calls = []
        for path in protection.ACTIONS:
            def view(path=path):
                self.calls.append(path)
                return {'status': 'ok'}
            self.app.add_url_rule(path, path, view, methods=['POST'])
        protection.register_turnstile(self.app)
        self.client = self.app.test_client()
        self.csrf = patch('station_owners.check_token')
        self.csrf.start()

    def tearDown(self):
        self.csrf.stop()
        self.env.stop()

    def post(self, path='/api/add-station', token='test-token'):
        return self.client.post(path, json={'cf-turnstile-response': token})

    def test_each_public_email_and_submission_route_requires_matching_action(self):
        for path, action in protection.ACTIONS.items():
            with patch.object(protection, 'siteverify', return_value={
                'success': True, 'hostname': 'www.radiolavoixdivine.com', 'action': action,
            }):
                self.assertEqual(self.post(path).status_code, 200)
        self.assertEqual(len(self.calls), len(protection.ACTIONS))

    def test_missing_invalid_or_oversized_tokens_never_call_provider(self):
        with patch.object(protection, 'siteverify') as verify:
            for token in ('', None, 123, 'x' * 2049):
                self.assertEqual(self.post(token=token).status_code, 400)
            verify.assert_not_called()
        self.assertFalse(self.calls)

    def test_forged_replayed_wrong_host_and_wrong_action_fail_closed(self):
        valid = dict(success=True, hostname='www.radiolavoixdivine.com', action='station-submit')
        for result in ({}, dict(valid, success=False), dict(valid, success='true'),
                       dict(valid, hostname='attacker.example'), dict(valid, action='station-access')):
            with patch.object(protection, 'siteverify', return_value=result):
                self.assertEqual(self.post().status_code, 400)
        self.assertFalse(self.calls)

    def test_timeout_and_partial_configuration_fail_closed(self):
        with patch.object(protection, 'siteverify', side_effect=TimeoutError):
            self.assertEqual(self.post().status_code, 503)
        with patch.dict(os.environ, {'TURNSTILE_SECRET_KEY': ''}), patch.object(protection, 'siteverify') as verify:
            self.assertEqual(self.post().status_code, 503)
            verify.assert_not_called()
        self.assertFalse(self.calls)

    def test_unconfigured_release_is_safe_to_deploy_before_keys(self):
        with patch.dict(os.environ, {'TURNSTILE_SITE_KEY': '', 'TURNSTILE_SECRET_KEY': ''}):
            self.assertEqual(self.post().status_code, 200)

    def test_fixed_transport_rejects_redirects_and_never_prints_secret(self):
        from unittest.mock import MagicMock
        connection = MagicMock()
        connection.getresponse.return_value.status = 302
        connection.getresponse.return_value.read.return_value = b'private provider body'
        with patch.object(protection.http.client, 'HTTPSConnection', return_value=connection) as constructor:
            with self.assertRaises(ValueError) as result:
                protection.siteverify('test-token')
            self.assertNotIn('private provider body', str(result.exception))
            self.assertEqual(constructor.call_args.args[0], 'challenges.cloudflare.com')
            connection.request.assert_called_once()
            connection.close.assert_called_once()

    @unittest.skipUnless(shutil.which('node'), 'Node required for form behavior check')
    def test_browser_form_security_flow(self):
        result = subprocess.run([shutil.which('node'), str(Path(__file__).with_name('check-turnstile-ui.cjs'))], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
