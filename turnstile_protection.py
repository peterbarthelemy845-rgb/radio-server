"""Optional Turnstile checks for public submissions and email requests."""
import http.client
import json
import os
import ssl
from flask import request, jsonify, render_template

ACTIONS = {
    '/api/add-station': 'station-submit',
    '/station-access/request': 'station-access',
    '/api/registration/resend': 'registration-resend',
    '/station-access/resend-code': 'station-edit-resend',
    '/station-code/resend': 'station-code-resend',
}
HOSTS = {'radiolavoixdivine.com', 'www.radiolavoixdivine.com', 'radio-server-z0hb.onrender.com'}


def enabled():
    # Partial configuration also enforces protection rather than failing open.
    return bool(os.environ.get('TURNSTILE_SITE_KEY') or os.environ.get('TURNSTILE_SECRET_KEY'))


def siteverify(token):
    connection = http.client.HTTPSConnection('challenges.cloudflare.com', timeout=8, context=ssl.create_default_context())
    try:
        payload = json.dumps({'secret': os.environ['TURNSTILE_SECRET_KEY'], 'response': token}).encode()
        connection.request('POST', '/turnstile/v0/siteverify', payload, {'Content-Type': 'application/json'})
        response = connection.getresponse()
        raw = response.read(16385)
        if response.status != 200 or len(raw) > 16384:
            raise ValueError('Verification unavailable')
        return json.loads(raw)
    finally:
        connection.close()


def register_turnstile(app):
    app.jinja_env.globals['turnstile_site_key'] = lambda: os.environ.get('TURNSTILE_SITE_KEY', '')

    @app.before_request
    def protect_public_forms():
        action = ACTIONS.get(request.path)
        if request.method != 'POST' or not action or not enabled():
            return None
        from station_owners import check_token
        check_token()
        status = 400
        message = 'Please complete the security check and try again.'
        if not os.environ.get('TURNSTILE_SECRET_KEY') or not os.environ.get('TURNSTILE_SITE_KEY'):
            status, message = 503, 'Security verification is temporarily unavailable. Please try again later.'
        else:
            data = (request.get_json(silent=True) if request.is_json else request.form) or {}
            token = data.get('cf-turnstile-response', '')
            if isinstance(token, str) and 0 < len(token) <= 2048:
                try:
                    result = siteverify(token)
                    if (result.get('success') is True and result.get('action') == action
                            and result.get('hostname') in HOSTS):
                        return None
                except Exception:
                    status, message = 503, 'Security verification is temporarily unavailable. Please try again later.'
        if request.is_json or request.headers.get('X-Requested-With') == 'fetch' or request.path in ('/api/registration/resend', '/station-access/resend-code'):
            return jsonify(status='error', message=message), status
        return render_template('security_check_error.html', message=message), status
