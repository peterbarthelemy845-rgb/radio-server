from flask import Flask, render_template, request, jsonify, redirect, session, url_for
import json
import os
import subprocess
import shlex
import time
import socket
import secrets
import urllib.request
import requests
import xml.etree.ElementTree as ET
import re
from html import unescape
from urllib.parse import urlparse, quote, urljoin
from werkzeug.utils import secure_filename
import pyotp

app = Flask(__name__)
app.secret_key = os.environ.get("ADMIN_SECRET_KEY", "change-this-radio-admin-key")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "1234")
ADMIN_MFA_PHONE = os.environ.get("ADMIN_MFA_PHONE", "").strip()
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_FROM_NUMBER", "").strip()
ADMIN_TOTP_SECRET = os.environ.get("ADMIN_TOTP_SECRET", "").replace(" ", "").strip()
MFA_CODE_TTL_SECONDS = 300
CONFIG_FILE = "config.json"
STATIONS_FILE = "stations.json"
REPORTS_FILE = "reports.json"
HAITIAN_TIMES_RSS_URL = os.environ.get("HAITIAN_TIMES_RSS_URL", "https://haitiantimes.com/feed/")
LE_NOUVELLISTE_URL = os.environ.get("LE_NOUVELLISTE_URL", "https://lenouvelliste.com/")
HAITILIBRE_URL = os.environ.get("HAITILIBRE_URL", "https://www.haitilibre.com/")
HAITILIBRE_RSS_URL = os.environ.get("HAITILIBRE_RSS_URL", "https://www.haitilibre.com/rss-flash-en.php")
NEWS_CACHE_TTL_SECONDS = 900
SERVER_STATIONS_API = os.environ.get("SERVER_STATIONS_API", "https://www.radiolavoixdivine.com/api/stations")
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "wallpapers")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

def allowed_image(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


player_process = None
current_playing = {
    "is_playing": False,
    "station_name": "La Voix Divine",
    "station_subtitle": "Internet Stream",
    "stream_url": "https://icecast3.getstreamhosting.com/proxy/radiodivinessl/live",
    "website": "radiolavoixdivine.com",
    "logo": "🎧",
}
news_cache = {"items": [], "fetched_at": 0}


PUBLIC_HOSTS = {"www.radiolavoixdivine.com", "radiolavoixdivine.com", "radio-server-z0hb.onrender.com"}
MAIN_STREAM_URL = "https://icecast3.getstreamhosting.com/proxy/radiodivinessl/live"

def is_public_website():
    host = (request.host or "").split(":", 1)[0].lower()
    return host in PUBLIC_HOSTS or host.endswith(".onrender.com")

TEST_STREAMS = [
    {"name": "La Voix Divine", "subtitle": "radiolavoixdivine.com", "website": "radiolavoixdivine.com", "url": "https://icecast3.getstreamhosting.com/proxy/radiodivinessl/live", "logo": "🎧"},
    {"name": "181 FM The Buzz", "subtitle": "https://www.181.fm", "website": "https://www.181.fm", "url": "http://listen.181fm.com/181-buzz_128k.mp3", "logo": "📻"},
]

def get_config_version():
    mtimes = []
    for path in (CONFIG_FILE, STATIONS_FILE):
        try:
            mtimes.append(os.path.getmtime(path))
        except FileNotFoundError:
            pass
    return int((max(mtimes) if mtimes else time.time()) * 1000)

def station_logo(name):
    name_lower = (name or "").lower()
    if "voix" in name_lower or "divine" in name_lower:
        return "🎧"
    if "fm" in name_lower or "radio" in name_lower:
        return "📻"
    if "buzz" in name_lower:
        return "🎵"
    return "🎧"


def load_station_store():
    default = {"pending_stations": [], "custom_stations": []}
    if os.path.exists(STATIONS_FILE):
        try:
            with open(STATIONS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                data = {"pending_stations": [], "custom_stations": data}
            if not isinstance(data, dict):
                data = default
            data.setdefault("pending_stations", [])
            data.setdefault("custom_stations", [])
            return data
        except Exception as e:
            print("Station store load failed:", e)
            return default
    try:
        cfg = load_config()
        default["pending_stations"] = cfg.get("pending_stations", []) or []
        default["custom_stations"] = cfg.get("custom_stations", []) or []
    except Exception:
        pass
    save_station_store(default)
    return default


def save_station_store(data):
    data.setdefault("pending_stations", [])
    data.setdefault("custom_stations", [])
    tmp = STATIONS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, STATIONS_FILE)


def load_reports():
    if os.path.exists(REPORTS_FILE):
        try:
            with open(REPORTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except Exception as e:
            print("Reports load failed:", e)
    return []


def save_reports(reports):
    tmp = REPORTS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(reports, f, indent=2)
    os.replace(tmp, REPORTS_FILE)


def find_custom_station_index(custom, url="", name=""):
    url = (url or "").strip().lower()
    name = (name or "").strip().lower()
    for i, station in enumerate(custom):
        station_url = (station.get("url") or station.get("stream_url") or "").strip().lower()
        station_name = (station.get("name") or "").strip().lower()
        if url and station_url == url:
            return i
        if name and station_name == name:
            return i
    return -1


def normalize_station(station):
    language = (station.get("language") or "ht").strip().lower()
    flags = {"en": "🇺🇸", "es": "🇪🇸", "ht": "🇭🇹", "fr": "🇫🇷"}
    return {
        "name": (station.get("name") or "").strip(),
        "url": (station.get("url") or station.get("stream_url") or "").strip(),
        "subtitle": (station.get("subtitle") or station.get("website") or "Custom Station").strip(),
        "website": (station.get("website") or station.get("subtitle") or "").strip(),
        "logo": station.get("logo") or station_logo(station.get("name")),
        "language": language,
        "flag": station.get("flag") or flags.get(language, "🇭🇹"),
        "logo_url": station.get("logo_url", ""),
        "wallpaper": station.get("wallpaper", ""),
        "bio": (station.get("bio") or station.get("description") or "").strip(),
        "submitted_at": station.get("submitted_at"),
        "suspended": bool(station.get("suspended")),
        "suspended_at": station.get("suspended_at"),
        "suspend_reason": (station.get("suspend_reason") or "").strip(),
    }


def save_uploaded_image(field_name="wallpaper"):
    image = request.files.get(field_name) if request.files else None
    if not image or not image.filename:
        return "", ""
    if not allowed_image(image.filename):
        return "", "Image must be PNG, JPG, JPEG, GIF, or WEBP"
    safe = secure_filename(image.filename)
    filename = f"{int(time.time())}_{safe}"
    save_path = os.path.join(UPLOAD_FOLDER, filename)
    image.save(save_path)
    return f"/static/wallpapers/{filename}", ""

def get_remote_streams():
    try:
        # Avoid Render calling itself and timing out/recursing.
        try:
            if urlparse(SERVER_STATIONS_API).hostname == request.host.split(":")[0]:
                return []
        except RuntimeError:
            pass
        with urllib.request.urlopen(SERVER_STATIONS_API, timeout=5) as r:
            remote = json.loads(r.read().decode("utf-8"))
        streams = []
        for station in remote:
            name = (station.get("name") or "Unknown Station").strip()
            url = (station.get("stream_url") or station.get("url") or "").strip()
            website = (station.get("website") or "").strip()
            if name.lower() == "la voix divine" and not url:
                url = TEST_STREAMS[0]["url"]
                website = website or TEST_STREAMS[0]["website"]
            if url:
                streams.append({
                    "name": name,
                    "subtitle": website or station.get("subtitle") or "Internet Stream",
                    "website": website,
                    "url": url,
                    "logo": station.get("logo") or station_logo(name),
                    "language": station.get("language", "ht"),
                    "flag": station.get("flag", "🇭🇹"),
                    "logo_url": station.get("logo_url", ""),
                    "wallpaper": station.get("wallpaper", ""),
                    "bio": station.get("bio") or station.get("description") or "",
                })
        if streams:
            return streams
    except Exception as e:
        print("Remote stations unavailable:", e)
    return []

def get_all_streams():
    # First try your public approval server.
    remote = get_remote_streams()
    streams = remote if remote else []

    # Always keep La Voix Divine available as the protected main station.
    has_main = any((s.get("name", "").lower() == "la voix divine") for s in streams)
    if not has_main:
        streams.insert(0, TEST_STREAMS[0])

    # Add server-saved approved custom stations.
    try:
        store = load_station_store()
        for raw in store.get("custom_stations", []):
            station = normalize_station(raw)
            if station.get("name") and station.get("url") and not station.get("suspended"):
                streams.append(station)
    except Exception as e:
        print("Saved custom station load failed:", e)

    # Final fallback so the Library never shows empty.
    if not streams:
        streams = list(TEST_STREAMS)

    # Remove duplicates by URL/name.
    clean = []
    seen = set()
    for s in streams:
        if not s.get("flag"):
            language = (s.get("language") or "ht").strip().lower()
            s["flag"] = {"en": "🇺🇸", "es": "🇪🇸", "ht": "🇭🇹", "fr": "🇫🇷"}.get(language, "🇭🇹")
        if (s.get("name") or "").lower() == "la voix divine":
            s["flag"] = "🇭🇹"
            s["language"] = "ht"
            s["logo"] = s.get("logo") or "🇭🇹"
        key = (s.get("url") or s.get("name") or "").strip().lower()
        if key and key not in seen:
            seen.add(key)
            clean.append(s)
    return clean

def run_command(cmd: str) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)

def is_mfa_configured():
    return all([ADMIN_MFA_PHONE, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER])

def is_totp_configured():
    return bool(ADMIN_TOTP_SECRET)

def verify_admin_totp(code):
    if not is_totp_configured():
        return False
    try:
        return pyotp.TOTP(ADMIN_TOTP_SECRET).verify((code or "").strip().replace(" ", ""), valid_window=1)
    except Exception as e:
        print("Authenticator verification failed:", e, flush=True)
        return False

def send_admin_mfa_code(code):
    if not is_mfa_configured():
        return False, "Text verification is not configured on this server."

    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
    try:
        response = requests.post(
            url,
            data={
                "To": ADMIN_MFA_PHONE,
                "From": TWILIO_FROM_NUMBER,
                "Body": f"Your Radio Divine admin verification code is {code}. It expires in 5 minutes.",
            },
            auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
            timeout=10,
        )
        if response.status_code in (200, 201):
            return True, ""
        try:
            details = response.json()
        except Exception:
            details = response.text
        print("Twilio MFA send failed:", {
            "status_code": response.status_code,
            "to": ADMIN_MFA_PHONE,
            "from": TWILIO_FROM_NUMBER,
            "response": details,
        }, flush=True)
        return False, "Could not send the verification text. Check your SMS settings."
    except Exception as e:
        print("MFA text failed:", e, flush=True)
        return False, "Could not send the verification text. Try again."

def load_config():
    if not os.path.exists(CONFIG_FILE):
        default_config = {
            "station_name": "La Voix Divine",
            "stream_url": "https://icecast3.getstreamhosting.com/proxy/radiodivinessl/live",
            "volume": 80,
            "preset_index": 0,
            "custom_stations": [],
        }
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(default_config, f)
        return default_config

    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_config(config):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f)

def stop_player():
    global player_process
    if player_process and player_process.poll() is None:
        try:
            player_process.kill()
            player_process.wait(timeout=0.5)
        except Exception:
            try:
                player_process.kill()
            except Exception:
                pass
    player_process = None
    current_playing["is_playing"] = False



def has_network_connection(timeout=2):
    try:
        subprocess.run(["ping", "-c", "1", "-W", str(timeout), "8.8.8.8"], capture_output=True, text=True, check=True)
        return True
    except Exception:
        return False

def can_reach_stream(stream_url, timeout=4):
    try:
        parsed = urlparse(stream_url)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        if not host:
            return False
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False

def get_wifi_status_data():
    ssid = os.popen("iwgetid -r").read().strip()
    ip = os.popen("hostname -I").read().strip().split()
    return {
        "connected": bool(ssid),
        "ssid": ssid if ssid else "Not connected",
        "ip": ip[0] if ip else "No IP",
    }

def get_add_station_url():
    host = (request.host or "").split(":", 1)[0].lower()
    if host in ("127.0.0.1", "localhost", "0.0.0.0", ""):
        wifi = get_wifi_status_data()
        ip = wifi.get("ip", "")
        if ip and ip != "No IP":
            return f"http://{ip}:5000/add-station"
    return request.host_url.rstrip("/") + "/add-station"

def text_from_xml(node, name):
    child = node.find(name)
    return (child.text or "").strip() if child is not None else ""

def image_from_rss_item(item):
    namespaces = {
        "media": "http://search.yahoo.com/mrss/",
        "content": "http://purl.org/rss/1.0/modules/content/",
    }
    media = item.find("media:content", namespaces) or item.find("media:thumbnail", namespaces)
    if media is not None and media.get("url"):
        return media.get("url")
    enclosure = item.find("enclosure")
    if enclosure is not None and enclosure.get("url") and "image" in (enclosure.get("type") or ""):
        return enclosure.get("url")
    for field in ("description", "content:encoded"):
        html = text_from_xml(item, field) if ":" not in field else ""
        if field == "content:encoded":
            child = item.find(field, namespaces)
            html = (child.text or "").strip() if child is not None else ""
        match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', html or "", re.I)
        if match:
            return match.group(1)
    return ""

def clean_news_text(value):
    value = re.sub(r"<[^>]+>", " ", value or "")
    value = unescape(value)
    return re.sub(r"\s+", " ", value).strip()

def fetch_url(url):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "RadioLaVoixDivine/1.0 (+https://radiolavoixdivine.com)"},
    )
    with urllib.request.urlopen(req, timeout=8) as response:
        return response.read().decode("utf-8", errors="ignore")

def get_rss_items(source_name, rss_url, limit=1):
    try:
        raw = fetch_url(rss_url)
        root = ET.fromstring(raw.encode("utf-8"))
        items = []
        for item in root.findall("./channel/item")[:limit]:
            title = clean_news_text(text_from_xml(item, "title"))
            link = text_from_xml(item, "link")
            published = text_from_xml(item, "pubDate")
            image = image_from_rss_item(item)
            if title:
                items.append({"source": source_name, "title": title, "link": link, "published": published, "image": image})
        return items
    except Exception as e:
        print(f"{source_name} RSS unavailable:", e)
        return []

def get_homepage_items(source_name, home_url, limit=1):
    try:
        html = fetch_url(home_url)
        article_matches = re.findall(r"<article[\s\S]*?</article>", html, re.I) or [html]
        items = []
        seen = set()
        for block in article_matches:
            link_match = re.search(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>', block, re.I)
            title_match = re.search(r"<h[1-4][^>]*>([\s\S]*?)</h[1-4]>", block, re.I)
            image_match = re.search(r'<img[^>]+(?:src|data-src|data-lazy-src)=["\']([^"\']+)["\']', block, re.I)
            link = urljoin(home_url, link_match.group(1)) if link_match else home_url
            title = clean_news_text(title_match.group(1) if title_match else (link_match.group(2) if link_match else ""))
            image = urljoin(home_url, image_match.group(1)) if image_match else ""
            if title and link not in seen and len(title) > 12:
                seen.add(link)
                items.append({"source": source_name, "title": title, "link": link, "published": "", "image": image})
                if len(items) >= limit:
                    break
        return items
    except Exception as e:
        print(f"{source_name} homepage unavailable:", e)
        return []

def get_haitian_times_items():
    now = time.time()
    if news_cache["items"] and now - news_cache["fetched_at"] < NEWS_CACHE_TTL_SECONDS:
        return news_cache["items"]
    try:
        candidates = []
        candidates.extend(get_rss_items("HAITIAN TIMES", HAITIAN_TIMES_RSS_URL, 10))
        candidates.extend(get_rss_items("HAITILIBRE", HAITILIBRE_RSS_URL, 5))
        candidates.extend(get_homepage_items("LE NOUVELLISTE", LE_NOUVELLISTE_URL, 5))
        items = [item for item in candidates if item.get("image")][:8]
        news_cache["items"] = items
        news_cache["fetched_at"] = now
        return items
    except Exception as e:
        print("News feeds unavailable:", e)
        return news_cache["items"]

def get_saved_wifi_networks():
    result = run_command("nmcli -t -f NAME,TYPE connection show")
    networks = []
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            parts = line.split(":")
            if len(parts) >= 2 and parts[-1] == "802-11-wireless":
                name = ":".join(parts[:-1]).strip()
                if name and name not in networks:
                    networks.append(name)
    return networks

def get_connected_bluetooth_devices():
    connected = run_command("bluetoothctl devices Connected")
    devices = []
    if connected.returncode == 0:
        for line in connected.stdout.splitlines():
            parts = line.split(maxsplit=2)
            if len(parts) >= 3 and parts[0] == 'Device':
                devices.append({"mac": parts[1], "name": parts[2]})
    return devices


def get_bluetooth_status_data():
    powered = os.popen("bluetoothctl show | grep 'Powered:'").read().strip().lower()
    discoverable = os.popen("bluetoothctl show | grep 'Discoverable:'").read().strip().lower()
    name = os.popen("bluetoothctl show | grep 'Name:'").read().strip()
    connected_devices = get_connected_bluetooth_devices()
    return {
        "powered": "yes" in powered,
        "discoverable": "yes" in discoverable,
        "name": name.split("Name:", 1)[1].strip() if "Name:" in name else "radio",
        "connected_devices": connected_devices,
        "connected_device_name": connected_devices[0]["name"] if connected_devices else "",
    }

def switch_bluetooth_audio():
    sink_list = run_command("pactl list short sinks")
    if sink_list.returncode != 0:
        return {"status": "error", "message": "PulseAudio/PipeWire sink list unavailable"}

    bluez_sink = None
    for line in sink_list.stdout.splitlines():
        if "bluez_output" in line:
            bluez_sink = line.split()[1]
            break

    if not bluez_sink:
        return {"status": "error", "message": "No Bluetooth audio sink found"}

    run_command(f"pactl set-default-sink {shlex.quote(bluez_sink)}")

    sink_inputs = run_command("pactl list short sink-inputs")
    if sink_inputs.returncode == 0:
        for line in sink_inputs.stdout.splitlines():
            input_id = line.split()[0]
            run_command(f"pactl move-sink-input {shlex.quote(input_id)} {shlex.quote(bluez_sink)}")

    return {"status": "ok", "sink": bluez_sink}

def build_state():
    config = load_config()
    presets = get_all_streams()
    if not presets:
        presets = list(TEST_STREAMS)

    preset_index = int(config.get("preset_index", 0) or 0)
    if preset_index < 0 or preset_index >= len(presets):
        preset_index = 0

    current = presets[preset_index]
    return {
        "version": get_config_version(),
        "station_name": current.get("name", "La Voix Divine"),
        "station_website": current.get("website", ""),
        "stream_url": current.get("url", "https://icecast3.getstreamhosting.com/proxy/radiodivinessl/live"),
        "volume": config.get("volume", 80),
        "preset_index": preset_index,
        "custom_stations": config.get("custom_stations", []),
        "presets": presets,
        "playing": current_playing,
    }



@app.before_request
def require_admin_login():
    if request.path.startswith('/admin') and request.endpoint not in ('admin_login', 'admin_logout'):
        if not session.get('admin_logged_in'):
            return redirect(url_for('admin_login', next=request.path))

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    error = ''
    step = request.args.get('step') or 'password'
    if request.method == 'POST':
        action = (request.form.get('action') or 'password').strip()
        if action == 'verify':
            code = (request.form.get('code') or '').strip()
            if not session.get('admin_password_ok'):
                error = 'Please enter your password first.'
                return render_template('admin_login.html', error=error, step='password')
            attempts = int(session.get('admin_totp_attempts') or 0)
            if attempts >= 5:
                error = 'Too many attempts. Please log in again.'
                session.pop('admin_password_ok', None)
                session.pop('admin_totp_attempts', None)
                return render_template('admin_login.html', error=error, step='password')
            if verify_admin_totp(code):
                session.pop('admin_password_ok', None)
                session.pop('admin_totp_attempts', None)
                session['admin_logged_in'] = True
                return redirect(session.pop('admin_next', None) or '/admin/pending')
            session['admin_totp_attempts'] = attempts + 1
            error = 'Wrong authenticator code'
            return render_template('admin_login.html', error=error, step='verify')

        password = (request.form.get('password') or '').strip()
        if password == ADMIN_PASSWORD:
            session['admin_next'] = request.args.get('next') or '/admin/pending'
            if is_totp_configured():
                session['admin_password_ok'] = True
                session['admin_totp_attempts'] = 0
                return render_template('admin_login.html', error='', step='verify')
            session['admin_logged_in'] = True
            return redirect(session.pop('admin_next', None) or '/admin/pending')
        error = 'Wrong password'
    return render_template('admin_login.html', error=error, step=step)

@app.route('/admin/logout')
def admin_logout():
    session.pop('admin_logged_in', None)
    return redirect('/admin/login')

@app.route("/api/stations", methods=["GET"])
def local_stations():
    return jsonify(get_all_streams())

@app.route("/api/haitian-times", methods=["GET"])
def haitian_times_news():
    return jsonify({"status": "ok", "items": get_haitian_times_items()})


@app.route("/qr")
def qr_image():
    data = get_add_station_url()
    return redirect("https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=" + quote(data, safe=""))

@app.route("/")
def index():
    return render_template("index.html", public_web=is_public_website())

@app.route("/api/state", methods=["GET"])
def get_state():
    return jsonify(build_state())

@app.route("/api/config", methods=["GET"])
def get_config():
    return jsonify(build_state())

@app.route("/api/play-stream", methods=["POST"])
def play_stream():
    global player_process
    if is_public_website():
        data = request.get_json(silent=True) or {}
        return jsonify({"status":"browser", "url": data.get("url") or MAIN_STREAM_URL})

    config = load_config()
    data = request.get_json(silent=True) or {}
    stream_url = data.get("url") or config.get("stream_url")
    station_name = data.get("name") or config.get("station_name", "La Voix Divine")
    station_subtitle = data.get("subtitle") or "Internet Stream"
    station_website = data.get("website") or ""
    station_logo_value = data.get("logo") or station_logo(station_name)

    if not stream_url:
        return jsonify({"status": "error", "message": "No stream URL provided"}), 400

    try:
        stop_player()

        mpv_cmd = [
            "mpv",
            "--no-video",
            "--volume=100",
            "--cache=yes",
            "--cache-secs=2",
            "--demuxer-readahead-secs=1",
            "--network-timeout=5",
            stream_url,
        ]
        sink_check = run_command("pactl list short sinks")
        if sink_check.returncode == 0 and "bluez_output" in sink_check.stdout:
            mpv_cmd.insert(1, "--audio-device=pulse")
        else:
            mpv_cmd.insert(1, "--audio-device=alsa/plughw:wm8960soundcard")

        player_process = subprocess.Popen(
            mpv_cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        current_playing["is_playing"] = True
        current_playing["station_name"] = station_name
        current_playing["station_subtitle"] = station_subtitle
        current_playing["stream_url"] = stream_url
        current_playing["website"] = station_website
        current_playing["logo"] = station_logo_value

        return jsonify({"status": "playing", "url": stream_url})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/stop-stream", methods=["POST"])
def stop_stream():
    try:
        stop_player()
        return jsonify({"status": "stopped"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/volume', methods=['POST'])
def set_volume():
    data = request.get_json(silent=True) or {}
    volume = int(data.get('volume', 80))
    volume = max(0, min(100, volume))

    config = load_config()
    config['volume'] = volume
    save_config(config)

    os.system(f"amixer -c wm8960soundcard set Speaker {volume}% >/dev/null 2>&1")
    os.system(f"amixer -c wm8960soundcard set Playback {volume}% >/dev/null 2>&1")

    return jsonify({"status": "ok", "volume": volume})

@app.route('/api/wifi-status', methods=['GET'])
def wifi_status():
    try:
        data = get_wifi_status_data()
        data["saved_networks"] = get_saved_wifi_networks()
        return jsonify(data)
    except Exception as e:
        return jsonify({"connected": False, "ssid": "Error", "ip": str(e)}), 500

@app.route('/api/wifi-saved', methods=['GET'])
def wifi_saved():
    return jsonify({"networks": get_saved_wifi_networks()})

@app.route('/api/bluetooth-status', methods=['GET'])
def bluetooth_status():
    try:
        return jsonify(get_bluetooth_status_data())
    except Exception as e:
        return jsonify({"powered": False, "discoverable": False, "error": str(e)}), 500

@app.route('/api/bluetooth-power', methods=['POST'])
def bluetooth_power():
    data = request.get_json(silent=True) or {}
    enable = bool(data.get('enable', True))
    command = 'on' if enable else 'off'
    result = run_command(f"sudo bluetoothctl power {command}")
    if result.returncode == 0:
        if enable:
            run_command("sudo bluetoothctl discoverable on")
            run_command("sudo rfkill unblock bluetooth")
        return jsonify({"status": "ok", "enabled": enable})
    return jsonify({"status": "error", "message": (result.stderr or result.stdout).strip()}), 500

@app.route('/api/bluetooth-scan', methods=['GET'])
def bluetooth_scan():
    try:
        run_command("sudo rfkill unblock bluetooth")
        run_command("sudo bluetoothctl power on")
        run_command("sudo bluetoothctl discoverable on")
        run_command("timeout 8s bluetoothctl scan on >/dev/null 2>&1")
        devices = run_command("bluetoothctl devices")
        paired = run_command("bluetoothctl paired-devices")
        paired_macs = set()
        for line in paired.stdout.splitlines():
            parts = line.split(maxsplit=2)
            if len(parts) >= 2:
                paired_macs.add(parts[1])

        connected_macs = {d["mac"] for d in get_connected_bluetooth_devices()}
        results = []
        for line in devices.stdout.splitlines():
            parts = line.split(maxsplit=2)
            if len(parts) >= 3 and parts[0] == 'Device':
                name = parts[2].strip() or parts[1]
                if name.lower() in {"unknown", "n/a"}:
                    name = parts[1]
                results.append({
                    "mac": parts[1],
                    "name": name,
                    "paired": parts[1] in paired_macs,
                    "connected": parts[1] in connected_macs,
                })

        results.sort(key=lambda d: (not d["connected"], not d["paired"], d["name"].lower()))
        return jsonify({"devices": results})
    except Exception as e:
        return jsonify({"devices": [], "error": str(e)}), 500

@app.route('/api/bluetooth-connect', methods=['POST'])
def bluetooth_connect():
    try:
        data = request.get_json(silent=True) or {}
        mac = (data.get('mac') or '').strip()
        if not mac:
            return jsonify({"status": "error", "message": "Device MAC is required"}), 400

        run_command("sudo rfkill unblock bluetooth")
        run_command("sudo bluetoothctl power on")
        run_command("sudo bluetoothctl discoverable on")
        pair_result = run_command(f"bluetoothctl pair {shlex.quote(mac)}")
        trust_result = run_command(f"bluetoothctl trust {shlex.quote(mac)}")
        connect_result = run_command(f"bluetoothctl connect {shlex.quote(mac)}")

        switch_result = switch_bluetooth_audio()

        success = connect_result.returncode == 0 or 'Connection successful' in connect_result.stdout
        if success:
            try:
                with open("/home/pi/.last_bluetooth_device", "w", encoding="utf-8") as f:
                    f.write(mac)
            except Exception:
                pass

            if current_playing.get("is_playing") and current_playing.get("stream_url"):
                stop_player()
                time.sleep(1)
                config = load_config()
                config["stream_url"] = current_playing.get("stream_url")
                config["station_name"] = current_playing.get("station_name", config.get("station_name", "La Voix Divine"))
                save_config(config)
                play_stream()
            return jsonify({
                "status": "connected",
                "message": connect_result.stdout.strip() or "Connected",
                "audio": switch_result,
                "pair": pair_result.stdout.strip(),
                "trust": trust_result.stdout.strip(),
                "device_name": mac,
            })

        return jsonify({
            "status": "error",
            "message": (connect_result.stderr or connect_result.stdout or pair_result.stderr or pair_result.stdout or 'Connection failed').strip(),
            "audio": switch_result,
        }), 500
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/wifi-connect', methods=['POST'])
def wifi_connect():
    try:
        data = request.get_json(silent=True) or {}
        ssid = (data.get('ssid') or '').strip()
        password = (data.get('password') or '').strip()

        if not ssid:
            return jsonify({"status": "error", "message": "SSID is required"}), 400

        # First try the standard nmcli connect path.
        simple_cmd = ["sudo", "nmcli", "dev", "wifi", "connect", ssid, "ifname", "wlan0"]
        if password:
            simple_cmd.extend(["password", password])
        result = subprocess.run(simple_cmd, capture_output=True, text=True)

        if result.returncode != 0 and password:
            # Fallback path for routers that complain about missing key-mgmt.
            con_name = ssid
            subprocess.run(["sudo", "nmcli", "connection", "delete", con_name], capture_output=True, text=True)
            subprocess.run(["sudo", "nmcli", "connection", "add", "type", "wifi", "ifname", "wlan0", "con-name", con_name, "ssid", ssid], capture_output=True, text=True)
            subprocess.run(["sudo", "nmcli", "connection", "modify", con_name, "802-11-wireless-security.key-mgmt", "wpa-psk"], capture_output=True, text=True)
            subprocess.run(["sudo", "nmcli", "connection", "modify", con_name, "802-11-wireless-security.psk", password], capture_output=True, text=True)
            result = subprocess.run(["sudo", "nmcli", "connection", "up", con_name], capture_output=True, text=True)

        if result.returncode == 0:
            return jsonify({"status": "connected", "ssid": ssid, "message": result.stdout.strip() or "Connected"})

        return jsonify({
            "status": "error",
            "ssid": ssid,
            "message": (result.stderr or result.stdout or 'Connection failed').strip()
        }), 500
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/wifi-scan', methods=['GET']) 
def wifi_scan():
    try:
        # Prefer nmcli because it returns cleaner names and works with NetworkManager.
        run_command("sudo nmcli dev wifi rescan ifname wlan0 >/dev/null 2>&1")
        result = run_command("nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list ifname wlan0")
        networks = []
        seen = set()
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                parts = line.split(":")
                if not parts:
                    continue
                ssid = parts[0].strip()
                signal = parts[1].strip() if len(parts) > 1 else ""
                security = ":".join(parts[2:]).strip() if len(parts) > 2 else ""
                if ssid and ssid not in seen:
                    seen.add(ssid)
                    networks.append({"ssid": ssid, "signal": signal, "security": security})
        if not networks:
            output = os.popen("sudo iwlist wlan0 scanning 2>/dev/null | grep 'ESSID'").read()
            for line in output.splitlines():
                if 'ESSID' in line:
                    name = line.split(':', 1)[1].replace('"', '').strip()
                    if name and name not in seen:
                        seen.add(name)
                        networks.append({"ssid": name, "signal": "", "security": ""})
        return jsonify({"networks": networks})
    except Exception as e:
        return jsonify({"networks": [], "error": str(e)}), 500



@app.route('/api/network-status', methods=['GET'])
def network_status():
    stream_ok = False
    if current_playing.get("is_playing") and current_playing.get("stream_url"):
        stream_ok = can_reach_stream(current_playing.get("stream_url")) and has_network_connection()
    return jsonify({
        "connected": has_network_connection(),
        "playing": bool(current_playing.get("is_playing")) and stream_ok,
        "requested_playing": bool(current_playing.get("is_playing"))
    })

@app.route('/add-station', methods=['GET'])
@app.route('/add_station', methods=['GET'])
@app.route('/add', methods=['GET'])
def add_station_page():
    wifi = get_wifi_status_data()
    add_url = get_add_station_url()
    return render_template('add_station.html', add_url=add_url, ssid=wifi.get("ssid", ""))

@app.route('/api/add-station', methods=['POST'])
def api_add_station():
    is_json = request.is_json
    data = request.get_json(silent=True) if is_json else request.form
    data = data or {}
    name = (data.get('name') or '').strip()
    url = (data.get('url') or '').strip()
    subtitle = (data.get('subtitle') or 'Custom Station').strip()
    website = (data.get('website') or subtitle).strip()
    bio = (data.get('bio') or '').strip()[:250]
    language = (data.get('language') or 'ht').strip().lower()
    flags = {"en": "🇺🇸", "es": "🇪🇸", "ht": "🇭🇹", "fr": "🇫🇷"}
    if language not in flags:
        language = "ht"
    flag = flags[language]
    image_path = ""
    if not is_json:
        image_path, image_error = save_uploaded_image('wallpaper')
        if image_error:
            wifi = get_wifi_status_data()
            return render_template('add_station.html', status='error', message=image_error, add_url=get_add_station_url(), ssid=wifi.get('ssid',''), form={"name":name,"url":url,"subtitle":subtitle,"bio":bio,"language":language}), 400
    if not name or not url:
        message = "Station name and stream URL are required"
        if is_json:
            return jsonify({"status": "error", "message": message}), 400
        wifi = get_wifi_status_data()
        return render_template('add_station.html', status='error', message=message, add_url=get_add_station_url(), ssid=wifi.get('ssid',''), form={"name":name,"url":url,"subtitle":subtitle,"bio":bio,"language":language}), 400
    store = load_station_store()
    pending = store.get('pending_stations', [])
    station = normalize_station({"name": name, "url": url, "subtitle": subtitle, "website": website, "bio": bio, "language": language, "flag": flag, "wallpaper": image_path, "logo_url": image_path, "submitted_at": int(time.time())})
    for i, item in enumerate(pending):
        if (item.get('url') or '').strip() == url:
            pending[i] = station
            break
    else:
        pending.append(station)
    store['pending_stations'] = pending
    save_station_store(store)
    message = "Station submitted. Waiting for approval."
    if is_json:
        return jsonify({"status": "ok", "message": message, "pending_count": len(pending), "version": get_config_version()})
    wifi = get_wifi_status_data()
    return render_template('add_station.html', status='ok', message=message, add_url=get_add_station_url(), ssid=wifi.get('ssid',''), form={"name":"","url":"","subtitle":"Custom Station","bio":"","language":"ht"})

@app.route('/api/report-station', methods=['POST'])
def api_report_station():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    url = (data.get('url') or '').strip()
    reason = (data.get('reason') or 'Station issue').strip()[:300]
    if not name and not url:
        return jsonify({"status": "error", "message": "Station is required"}), 400
    reports = load_reports()
    reports.append({
        "name": name,
        "url": url,
        "website": (data.get('website') or '').strip(),
        "reason": reason,
        "reported_at": int(time.time()),
        "ip": request.headers.get("X-Forwarded-For", request.remote_addr),
    })
    save_reports(reports[-500:])
    return jsonify({"status": "ok", "message": "Report sent. Thank you."})

@app.route('/admin/pending', methods=['GET'])
def admin_pending():
    store = load_station_store()
    return render_template('pending.html', pending=store.get('pending_stations', []), approved=store.get('custom_stations', []))

@app.route('/admin/stations', methods=['GET'])
def admin_stations():
    return redirect('/admin/pending')

@app.route('/admin/reports', methods=['GET'])
def admin_reports():
    reports = list(reversed(load_reports()))
    store = load_station_store()
    approved = [normalize_station(s) for s in store.get('custom_stations', [])]
    return render_template('reports.html', reports=reports, approved=approved)

@app.route('/admin/suspend-station', methods=['POST'])
def admin_suspend_station():
    url = (request.form.get('url') or '').strip()
    name = (request.form.get('name') or '').strip()
    reason = (request.form.get('reason') or 'Suspended from report').strip()[:300]
    if name.lower() == 'la voix divine':
        return redirect('/admin/reports')
    store = load_station_store()
    custom = store.get('custom_stations', [])
    index = find_custom_station_index(custom, url=url, name=name)
    if index >= 0:
        station = normalize_station(custom[index])
        station['suspended'] = True
        station['suspended_at'] = int(time.time())
        station['suspend_reason'] = reason
        custom[index] = station
        store['custom_stations'] = custom
        save_station_store(store)
    return redirect('/admin/reports')

@app.route('/admin/restore/<int:index>', methods=['POST', 'GET'])
def admin_restore_station(index):
    store = load_station_store()
    custom = store.get('custom_stations', [])
    if 0 <= index < len(custom):
        station = normalize_station(custom[index])
        station['suspended'] = False
        station.pop('suspended_at', None)
        station.pop('suspend_reason', None)
        custom[index] = station
        store['custom_stations'] = custom
        save_station_store(store)
    return redirect('/admin/pending')

@app.route('/admin/approve/<int:index>', methods=['POST', 'GET'])
def admin_approve(index):
    store = load_station_store()
    pending = store.get('pending_stations', [])
    custom = store.get('custom_stations', [])
    if 0 <= index < len(pending):
        station = normalize_station(pending.pop(index))
        station.pop('submitted_at', None)
        for item in custom:
            if (item.get('url') or '').strip() == station.get('url'):
                item.update(station)
                break
        else:
            custom.append(station)
        store['pending_stations'] = pending
        store['custom_stations'] = custom
        save_station_store(store)
    return redirect('/admin/pending')

@app.route('/admin/reject/<int:index>', methods=['POST', 'GET'])
def admin_reject(index):
    store = load_station_store()
    pending = store.get('pending_stations', [])
    if 0 <= index < len(pending):
        pending.pop(index)
        store['pending_stations'] = pending
        save_station_store(store)
    return redirect('/admin/pending')

@app.route('/admin/delete/<int:index>', methods=['POST', 'GET'])
def admin_delete_station(index):
    store = load_station_store()
    custom = store.get('custom_stations', [])
    if 0 <= index < len(custom):
        custom.pop(index)
        store['custom_stations'] = custom
        save_station_store(store)
    return redirect('/admin/pending')

@app.route('/admin/edit/<int:index>', methods=['GET', 'POST'])
def admin_edit_station(index):
    store = load_station_store()
    custom = store.get('custom_stations', [])
    if index < 0 or index >= len(custom):
        return redirect('/admin/pending')
    station = normalize_station(custom[index])
    error = ''
    if request.method == 'POST':
        name = (request.form.get('name') or '').strip()
        url = (request.form.get('url') or '').strip()
        subtitle = (request.form.get('subtitle') or 'Custom Station').strip()
        website = (request.form.get('website') or subtitle).strip()
        bio = (request.form.get('bio') or '').strip()[:250]
        language = (request.form.get('language') or station.get('language') or 'ht').strip().lower()
        flags = {"en": "🇺🇸", "es": "🇪🇸", "ht": "🇭🇹", "fr": "🇫🇷"}
        if language not in flags:
            language = "ht"
        image_path, image_error = save_uploaded_image('wallpaper')
        if image_error:
            error = image_error
        elif not name or not url:
            error = 'Station name and stream URL are required'
        else:
            station.update({'name': name, 'url': url, 'subtitle': subtitle, 'website': website, 'bio': bio, 'language': language, 'flag': flags[language]})
            if image_path:
                station['wallpaper'] = image_path
                station['logo_url'] = image_path
            station['logo'] = station.get('logo') or station_logo(name)
            custom[index] = station
            store['custom_stations'] = custom
            save_station_store(store)
            return redirect('/admin/pending')
    return render_template('edit_station.html', station=station, index=index, error=error)

@app.route('/api/admin/stations', methods=['GET'])
def api_admin_stations():
    store = load_station_store()
    return jsonify({'status': 'ok', 'pending': store.get('pending_stations', []), 'approved': store.get('custom_stations', []), 'version': get_config_version()})

@app.route('/api/qr-link', methods=['GET'])
def qr_link():
    return jsonify({"status": "ok", "url": get_add_station_url()})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
