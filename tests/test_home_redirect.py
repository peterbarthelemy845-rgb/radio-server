"""Exercise the actual homepage handler without initializing production databases."""
import ast
from pathlib import Path
import unittest
from flask import Flask, request, redirect


class HomepageRedirectTests(unittest.TestCase):
    def test_old_home_redirects_without_looping_cloudflare_origin(self):
        source = ast.parse((Path(__file__).resolve().parents[1] / 'app.py').read_text(encoding='utf-8'))
        handler = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'index')
        handler.decorator_list = []
        namespace = dict(request=request, redirect=redirect,
                         render_template=lambda *args, **kwargs: 'homepage', is_public_website=lambda: True)
        exec(compile(ast.Module(body=[handler], type_ignores=[]), 'app.py', 'exec'), namespace)
        app = Flask(__name__)
        app.add_url_rule('/', view_func=namespace['index'])
        client = app.test_client()
        for host in ['radiolavoixdivine.com', 'www.radiolavoixdivine.com']:
            response = client.get('/', base_url='https://' + host)
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.headers['Location'], 'https://radiolocals.com/#radio')
        for host in ['radiolocals.com', 'radio-server-z0hb.onrender.com', 'localhost']:
            response = client.get('/', base_url='https://' + host)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.text, 'homepage')
