"""Package the verified local Arduino source without private provisioning."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import zipfile

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[3]
SOURCE = WORKSPACE / "outputs/cloudflare-arduino/waveshare_radio"
VERSION = "2026.11.08.1"
PUBLIC = HERE / "public/assets/waveshare-radio.zip"
DOWNLOAD = WORKSPACE / "outputs/waveshare_radio-auto-station-updates.zip"

notes = (SOURCE / "BUILD-RESULT.txt").read_text(encoding="utf-8")
if VERSION not in notes or "Verified Arduino compile" not in notes:
    raise RuntimeError("Compile verification for this firmware release is missing.")

allowed = {".ino", ".h", ".cpp", ".c", ".md", ".txt", ".cjs", ".json"}
files = [path for path in sorted(SOURCE.rglob("*"))
         if path.is_file() and path.suffix.lower() in allowed
         and path.name not in {"cloudflare_provisioning.h", "SHA256.json"}
         and not any(part.startswith(".") for part in path.relative_to(SOURCE).parts)]
for path in files:
    if path.suffix.lower() in {".ino", ".h", ".cpp", ".c"}:
        text = path.read_text(encoding="utf-8")
        if any(value for value in re.findall(r'#define\s+RADIO_ENROLLMENT_TOKEN\s+"([^"]*)"', text)):
            raise RuntimeError("Private provisioning must stay outside the public source.")

manifest = {path.relative_to(SOURCE).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in files}
(SOURCE / "SHA256.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
with zipfile.ZipFile(PUBLIC, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, "waveshare_radio/" + path.relative_to(SOURCE).as_posix())
    archive.write(SOURCE / "SHA256.json", "waveshare_radio/SHA256.json")
with zipfile.ZipFile(PUBLIC) as archive:
    if archive.testzip() is not None:
        raise RuntimeError("The sketch archive failed its integrity check.")
    if any("provisioning" in name.lower() for name in archive.namelist()):
        raise RuntimeError("Private provisioning must not be distributed.")
    for name, expected in manifest.items():
        if hashlib.sha256(archive.read("waveshare_radio/" + name)).hexdigest() != expected:
            raise RuntimeError("The sketch source does not match its manifest.")
shutil.copy2(PUBLIC, DOWNLOAD)
(HERE / "public/assets/radio-release.json").write_text(
    json.dumps({"version": VERSION, "sketch_url": "/assets/waveshare-radio.zip"}, separators=(",", ":")) + "\n",
    encoding="utf-8")
print(json.dumps({"version": VERSION, "files": len(manifest) + 1,
                  "bytes": PUBLIC.stat().st_size, "download": str(DOWNLOAD)}))
