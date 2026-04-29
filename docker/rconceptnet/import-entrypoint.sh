#!/bin/sh
set -e
# Kein Name „conceptnet.db“: Unter Docker Desktop kann das auf dem Host ein blockierender Ordner sein.
OUT=/data/conceptnet.sqlite
TMPDB=/tmp/conceptnet.db
GZ=/data/conceptnet-assertions-5.7.0.csv.gz

# Docker Desktop (Windows): SQLite kann auf manchen C:-Bind-Mounts keine neue DB anlegen (Fehler 14).
# Deshalb importieren wir nach /tmp und kopieren die Datei auf den Host.

if [ ! -f "$GZ" ]; then
	echo "langdle: Assertions fehlen: $GZ (erwartet unter data/conceptnet/ auf dem Host)." >&2
	exit 1
fi

rm -f "$TMPDB"

/usr/local/bin/rconceptnet --db "$TMPDB" import --lang de "$GZ"

rm -rf "$OUT"
# cp meldet auf manchen Windows-Shares „File exists“ — dd überschreibt zuverlässiger.
dd if="$TMPDB" of="$OUT" bs=4M
sync 2>/dev/null || true
echo "langdle: SQLite geschrieben -> $OUT ($(wc -c < "$OUT") Bytes)." >&2
