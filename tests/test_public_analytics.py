import unittest
from pathlib import Path
from flask import Flask
from public_analytics import register_public_analytics


class PublicAnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__, template_folder=str(Path(__file__).resolve().parents[1] / 'templates'))
        self.app.jinja_env.globals['csp_nonce'] = lambda: 'test-nonce'
        for endpoint, path in [('index', '/'), ('add_station_page', '/add-station'),
                               ('station_share', '/station/10'), ('admin', '/admin'),
                               ('editor', '/station/edit'), ('phone', '/radio/link'),
                               ('email', '/station-access/confirm')]:
            self.app.add_url_rule(path, endpoint, lambda: '<html><body>Example</body></html>', methods=['GET', 'POST'])
        register_public_analytics(self.app)
        self.client = self.app.test_client()

    def test_public_pages_have_one_nonce_authorized_beacon(self):
        for path in ('/', '/add-station', '/station/10'):
            response = self.client.get(path)
            self.assertEqual(response.data.count(b'data-cf-beacon='), 1)
            self.assertIn(b'nonce="test-nonce"', response.data)
            self.assertIn(b'https://static.cloudflareinsights.com/beacon.min.js', response.data)

    def test_sensitive_pages_and_post_responses_never_include_analytics(self):
        for path in ('/admin', '/station/edit', '/radio/link', '/station-access/confirm'):
            self.assertNotIn(b'data-cf-beacon=', self.client.get(path).data)
        self.assertNotIn(b'data-cf-beacon=', self.client.post('/add-station').data)

    def test_private_query_parameters_are_excluded(self):
        for query in ('token=private', 'code=private', 'radio_code=private', 'claim_id=private', 'pin=private'):
            self.assertNotIn(b'data-cf-beacon=', self.client.get('/?' + query).data)
        self.assertIn(b'data-cf-beacon=', self.client.get('/?utm_source=whatsapp').data)
