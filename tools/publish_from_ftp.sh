#!/usr/bin/env bash

# ======= CONFIG =======
REPO_DIR="$HOME/proyectos/greenocean-site"
FTP_HOST="automaticas.smn.gov.ar"
FTP_SRC_DIR="/data/compartidos_shn/tmp"    # donde tu script deja los PNG
CYCLE="$(date -u +'%Y%m%d')_00Z"           # solo 00Z por ahora
STAGE="$REPO_DIR/tools/stage_ftp"          # staging temporal
DEST="$REPO_DIR/assets/$CYCLE"             # destino final en el repo

# mapeos (NO toques si ya matchea tus folders del FTP)
SRC_ODT_PLATAFORMA="ODT_plataforma"
SRC_ODT_RIOPLATA="ODT_rioplata"
SRC_OLAS_ALT_DIR="OLAS_altura_direccion"
SRC_OLAS_PER_DIR="OLAS_periodo_direccion"

# ======= PRE =======
mkdir -p "$STAGE"
rm -rf "$STAGE"/*
mkdir -p "$DEST"
rm -rf "$DEST"
mkdir -p \
  "$DEST/plataforma/storm_surge" \
  "$DEST/plataforma/wave_height_dir" \
  "$DEST/plataforma/wave_period_dir" \
  "$DEST/rio_de_la_plata/storm_surge"

echo "[INFO] Descargando FTP $FTP_HOST:$FTP_SRC_DIR -> $STAGE"
# Requiere lftp y ~/.netrc configurado
lftp "$FTP_HOST" <<EOF
set ftp:ssl-allow no
lcd $STAGE
cd $FTP_SRC_DIR
mirror -e --verbose .
bye
EOF

# ======= NORMALIZAR NOMBRES =======
# Queremos nombres HHHh.png (ej: 000h.png, 003h.png)
# Si ya vienen así, no cambia nada. Si vienen como 0h.png, 3h.png, etc, normaliza.

normalize_dir() {
  local D="$1"
  [ -d "$D" ] || return 0
  shopt -s nullglob
  for f in "$D"/*.png; do
    base="$(basename "$f")"
    # Extraer número de horas (cualquier número antes de 'h' o '.png')
    if [[ "$base" =~ ([0-9]{1,3})h\.png$ ]]; then
      h="${BASH_REMATCH[1]}"
      h3=$(printf "%03d" "$h")
      new="${D}/${h3}h.png"
      if [ "$f" != "$new" ]; then
        mv -v "$f" "$new"
      fi
    elif [[ "$base" =~ ([0-9]{1,3})\.png$ ]]; then
      h="${BASH_REMATCH[1]}"
      h3=$(printf "%03d" "$h")
      new="${D}/${h3}h.png"
      mv -v "$f" "$new"
    fi
  done
}

# Normalizar en cada subcarpeta del STAGE si corresponde
normalize_dir "$STAGE/$SRC_ODT_PLATAFORMA"
normalize_dir "$STAGE/$SRC_ODT_RIOPLATA"
normalize_dir "$STAGE/$SRC_OLAS_ALT_DIR"
normalize_dir "$STAGE/$SRC_OLAS_PER_DIR"

# ======= COPIAR AL DESTINO =======
rsync -av --include='*h.png' --exclude='*' \
  "$STAGE/$SRC_ODT_PLATAFORMA/" "$DEST/plataforma/storm_surge/"

rsync -av --include='*h.png' --exclude='*' \
  "$STAGE/$SRC_ODT_RIOPLATA/" "$DEST/rio_de_la_plata/storm_surge/"

rsync -av --include='*h.png' --exclude='*' \
  "$STAGE/$SRC_OLAS_ALT_DIR/" "$DEST/plataforma/wave_height_dir/"

rsync -av --include='*h.png' --exclude='*' \
  "$STAGE/$SRC_OLAS_PER_DIR/" "$DEST/plataforma/wave_period_dir/"

# ======= MANIFEST =======
python3 "$REPO_DIR/tools/make_manifest.py" "$REPO_DIR" "$CYCLE"

# ======= GIT PUBLISH =======
cd "$REPO_DIR"
git add -A
git commit -m "publish: $CYCLE (00Z) desde FTP"
git push
echo "[OK] Publicado $CYCLE"
