# Langdle

Tägliches semantisches Wort-Rätsel (SvelteKit + Drizzle + PostgreSQL). Die Nutzerfläche und die öffentlichen Fehlermeldungen sind auf **Deutsch**.

## Stack

- Laufzeit-App/API: SvelteKit (`@sveltejs/adapter-node`)
- ORM: Drizzle
- Datenbank: PostgreSQL (lokal über `compose.yaml`)
- Optional: **Embeddings** — `npm run db:embeddings` (Python + sentence-transformers, siehe unten) für semantische Ähnlichkeit statt nur ConceptNet-Graph

## Lokale Entwicklung

1. Abhängigkeiten installieren:

```sh
npm install
```

2. `.env` anlegen (liegt in diesem Repo schon vor; sonst von `.env.example` kopieren):

```sh
copy .env.example .env
```

3. Postgres starten:

```sh
npm run db:start
```

4. Schema in die Datenbank schreiben:

```sh
npm run db:push
```

5. **Embeddings (empfohlen)** — entweder **Docker** (kein lokales Python nötig; Postgres muss laufen):

```sh
docker compose up -d db
npm run docker:embeddings
```

Oder **lokal:** `pip install -r scripts/embeddings/requirements.txt` (zieht PyTorch mit; wer nur CPU will: zuerst `pip install torch --index-url https://download.pytorch.org/whl/cpu`), dann mit gesetztem `DATABASE_URL`:

```sh
npm run db:embeddings
```

Der Compose-Dienst nutzt die Datenbank unter dem Hostnamen `db` im Stack; Hugging-Face-Modell-Cache liegt im Volume `hf_embedding_cache`. Standardmodell: `paraphrase-multilingual-MiniLM-L12-v2` (schnell). Für stärkere mehrsprachige Nähe (z. B. Übersetzungs-Paraphrasen): `EMBEDDING_MODEL=sentence-transformers/LaBSE npm run docker:embeddings` (bzw. dieselbe Variable beim lokalen `db:embeddings`).

**Laufzeit (grob):** Das Encoder-Batching ist oft einige Minuten bei ~300k Lemmata (CPU/GPU-abhängig). Das anschließende Schreiben in Postgres (ein `UPDATE` pro Zeile) kann **noch einmal etwa 5–30+ Minuten** dauern — SSD, Docker-Volume und Postgres helfen. Das Skript loggt Fortschritt und eine ETA beim DB-Schritt (`EMBEDDING_SAVE_PROGRESS_INTERVAL`, Standard 5000).

Der Seed (`npm run db:seed`) nutzt **automatisch** das Embedding-Gitter, wenn das Zielwort einen Vektor hat und mindestens `gridSize` Einträge mit Embedding existieren — sonst weiterhin ConceptNet (lokal oder API). Explizit nur ConceptNet: `PUZZLE_GRID_SOURCE=conceptnet`; nur Embedding (abbricht, wenn Daten fehlen): `PUZZLE_GRID_SOURCE=embedding`.

6. Entwicklungsserver:

```sh
npm run dev -- --open
```

### Lokales ConceptNet (rconceptnet)

Die öffentliche API `api.conceptnet.io` ist oft instabil. Optional kannst du [rconceptnet](https://github.com/knadh/rconceptnet) (Rust, SQLite) betreiben; die App liest die Variable **`RCONCEPTNET_URL`** (JSON-Server, z. B. `http://127.0.0.1:3043`).

Erwartete Dateien im Repo:

- Assertions: **`data/conceptnet/conceptnet-assertions-5.7.0.csv.gz`** ([Download](https://github.com/commonsense/conceptnet5/wiki/Downloads))
- Nach dem Import: **`data/conceptnet/conceptnet.sqlite`** (wird erzeugt; unter Docker nicht `conceptnet.db`, damit Windows keine Ordner-Kollision mit altem Pfad hat)

**Import mit Docker** (ohne lokales rconceptnet-Binary):

```sh
npm run docker:conceptnet:import
```

**Fehler beim Kopieren auf den Host (Windows):** Die SQLite-Datei heißt bei uns **`conceptnet.sqlite`** (nicht `conceptnet.db`). Import läuft intern über `/tmp`, Ausgabe per `dd` (nicht `cp`). Alte, leere Ordner `conceptnet.db` auf dem Host kannst du löschen.

**Import mit installiertem Binary** (im Projektroot):

```sh
rconceptnet --db data/conceptnet/conceptnet.sqlite import --lang de data/conceptnet/conceptnet-assertions-5.7.0.csv.gz
```

**Server starten** (vgl. [rconceptnet](https://github.com/knadh/rconceptnet)) — oder nur Container: `npm run docker:conceptnet`

```sh
rconceptnet --db data/conceptnet/conceptnet.sqlite serve --addr 0.0.0.0:3043
```

4. In `.env`:

```env
RCONCEPTNET_URL=http://127.0.0.1:3043
```

Die App nutzt dann Kantenabfragen gegen diesen Server und eine **heuristische Relatedness** (direkte Kante + Jaccard der Nachbarn), weil rconceptnet keinen `/relatedness`-Endpunkt wie die alte API anbietet. Wenn weder lokal noch remote etwas liefert, greift weiterhin die lexikalische Näherung im Rate-Endpunkt.

## Docker

`compose.yaml` enthält u. a.:

| Dienst              | Compose-Profil | Beschreibung |
| ------------------- | -------------- | ------------- |
| `db`                | *(keins)*      | PostgreSQL — wie bisher mit `npm run db:start` oder `docker compose up -d` |
| `app`               | `app`          | Produktions-Image der SvelteKit-App (`Dockerfile`, Port **3000**) |
| `conceptnet`        | `conceptnet`   | rconceptnet-JSON-Server (Port **3043**, Ordner `./data/conceptnet` → `/data`) |
| `conceptnet-import` | `import`       | Einmaliger Import: `npm run docker:conceptnet:import` |
| `embeddings`        | `embeddings`   | Einmaliger Job: `npm run docker:embeddings` (Sentence-Transformers → DB) |

**Nur Postgres** (Standard für lokale Entwicklung gegen `npm run dev`): weiterhin `docker compose up -d` — startet nur `db`.

**App + Postgres:**

```sh
npm run docker:up
```

Schema und Seeds laufen weiterhin **auf dem Host** (wo `drizzle-kit` / `tsx` installiert sind), mit `DATABASE_URL` auf `localhost:5432`:

```sh
npm run db:push
npm run docker:embeddings
npm run db:seed
```

(`docker:embeddings` spricht im Container die DB unter dem Hostnamen `db` an; bei Postgres nur auf dem Host wie oben ist das passend.)

**Mit lokalem ConceptNet:** Assertions liegen unter `data/conceptnet/conceptnet-assertions-5.7.0.csv.gz`, dann `npm run docker:conceptnet:import` (erzeugt `data/conceptnet/conceptnet.sqlite`). In `.env` für den Docker-Stack:

```env
RCONCEPTNET_URL=http://conceptnet:3043
```

(Wichtig: im Container den **Service-Namen** `conceptnet`, nicht `127.0.0.1`.)

```sh
npm run docker:up:cn
```

Stoppen: `npm run docker:down`.

### Test: Wolken-Cluster & Mehrwort-Bubbles

Für einen Snapshot mit **drei dicht beieinanderliegenden Lemma-Gruppen** (plus Streu-Wörtern), wie ihn die Wolken-Clusterlogik nutzt:

1. Stammdaten wie oben (`db:seed` mindestens einmal, wenn die DB leer ist).
2. Demo-Snapshot für den **aktuellen UTC-Kalendertag** einspielen:

```sh
npm run db:seed:cluster-demo
```

Das Skript zeigt die **Puzzle-ID** und einen fertigen **`localStorage.setItem`-Snippet**, mit dem du neun Rates sofort als geloggt einspielen kannst — ohne jedes Lemma einzeln einzugeben.

## Datenmodell (MVP-Grundlage)

Aktuelles Schema umfasst u. a.:

- `vocabulary` — erlaubte deutsche Rate-Begriffe
- `languages` — Metadaten zur Sprache (Bonusrunde)
- `countries` — Metadaten zu Ländern (Bonusrunde)
- `puzzles` — Tagesrätsel + vorberechneter Semantik-Snapshot (JSON)
- `puzzle_countries` — gültige Länderantworten pro Rätsel
- `guesses` — optional Telemetrie zu ähnlichsten Treffern

## API

- `GET /api/puzzle/today` — aktuelles Tagesrätsel inkl. Bonus-Metadaten
- Bei fehlendem Rätsel für den aktuellen **UTC**-Kalendertag: **404** mit `{ nachricht, datum }` (Deutsch)

## Nächste Schritte

- MVP-Vokabular und erste 30 Puzzle-Zeilen seeden
- Optional: täglicher Cron/Container für `db:embeddings` in Produktion
- D3-Wortwolke, Spielfluss und Reveal-Umgebung umsetzen
