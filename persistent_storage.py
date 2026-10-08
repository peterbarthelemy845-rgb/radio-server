"""Runtime data paths; set RADIO_DATA_DIR to a mounted Render disk."""
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ['RADIO_DATA_DIR']).resolve() if os.environ.get('RADIO_DATA_DIR') else None

def data_path(relative):
    legacy = ROOT / relative
    if DATA is None:
        return str(legacy)
    target = DATA / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    # Seed once only. Later deployments must never overwrite live data.
    if not target.exists() and legacy.is_file():
        shutil.copy2(legacy, target)
    return str(target)

def data_directory(relative):
    legacy = ROOT / relative
    if DATA is None:
        return str(legacy)
    target = DATA / relative
    if not target.exists():
        if legacy.is_dir():
            shutil.copytree(legacy, target)
        else:
            target.mkdir(parents=True, exist_ok=True)
    return str(target)
