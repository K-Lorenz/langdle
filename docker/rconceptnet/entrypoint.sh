#!/bin/sh
set -e
DB="${CONCEPTNET_DB_PATH:-/data/conceptnet.sqlite}"
ADDR="${CONCEPTNET_LISTEN:-0.0.0.0:3043}"

if [ ! -f "$DB" ] || [ ! -s "$DB" ]; then
	echo "rconceptnet: keine gültige SQLite-Datei unter $DB — Import ausführen oder Datei mounten (README „Docker“)." >&2
	echo "rconceptnet: Container bleibt idle; App nutzt dann nur Fallback ohne lokales ConceptNet." >&2
	exec tail -f /dev/null
fi

exec rconceptnet --db "$DB" serve --addr "$ADDR"
