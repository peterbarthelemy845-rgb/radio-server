import ipaddress
import re
import socket
from urllib.parse import urlparse, urljoin
import requests

def is_playlist(url):
    return urlparse(url).path.lower().endswith(('.pls', '.m3u'))

def validate_public_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Invalid stream address')
    addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError('Stream address must be public')

def parse_playlist(text, base):
    if '#EXT-X-' in text:
        return base  # HLS is a media playlist, not a station-list wrapper.
    entries = re.findall(r'^\s*File(\d+)\s*=\s*(.+?)\s*$', text, re.I | re.M)
    if entries:
        return urljoin(base, min(entries, key=lambda entry: int(entry[0]))[1])
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith(('#', '[')) and '=' not in line.split('?', 1)[0]:
            return urljoin(base, line)
    raise ValueError('Playlist contains no playable stream')

def resolve_playlist(url):
    if not is_playlist(url):
        return url
    seen = set()
    for _ in range(6):
        if url in seen:
            raise ValueError('Playlist redirects in a loop')
        seen.add(url)
        validate_public_url(url)
        with requests.get(url, timeout=(4, 6), stream=True, allow_redirects=False) as response:
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get('Location')
                if not location:
                    raise ValueError('Invalid playlist redirect')
                url = urljoin(url, location)
                continue
            response.raise_for_status()
            content_type = response.headers.get('Content-Type', '').split(';')[0].lower()
            if content_type in ('audio/mpeg', 'audio/aac', 'audio/aacp', 'audio/ogg'):
                return url
            body = bytearray()
            for chunk in response.iter_content(4096):
                body.extend(chunk)
                if len(body) > 65536:
                    raise ValueError('Playlist is too large')
            target = parse_playlist(body.decode('utf-8-sig', errors='replace'), url)
        validate_public_url(target)
        if target == url or not is_playlist(target):
            return target
        url = target
    raise ValueError('Too many playlist redirects')
