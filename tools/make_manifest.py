#!/usr/bin/env python3
import sys, json, re
from pathlib import Path

repo = Path(sys.argv[1]).resolve()
assets_root = repo / "assets"

# Escanear ciclos disponibles (YYYYMMDD_00Z)
cycles = []
rx_cycle = re.compile(r"^\d{8}_00Z$")

for d in assets_root.iterdir():
    if d.is_dir() and rx_cycle.match(d.name):
        cycles.append(d.name)

cycles = sorted(cycles)  # ascendente (el último es el más nuevo)
latest = cycles[-1] if cycles else None

# Detectar horas del último ciclo
times = set()
if latest:
    for p in (assets_root / latest).rglob("*.png"):
        m = re.search(r"/(\d{3})h\.png$", str(p))
        if m:
            times.add(int(m.group(1)))

manifest = {
    "base_url": "assets",
    "latest_cycle": latest,
    "available_cycles": cycles,
    "regions": {
        "plataforma": "Plataforma",
        "rio_de_la_plata": "Río de la Plata"
    },
    "variables": {
        "storm_surge": "Storm surge",
        "wave_height_dir": "Altura de ola (SWH) + dirección",
        "wave_period_dir": "Período de ola + dirección"
    },
    "availability": {
        "storm_surge": ["plataforma", "rio_de_la_plata"],
        "wave_height_dir": ["plataforma"],
        "wave_period_dir": ["plataforma"]
    },
    "times_hours": sorted(times)
}

(repo / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(f"[OK] manifest.json actualizado — ciclos: {len(cycles)}, horas en latest: {len(times)}")
