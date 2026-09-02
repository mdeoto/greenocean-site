#!/usr/bin/env bash
set -Eeuo pipefail

# ======= CONFIG =======
REPO_DIR="$HOME/proyectos/greenocean-site"
LOCK_FILE="$REPO_DIR/.publish.lock"

# Git nunca debe intentar pedir credenciales interactivamente desde cron
export GIT_TERMINAL_PROMPT=0

# Evitar dos publicaciones simultáneas
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[ERROR] Ya existe otra publicación en ejecución."
  exit 1
fi

# FTP
FTP_HOST="automaticas.smn.gov.ar"
FTP_SRC_DIR="/data/compartidos_shn/tmp"   # donde tu pipeline deja los PNG
# Usa ~/.netrc con permisos 600. Si no, añadí -u 'user,pass' a lftp.

# Ciclo actual (siempre 00Z del día UTC)
CYCLE_DATE_UTC="${CYCLE_DATE_UTC:-$(date -u +'%Y%m%d')}"
CYCLE="${CYCLE_DATE_UTC}_00Z"

# Staging por ciclo (transaccional)
STAGE_ROOT="$REPO_DIR/tools/stage_ftp"
STAGE="${STAGE_ROOT}/${CYCLE}.tmp"
NORM="${STAGE}/normalized"

# Destino final
DEST="$REPO_DIR/assets/$CYCLE"

# Mapeos de origen (según estructura real en el FTP)
SRC_ODT_PLATAFORMA="ODT/plataforma"
SRC_ODT_RIOPLATA="ODT/rioplata"
SRC_OLAS_ALTURA="OLAS/altura"
SRC_OLAS_PERIODO="OLAS/periodo"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

require_bin() {
  command -v "$1" >/dev/null 2>&1 || { echo "[ERROR] Falta '$1' (instalalo con apt)."; exit 1; }
}

echo "[INFO] Ciclo actual: $CYCLE"

# ======= PRECHECK =======
require_bin lftp
require_bin rsync
require_bin python3
require_bin git
require_bin flock

mkdir -p "$STAGE_ROOT"
rm -rf "$STAGE"
mkdir -p "$STAGE"

# ======= PREFLIGHT GIT =======
echo "[INFO] Verificando estado Git antes de generar productos..."

cd "$REPO_DIR"

# El repositorio debe empezar completamente limpio.
# Si una publicación anterior dejó modificaciones pendientes,
# no generamos un ciclo nuevo.
if [ -n "$(git status --porcelain)" ]; then
  echo "[ERROR] El repositorio contiene cambios locales."
  echo "[ERROR] Se aborta ANTES de descargar productos."
  git status --short
  exit 1
fi

# Consultar el estado actual del remoto.
# Esto también evita trabajar si GitHub o la red no están disponibles.
if ! git fetch --quiet origin main; then
  echo "[ERROR] No fue posible consultar origin/main."
  echo "[ERROR] Se aborta ANTES de descargar productos."
  exit 1
fi

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"

# PROTECCIÓN PRINCIPAL:
# si el push anterior falló, HEAD local quedará adelantado.
# No permitimos generar un segundo commit.
if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
  echo "[ERROR] Repositorio local y GitHub no están sincronizados."
  echo "[ERROR] Posible publicación anterior fallida."
  echo "[ERROR] LOCAL : $LOCAL_HEAD"
  echo "[ERROR] REMOTO: $REMOTE_HEAD"
  echo "[ERROR] No se generará otro ciclo hasta resolverlo."
  exit 1
fi

# Verificar capacidad real de publicación.
# --dry-run no modifica el remoto.
if ! git push --dry-run --quiet origin HEAD:main; then
  echo "[ERROR] No fue posible validar permisos de escritura en GitHub."
  echo "[ERROR] Posible token vencido, credencial inválida o problema de red."
  echo "[ERROR] Se aborta ANTES de descargar productos."
  exit 1
fi
echo "[OK] Git local sincronizado y con acceso de escritura a GitHub."

# ======= DESCARGA DEL FTP =======
echo "[INFO] Descargando FTP $FTP_HOST:$FTP_SRC_DIR -> $STAGE"
lftp "$FTP_HOST" <<EOF
set ftp:ssl-allow no
lcd $STAGE
cd $FTP_SRC_DIR
mirror -e --verbose .
bye
EOF

# ======= NORMALIZACIÓN A HHHh.png =======
mkdir -p \
  "$NORM/plataforma/storm_surge" \
  "$NORM/rio_de_la_plata/storm_surge" \
  "$NORM/plataforma/wave_height_dir" \
  "$NORM/plataforma/wave_period_dir"

# Exporto variables para que el bloque Python las lea del entorno
export REPO_DIR STAGE NORM CYCLE_DATE_UTC
export SRC_ODT_PLATAFORMA SRC_ODT_RIOPLATA SRC_OLAS_ALTURA SRC_OLAS_PERIODO

python3 - <<'PY'
import os, re, shutil
from pathlib import Path
from datetime import datetime, timezone

repo = Path(os.environ['REPO_DIR'])
stage = Path(os.environ['STAGE'])
norm  = Path(os.environ['NORM'])

cycle_date_str = os.environ['CYCLE_DATE_UTC']  # YYYYMMDD (UTC)
t0 = datetime.strptime(cycle_date_str + " 00", "%Y%m%d %H").replace(tzinfo=timezone.utc)

MAP = [
    # Storm surge plataforma
    (stage / os.environ['SRC_ODT_PLATAFORMA'], norm / "plataforma" / "storm_surge"),
    # Storm surge Río de la Plata
    (stage / os.environ['SRC_ODT_RIOPLATA'],   norm / "rio_de_la_plata" / "storm_surge"),
    # Olas: altura + dirección
    (stage / os.environ['SRC_OLAS_ALTURA'],    norm / "plataforma" / "wave_height_dir"),
    # Olas: período + dirección
    (stage / os.environ['SRC_OLAS_PERIODO'],   norm / "plataforma" / "wave_period_dir"),
]

# Patrones esperados: ..._YYYYMMDD_HH.png (según tu FTP)
rx = re.compile(r".*_(\d{8})_(\d{2})\.png$", re.IGNORECASE)

copied = 0
for src_dir, dst_dir in MAP:
    if not src_dir.exists():
        continue
    dst_dir.mkdir(parents=True, exist_ok=True)
    for p in sorted(src_dir.glob("*.png")):
        m = rx.match(p.name)
        if not m:
            # fallback: buscar al final del nombre
            m2 = re.search(r"(\d{8})_(\d{2})\.png$", p.name)
            if not m2:
                continue
            date_str, hh = m2.group(1), m2.group(2)
        else:
            date_str, hh = m.group(1), m.group(2)

        try:
            t = datetime.strptime(f"{date_str} {hh}", "%Y%m%d %H").replace(tzinfo=timezone.utc)
        except Exception:
            continue

        dh = int(round((t - t0).total_seconds() / 3600))
        if dh < 0 or dh > 240:
            continue

        fname = f"{dh:03d}h.png"
        shutil.copy2(p, dst_dir / fname)
        copied += 1

print(f"[OK] Normalizados/copied: {copied}")
PY

PNG_COUNT=$(find "$NORM" -type f -name '*h.png' | wc -l | tr -d ' ')
if [ "$PNG_COUNT" -eq 0 ]; then
  echo "[ERROR] No se generaron PNGs normalizados en $NORM. Aborto sin tocar assets/ ni comitear."
  exit 1
fi
echo "[INFO] PNGs normalizados: $PNG_COUNT"

# ======= COPIAR AL DESTINO (idempotente) =======
rm -rf "$DEST"
mkdir -p "$DEST"
rsync -av --delete "$NORM/" "$DEST/"

# ======= RETENCIÓN: mantener los últimos 3 ciclos 00Z =======
RETENTION_CYCLES="${RETENTION_CYCLES:-3}"
echo "[INFO] Retención de ciclos: manteniendo últimos ${RETENTION_CYCLES}"
KEEP_DATES=()
for i in $(seq 0 $((RETENTION_CYCLES-1))); do
  KEEP_DATES+=( "$(date -u -d "${CYCLE_DATE_UTC} -${i} day" +'%Y%m%d')_00Z" )
done

cd "$REPO_DIR/assets"
for d in */ ; do
  d="${d%/}"
  case " ${KEEP_DATES[*]} " in
    *" $d "*) : ;;   # keep
    *) echo "[INFO] Eliminando ciclo viejo: $d"; rm -rf "$d" ;;
  esac
done

# ======= MANIFEST (multi-ciclo) =======
cd "$REPO_DIR"
python3 tools/make_manifest.py "$REPO_DIR"

# Validar manifest >0 horas en latest
HCOUNT=$(python3 - <<'PY'
import json
m=json.load(open("manifest.json","r",encoding="utf-8"))
print(len(m.get("times_hours",[])))
PY
)
if [ "${HCOUNT}" -eq 0 ]; then
  echo "[ERROR] manifest.json quedó sin horas. Aborto commit."
  exit 1
fi

# ======= CACHE-BUSTING (JS/CSS) =======
# Usamos el ciclo como versión; si querés incluir el hash de commit, descomentá VER_HASH.
VER="${CYCLE}"
# VER_HASH="$(git rev-parse --short HEAD 2>/dev/null || date -u +%H%M%S)"
# VER="${CYCLE}-${VER_HASH}"

# app.js
sed -i "s#app\.js?v=[^\"']*#app.js?v=${VER}#g" index.html
# styles.css (opcional: descomentá si tenés ?v en el link)
# sed -i "s#styles\.css?v=[^\"']*#styles.css?v=${VER}#g" index.html

# ======= GIT PUBLISH =======
if [ -n "$(git status --porcelain)" ]; then

  git add -A

  git commit -m \
    "publish: ${CYCLE} (00Z) desde FTP + retención ${RETENTION_CYCLES} ciclos + cache-busting ${VER}"

  echo "[INFO] Publicando ${CYCLE} en GitHub..."

  if git push origin main; then
    echo "[OK] Publicado correctamente ${CYCLE}"
  else
    echo "[ERROR] ================================================"
    echo "[ERROR] EL COMMIT SE GENERÓ PERO EL PUSH FALLÓ"
    echo "[ERROR] Ciclo: ${CYCLE}"
    echo "[ERROR]"
    echo "[ERROR] El repositorio queda con UN commit pendiente."
    echo "[ERROR] Las siguientes ejecuciones abortarán ANTES"
    echo "[ERROR] de descargar o generar nuevos productos."
    echo "[ERROR] ================================================"
    exit 1
  fi

else
  echo "[INFO] No hay cambios para publicar."
fi
