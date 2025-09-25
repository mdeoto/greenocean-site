#!/usr/bin/env bash
set -Eeuo pipefail

# ======= CONFIG =======
REPO_DIR="$HOME/proyectos/greenocean-site"
FTP_HOST="automaticas.smn.gov.ar"
FTP_SRC_DIR="/data/compartidos_shn/tmp"    # donde tu script deja los PNG
CYCLE="$(date -u +'%Y%m%d')_00Z"           # solo 00Z por ahora
DEST="$REPO_DIR/assets/$CYCLE"             # destino final en el repo

# mapeos (ajustá si cambia el nombre en el FTP)
SRC_ODT_PLATAFORMA="ODT_plataforma"
SRC_ODT_RIOPLATA="ODT_rioplata"
SRC_OLAS_ALT_DIR="OLAS_altura_direccion"
SRC_OLAS_PER_DIR="OLAS_periodo_direccion"

# staging temporal por ciclo (transaccional)
STAGE_ROOT="$REPO_DIR/tools/stage_ftp"
STAGE="${STAGE_ROOT}/${CYCLE}.tmp"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "[INFO] Ciclo: $CYCLE"
mkdir -p "$STAGE_ROOT"
rm -rf "$STAGE"
mkdir -p "$STAGE"

# ======= PRECHECK =======
if ! command -v lftp >/dev/null 2>&1; then
  echo "[ERROR] lftp no está instalado. Ejecutá: sudo apt-get install -y lftp"
  exit 1
fi

# ======= DESCARGA =======
echo "[INFO] Descargando FTP $FTP_HOST:$FTP_SRC_DIR -> $STAGE"
lftp "$FTP_HOST" <<EOF
set ftp:ssl-allow no
lcd $STAGE
cd $FTP_SRC_DIR
mirror -e --verbose .
bye
EOF

# ======= NORMALIZAR NOMBRES =======
normalize_dir() {
  local D="$1"
  [ -d "$D" ] || return 0
  shopt -s nullglob
  for f in "$D"/*.png; do
    base="$(basename "$f")"
    if [[ "$base" =~ ([0-9]{1,3})h\.png$ ]]; then
      h="${BASH_REMATCH[1]}"
      h3=$(printf "%03d" "$h")
      new="${D}/${h3}h.png"
      if [ "$f" != "$new" ]; then mv -v "$f" "$new"; fi
    elif [[ "$base" =~ ([0-9]{1,3})\.png$ ]]; then
      h="${BASH_REMATCH[1]}"
      h3=$(printf "%03d" "$h")
      mv -v "$f" "${D}/${h3}h.png"
    fi
  done
}

normalize_dir "$STAGE/$SRC_ODT_PLATAFORMA" || true
normalize_dir "$STAGE/$SRC_ODT_RIOPLATA" || true
normalize_dir "$STAGE/$SRC_OLAS_ALT_DIR" || true
normalize_dir "$STAGE/$SRC_OLAS_PER_DIR" || true

# ======= VALIDACIÓN: ¿hay PNGs? =======
PNG_COUNT=$(find "$STAGE" -type f -name '*h.png' | wc -l | tr -d ' ')
if [ "$PNG_COUNT" -eq 0 ]; then
  echo "[ERROR] No se encontraron PNGs normalizados (*h.png) en $STAGE. Aborto sin tocar assets/ ni comitear."
  exit 1
fi
echo "[INFO] PNGs detectados: $PNG_COUNT"

# ======= COPIA AL DESTINO (ahora sí) =======
rm -rf "$DEST"
mkdir -p \
  "$DEST/plataforma/storm_surge" \
  "$DEST/plataforma/wave_height_dir" \
  "$DEST/plataforma/wave_period_dir" \
  "$DEST/rio_de_la_plata/storm_surge"

rsync -av --delete --include='*h.png' --exclude='*' \
  "$STAGE/$SRC_ODT_PLATAFORMA/" "$DEST/plataforma/storm_surge/" || true

rsync -av --delete --include='*h.png' --exclude='*' \
  "$STAGE/$SRC_ODT_RIOPLATA/" "$DEST/rio_de_la_plata/storm_surge/" || true

rsync -av --delete --include='*h.png' --exclude='*' \
  "$STAGE/$SRC_OLAS_ALT_DIR/" "$DEST/plataforma/wave_height_dir/" || true

rsync -av --delete --include='*h.png' --exclude='*' \
  "$STAGE/$SRC_OLAS_PER_DIR/" "$DEST/plataforma/wave_period_dir/" || true

# ======= MANIFEST =======
python3 "$REPO_DIR/tools/make_manifest.py" "$REPO_DIR" "$CYCLE"

# Validar manifest (que tenga horas > 0)
HCOUNT=$(python3 - <<'PY'
import json,sys
m=json.load(open("manifest.json","r",encoding="utf-8"))
print(len(m.get("times_hours",[])))
PY
)
if [ "${HCOUNT}" -eq 0 ]; then
  echo "[ERROR] manifest.json quedó sin horas. Aborto commit."
  exit 1
fi

# ======= GIT PUBLISH (solo si hay cambios) =======
cd "$REPO_DIR"
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "publish: $CYCLE (00Z) desde FTP"
  git push
  echo "[OK] Publicado $CYCLE"
else
  echo "[INFO] No hay cambios para publicar."
fi

