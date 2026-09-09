import json
import os
import secrets
from pathlib import Path
from flask import request, render_template, redirect, url_for

BASE = Path(__file__).resolve().parent
SETTINGS = BASE / 'ads.json'
MEDIA = BASE / 'static' / 'ads'

def load_ad():
    try:
        return json.loads(SETTINGS.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}

def public_ad():
    ad = load_ad()
    return ad if ad.get('enabled') and ad.get('src') else None

def register_ads(app):
    @app.route('/admin/ads', methods=['GET', 'POST'])
    def admin_ads():
        ad = load_ad()
        error = ''
        if request.method == 'POST':
            try:
                duration = int(request.form.get('duration', '10'))
                if not 5 <= duration <= 120:
                    raise ValueError('Display time must be between 5 and 120 seconds.')
                frequency = request.form.get('frequency', 'visit')
                if frequency not in ('visit', 'always'):
                    raise ValueError('Choose a valid frequency.')
                upload = request.files.get('media')
                if upload and upload.filename:
                    ext = Path(upload.filename).suffix.lower()
                    if ext not in ('.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm'):
                        raise ValueError('Upload JPG, PNG, WebP, MP4, or WebM.')
                    raw = upload.stream.read(50 * 1024 * 1024 + 1)
                    if not raw or len(raw) > 50 * 1024 * 1024:
                        raise ValueError('Choose a non-empty file no larger than 50 MB.')
                    valid = ((ext in ('.jpg', '.jpeg') and raw.startswith(b'\xff\xd8\xff')) or
                             (ext == '.png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or
                             (ext == '.webp' and raw[:4] == b'RIFF' and raw[8:12] == b'WEBP') or
                             (ext == '.mp4' and raw[4:8] == b'ftyp') or
                             (ext == '.webm' and raw.startswith(b'\x1aE\xdf\xa3')))
                    if not valid:
                        raise ValueError('The file content does not match its format.')
                    MEDIA.mkdir(parents=True, exist_ok=True)
                    filename = secrets.token_hex(16) + ext
                    (MEDIA / filename).write_bytes(raw)
                    ad.update(src='/static/ads/' + filename, kind='video' if ext in ('.mp4', '.webm') else 'image')
                enabled = request.form.get('enabled') == 'on'
                if enabled and not ad.get('src'):
                    raise ValueError('Upload an ad before enabling it.')
                ad.update(enabled=enabled, duration=duration, frequency=frequency,
                          skip=request.form.get('skip') == 'on', title=request.form.get('title', '').strip()[:100])
                temporary = SETTINGS.with_suffix('.tmp')
                temporary.write_text(json.dumps(ad), encoding='utf-8')
                os.replace(temporary, SETTINGS)
                return redirect(url_for('admin_ads', saved='1'))
            except (ValueError, OSError) as exc:
                error = str(exc) if isinstance(exc, ValueError) else 'Unable to save the ad. Please try again.'
        return render_template('admin_ads.html', ad=ad, error=error, saved=request.args.get('saved') == '1')
