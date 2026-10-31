"""Fail-closed station screening. No external calls until explicitly configured."""
import base64
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import ssl
import time

POLICY_VERSION = 'family-friendly-2026-10-31'
MAX_IMAGE_BYTES = 2 * 1024 * 1024


def content_hash(station):
    fields = {k: station.get(k, '') for k in
              ('name', 'subtitle', 'bio', 'url', 'logo_url', 'wallpaper')}
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()


def scanner_ready():
    return os.environ.get('STATION_IMAGE_MODERATION') == 'openai' and bool(os.environ.get('OPENAI_API_KEY', '').strip())


def moderation_request(inputs):
    # Fixed host/path, verified TLS, bounded response, no redirects or retries.
    connection = http.client.HTTPSConnection('api.openai.com', timeout=8, context=ssl.create_default_context())
    try:
        connection.request('POST', '/v1/moderations', json.dumps({
            'model': 'omni-moderation-latest', 'input': inputs,
        }).encode(), {'Authorization': 'Bearer ' + os.environ['OPENAI_API_KEY'].strip(),
                     'Content-Type': 'application/json'})
        response = connection.getresponse()
        raw = response.read(65537)
        if response.status != 200 or len(raw) > 65536:
            raise ValueError('Scanner unavailable')
        return json.loads(raw)
    finally:
        connection.close()


def assess(station, upload_root, approved=None):
    from content_moderation import station_error
    result = dict(status='review', reasons=[], checked_at=int(time.time()),
                  policy=POLICY_VERSION, content_hash=content_hash(station), provider='local')
    # Never forward content already flagged locally, including suspected abuse.
    error = station_error(station)
    if error:
        result['reasons'] = [error]
        return result
    trusted = {approved.get(k) for k in ('logo_url', 'wallpaper')} if approved else set()
    paths = set(filter(None, (station.get('logo_url'), station.get('wallpaper')))) - trusted
    if not paths:
        result.update(status='passed', reasons=['Text passed; artwork was previously approved.'])
        return result
    if not scanner_ready():
        result['reasons'] = ['Artwork scanner is not connected; administrator review required.']
        return result
    try:
        root = Path(upload_root).resolve()
        inputs = [{'type': 'text', 'text': '\n'.join(str(station.get(k, '')) for k in ('name', 'subtitle', 'bio'))}]
        for url in sorted(paths):
            # Only our immutable, normalized local PNG uploads. No URL fetching.
            if not url.startswith('/static/wallpapers/') or '/' in url[len('/static/wallpapers/'):]:
                raise ValueError('Unrecognized artwork')
            path = (root / url.rsplit('/', 1)[-1]).resolve()
            if path.parent != root or path.suffix.lower() != '.png':
                raise ValueError('Unrecognized artwork')
            with path.open('rb') as image:
                raw = image.read(MAX_IMAGE_BYTES + 1)
            if len(raw) > MAX_IMAGE_BYTES or not raw.startswith(b'\x89PNG\r\n\x1a\n'):
                raise ValueError('Invalid artwork')
            inputs.append({'type': 'image_url', 'image_url': {
                'url': 'data:image/png;base64,' + base64.b64encode(raw).decode('ascii')}})
        result['provider'] = 'openai/omni-moderation-latest'
        response = moderation_request(inputs)
        rows = response['results']
        if not isinstance(rows, list) or len(rows) != 1:
            raise ValueError('Invalid scanner response')
        row = rows[0]
        flagged = row['flagged']
        sexual = row['category_scores']['sexual']
        if type(flagged) is not bool or type(sexual) not in (int, float) or not math.isfinite(sexual) or not 0 <= sexual <= 1:
            raise ValueError('Invalid scanner response')
        # Conservative additional review threshold, not an exact probability.
        if flagged or sexual >= 0.05:
            result['reasons'] = ['Automatic screening flagged content for administrator review.']
        else:
            result.update(status='passed', reasons=['Automatic text and artwork screening passed.'])
    except Exception:
        # Never log API keys, submitted image bytes or provider error bodies.
        result['reasons'] = ['Artwork could not be checked; administrator review required.']
    return result


def can_publish(station):
    check = station.get('content_moderation') or {}
    return (check.get('status') == 'passed' and check.get('policy') == POLICY_VERSION
            and check.get('content_hash') == content_hash(station)
            and not station.get('suspended') and not station.get('owner_suspended'))
