#!/usr/bin/env python3
import sys, json, re
from pathlib import Path

repo = Path(sys.argv[1]).resolve()
cycle = sys.argv[2]
assets = repo / "assets" / cycle

# Detectar horas (HHHh.png)
hours = set()
for p in assets.rglob("*.png"):
    m = re.search(r"/(\d{3})h\.png$", str(p))
    if m:
        hours.add(int(m.group(1)))
times_hours = sorted(hours)

manifest = {
    "base_url": "assets",
    "latest_cycle": cycle,
    "available_cycles": [cycle],
    "regions": {
        "plataforma": "Plataforma",
        "rio_de_la_plata": "Río de la Plata"
    },
    "variables": {
        "storm_surge": "Storm surge",
        "wave_height_dir": "Altura de ola (SWH) + dirección",
        "wave_period_dir": "Período de ola + dirección"
    },
    # Lo que hay/vale por variable:
    "availability": {
        "storm_surge": ["plataforma", "rio_de_la_plata"],
        "wave_height_dir": ["plataforma"],
        "wave_period_dir": ["plataforma"]
    },
    "times_hours": times_hours
}

(repo / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(f"[OK] manifest.json con {len(times_hours)} horas")
