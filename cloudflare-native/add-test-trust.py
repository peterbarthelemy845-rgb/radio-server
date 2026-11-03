from pathlib import Path
import re
import ssl
workspace = Path(__file__).resolve().parents[4]
base = workspace / 'work/cloudflare-radio'
original = (workspace / 'waveshare_radio/website_ca.h').read_text(encoding='utf-8')
roots = (base / 'google-roots.pem').read_text(encoding='utf-8')
selected = []
scratch = base / 'ca-inspect.pem'
for pem in re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', roots, re.S):
    scratch.write_text(pem, encoding='ascii')
    info = ssl._ssl._test_decode_cert(str(scratch))
    subject = dict(item for group in info['subject'] for item in group)
    if subject.get('commonName') in {'GTS Root R1', 'GTS Root R2', 'GTS Root R3', 'GTS Root R4', 'ISRG Root X1', 'ISRG Root X2'}:
        selected.append((subject['commonName'], pem))
if scratch.exists():
    scratch.unlink()
if not any(name == 'GTS Root R4' for name, _ in selected):
    raise RuntimeError('Required official GTS Root R4 was not found.')
new = original.replace(')CERT";', '\n' + '\n'.join(pem for _, pem in selected) + '\n)CERT";')
(base / 'waveshare_radio/website_ca.h').write_text(new, encoding='utf-8')
print('Verified HTTPS trust roots added:', ', '.join(name for name, _ in selected))
