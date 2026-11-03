"""Make a separate, reversible Cloudflare test copy of the existing radio sketch."""
from pathlib import Path
import shutil
import re
workspace = Path(__file__).resolve().parents[4]
source = workspace / 'waveshare_radio'
target = workspace / 'work/cloudflare-radio/waveshare_radio'
target.mkdir(parents=True, exist_ok=True)
for item in source.iterdir():
    if item.is_file():
        shutil.copy2(item, target / item.name)
(target / 'service_config.h').write_text('''#pragma once
#define RADIO_SERVICE_ORIGIN "https://radio-locals-native.peterbarthelemy845.workers.dev"
#if __has_include("cloudflare_provisioning.h")
#include "cloudflare_provisioning.h"
#endif
#ifndef RADIO_ENROLLMENT_TOKEN
#define RADIO_ENROLLMENT_TOKEN ""
#endif
''', encoding='utf-8')
ino = target / 'waveshare_radio.ino'
text = ino.read_text(encoding='utf-8').replace('#include "website_ca.h"', '#include "website_ca.h"\n#include "service_config.h"')
text = text.replace('String endpoint="https://www.radiolavoixdivine.com/api/device/";', 'String endpoint=String(RADIO_SERVICE_ORIGIN)+"/api/device/";')
text = text.replace('"radio-stations"', '"cf-stations"')
ino.write_text(text, encoding='utf-8')
link = target / 'radio_link.h'
text = link.read_text(encoding='utf-8').replace('"radio-link"', '"cf-link"')
text = text.replace('String endpoint="https://www.radiolavoixdivine.com/api/radio/";', 'String endpoint=String(RADIO_SERVICE_ORIGIN)+"/api/radio/";')
marker = '  if(!http.begin(client,endpoint))break;'
enroll = '''  static bool enrolledThisBoot=false;
  if(job->mode==1 && !enrolledThisBoot && strlen(RADIO_ENROLLMENT_TOKEN)==64) {
   HTTPClient registration; registration.useHTTP10(true); registration.setConnectTimeout(4000); registration.setTimeout(4000);
   if(registration.begin(client,String(RADIO_SERVICE_ORIGIN)+"/api/radio/enroll")) {
    registration.addHeader("Content-Type","application/json");registration.addHeader("Authorization","Bearer "+job->secret);
    JsonDocument enrollment;enrollment["radio_id"]=job->id;enrollment["enrollment_token"]=RADIO_ENROLLMENT_TOKEN;
    String encoded;serializeJson(enrollment,encoded);int enrollmentStatus=registration.POST(encoded);
    enrolledThisBoot=enrollmentStatus==200;Serial.printf("Cloudflare enrollment HTTP %d\\n",enrollmentStatus);registration.end();
   }
  }
'''
if marker not in text:
    raise RuntimeError('Radio link source changed; enrollment insertion needs review.')
text = text.replace(marker, enroll + marker)
text = text.replace('status=http.POST(body);', 'status=http.POST(body);Serial.printf("Cloudflare link mode %d HTTP %d\\n",job->mode,status);')
link.write_text(text, encoding='utf-8')
art = target / 'station_art.h'
text = art.read_text(encoding='utf-8')
text = re.sub(r'String allowedArtUrl\(const String& url\) \{.*?\n\}', '''String allowedArtUrl(const String& url) {
  if(url.length()>512)return "";
  if(url=="/static/logos/radiolavoixdivine.png")return String(RADIO_SERVICE_ORIGIN)+"/assets/radiolavoixdivine.png";
  String path=url;
  if(path.startsWith(RADIO_SERVICE_ORIGIN))path=path.substring(strlen(RADIO_SERVICE_ORIGIN));
  if(path=="/assets/radiolavoixdivine.png")return String(RADIO_SERVICE_ORIGIN)+path;
  if(!path.startsWith("/artwork/")||path.length()!=77||!path.endsWith(".png"))return "";
  for(unsigned i=9;i<73;i++)if(!isxdigit((unsigned char)path[i]))return "";
  return String(RADIO_SERVICE_ORIGIN)+path;
}''', text, count=1, flags=re.S)
art.write_text(text, encoding='utf-8')
sponsors = target / 'radio_sponsors.h'
text = sponsors.read_text(encoding='utf-8').replace('String("https://www.radiolavoixdivine.com/api/radio/ad")', '(String(RADIO_SERVICE_ORIGIN)+"/api/radio/ad")').replace('"https://www.radiolavoixdivine.com"+path', 'String(RADIO_SERVICE_ORIGIN)+path')
sponsors.write_text(text, encoding='utf-8')
(target / 'CLOUDFLARE-TEST.txt').write_text('Staging build. Original sketch unchanged. Uses separate cf-link and cf-stations NVS namespaces. Wi-Fi and volume remain saved. Enrollment requires a private, short-lived factory token. Do not distribute that token. Ads are not yet enabled in this migration.\n', encoding='utf-8')
print(target)
