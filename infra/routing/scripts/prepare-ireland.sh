#!/usr/bin/env bash
# Downloads the Geofabrik extract for Ireland and Northern Ireland and builds the OSRM data set for one profile
# (OSRM_PROFILE: bicycle by default). Run once, and again to refresh the map (Geofabrik updates daily) or change profile.
#
#   cd infra/routing && cp .env.example .env && ./scripts/prepare-ireland.sh
#
# Steps (OSRM's documented MLD pipeline): osrm-extract (with the profile) -> osrm-partition -> osrm-customize.
# Result: data/ireland.osrm* used by `docker compose up`. Takes roughly 10-20 min and a few GB of RAM for Ireland.
#
# Vans: a second data set built with the car profile, in its own folder (the downloaded extract is shared):
#   OSRM_PROFILE=car OSRM_DATA_DIR=data-car ./scripts/prepare-ireland.sh
set -euo pipefail

cd "$(dirname "$0")/.."
# Values given on the command line win over .env (e.g. OSRM_PROFILE=car for the van map).
cli_profile="${OSRM_PROFILE:-}"; cli_dir="${OSRM_DATA_DIR:-}"
[ -f .env ] && set -a && . ./.env && set +a
[ -n "$cli_profile" ] && OSRM_PROFILE="$cli_profile"
[ -n "$cli_dir" ] && OSRM_DATA_DIR="$cli_dir"
OSRM_PROFILE="${OSRM_PROFILE:-bicycle}"
OSM_EXTRACT_URL="${OSM_EXTRACT_URL:-https://download.geofabrik.de/europe/ireland-and-northern-ireland-latest.osm.pbf}"
OSRM_IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v26.4.0}"
DATA="${OSRM_DATA_DIR:-data}"

case "$OSRM_PROFILE" in bicycle|car|foot) ;; *) echo "OSRM_PROFILE must be bicycle, car or foot" >&2; exit 1 ;; esac

mkdir -p data "$DATA"
# Another profile's folder reuses the extract already downloaded to data/ (a hard link: no extra disk).
if [ "$DATA" != data ] && [ ! -s "$DATA/ireland.osm.pbf" ] && [ -s data/ireland.osm.pbf ] && [ "${REFRESH:-0}" != "1" ]; then
  ln data/ireland.osm.pbf "$DATA/ireland.osm.pbf" 2>/dev/null || cp data/ireland.osm.pbf "$DATA/ireland.osm.pbf"
fi
if [ ! -s "$DATA/ireland.osm.pbf" ] || [ "${REFRESH:-0}" = "1" ]; then
  echo "Downloading $OSM_EXTRACT_URL"
  # -C - resumes an interrupted download.
  curl -fL -C - --retry 5 -o "$DATA/ireland.osm.pbf" "$OSM_EXTRACT_URL"
fi
# Geofabrik publishes an .md5 next to each extract.
if curl -fsSL "${OSM_EXTRACT_URL%.osm.pbf}.osm.pbf.md5" -o "$DATA/ireland.osm.pbf.md5" 2>/dev/null; then
  expected=$(cut -d' ' -f1 "$DATA/ireland.osm.pbf.md5")
  actual=$(md5sum "$DATA/ireland.osm.pbf" | cut -d' ' -f1)
  if [ "$expected" != "$actual" ]; then
    echo "Checksum differs from Geofabrik's latest (a newer extract may have been published); re-run with REFRESH=1 to download it again." >&2
  fi
fi

run() { docker run --rm -t -v "$PWD/$DATA:/data" "$OSRM_IMAGE" "$@"; }

# The profile's lua file ships in the image (/opt/<profile>.lua).
echo "osrm-extract ($OSRM_PROFILE)"
run osrm-extract -p "/opt/$OSRM_PROFILE.lua" /data/ireland.osm.pbf
echo "osrm-partition"
run osrm-partition /data/ireland.osrm
echo "osrm-customize"
run osrm-customize /data/ireland.osrm
echo "$OSRM_PROFILE" > "$DATA/PROFILE"
echo "Done: $DATA/ireland.osrm ($OSRM_PROFILE). Start with: docker compose up -d"
