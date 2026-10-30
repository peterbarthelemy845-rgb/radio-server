"""Bounded public HTTP reads with DNS results pinned through the connection."""
import ipaddress,socket,time
from urllib.parse import urlsplit,urljoin
import certifi,urllib3


class UnsafeAddress(ValueError):pass


def destination(url):
    parsed=urlsplit(url)
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password:
        raise UnsafeAddress('Use a public http:// or https:// stream address without a username or password.')
    try:
        host=parsed.hostname.encode('idna').decode('ascii');port=parsed.port or (443 if parsed.scheme=='https' else 80)
        addresses=socket.getaddrinfo(host,port,type=socket.SOCK_STREAM)
    except (ValueError,UnicodeError,socket.gaierror) as error:
        raise UnsafeAddress('The stream hostname could not be resolved.') from error
    ips=list(dict.fromkeys(row[4][0] for row in addresses))
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise UnsafeAddress('The stream must use a public internet address.')
    return parsed,host,port,ips


def fetch_public(url,max_bytes=65536,probe=False):
    deadline=time.monotonic()+15
    for _ in range(6):
        parsed,host,port,ips=destination(url)
        # No second DNS lookup: TLS still verifies the original hostname.
        options=dict(host=ips[0],port=port,timeout=urllib3.Timeout(connect=4,read=4),maxsize=1)
        pool=(urllib3.HTTPSConnectionPool(**options,server_hostname=host,assert_hostname=host,cert_reqs='CERT_REQUIRED',ca_certs=certifi.where()) if parsed.scheme=='https' else urllib3.HTTPConnectionPool(**options))
        response=None
        try:
            authority=('['+host+']' if ':' in host else host)+((':'+str(port)) if port not in (80 if parsed.scheme=='http' else 443,) else '')
            response=pool.urlopen('GET',(parsed.path or '/')+('?' + parsed.query if parsed.query else ''),headers={'Host':authority,'User-Agent':'RadioStationAvailability/1.0','Accept-Encoding':'identity','Icy-MetaData':'0'},redirect=False,retries=False,preload_content=False)
            if response.status in (301,302,303,307,308):
                location=response.headers.get('Location')
                if not location:raise ValueError('The stream returned an invalid redirect.')
                url=urljoin(url,location)
                if time.monotonic()>deadline:raise TimeoutError('Stream check timed out.')
                continue
            kind=response.headers.get('Content-Type','').split(';')[0].lower()
            limit=256 if probe and (kind.startswith('audio/') or kind in ('application/ogg','application/octet-stream')) else max_bytes
            body=bytearray()
            while len(body)<limit:
                chunk=response.read(min(4096,limit-len(body)),decode_content=False)
                if not chunk:break
                body.extend(chunk)
                if time.monotonic()>deadline:raise TimeoutError('Stream check timed out.')
            return response.status,kind,bytes(body),url
        finally:
            if response is not None:response.close()
            pool.close()
    raise ValueError('The stream has too many redirects.')
