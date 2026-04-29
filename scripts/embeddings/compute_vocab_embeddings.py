"""
Lädt alle Zeilen aus `vocabulary`, codiert Lemmata mit einem multilingualen
Sentence-Transformer und schreibt `embedding` (JSON-Array) + `embedding_model`.

Voraussetzungen:
  pip install -r scripts/embeddings/requirements.txt
  DATABASE_URL (wie für die App)

Optional:
  EMBEDDING_MODEL — Standard: paraphrase-multilingual-MiniLM-L12-v2 (schnell, mehrsprachig).
                      Alternative: sentence-transformers/LaBSE (schwerer, oft besser für Übersetzungs-Nähe).
  EMBEDDING_SAVE_PROGRESS_INTERVAL — alle N Zeilen Fortschritt beim DB-Schreiben loggen (Standard: 5000).

Beispiel:
  set DATABASE_URL=postgres://...
  python scripts/embeddings/compute_vocab_embeddings.py
"""

from __future__ import annotations

import json
import os
import sys
import time


def main() -> None:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("DATABASE_URL ist nicht gesetzt.", file=sys.stderr)
        sys.exit(1)

    model_name = os.environ.get(
        "EMBEDDING_MODEL", "paraphrase-multilingual-MiniLM-L12-v2"
    ).strip()
    batch_size = int(os.environ.get("EMBEDDING_BATCH", "64"))
    save_progress_every = max(1, int(os.environ.get("EMBEDDING_SAVE_PROGRESS_INTERVAL", "5000")))

    try:
        import psycopg
        from sentence_transformers import SentenceTransformer
    except ImportError as e:
        print(
            "Fehlende Abhängigkeit: pip install -r scripts/embeddings/requirements.txt\n",
            e,
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Modell: {model_name}", flush=True)
    model = SentenceTransformer(model_name)

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, lemma FROM vocabulary ORDER BY id"
            )
            rows = cur.fetchall()

    if not rows:
        print("vocabulary ist leer.", file=sys.stderr)
        sys.exit(1)

    ids = [r[0] for r in rows]
    lemmas = [r[1] for r in rows]

    print(f"{len(lemmas)} Lemmata · Batches à {batch_size} …", flush=True)
    encode_start = time.monotonic()
    all_vecs = model.encode(
        lemmas,
        batch_size=batch_size,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    encode_secs = time.monotonic() - encode_start

    n = len(ids)
    print(
        f"Embeddings berechnet in {encode_secs:.0f}s · schreibe {n} Zeilen in die Datenbank …",
        flush=True,
    )

    db_start = time.monotonic()
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            for i, vid in enumerate(ids):
                vec = all_vecs[i].tolist()
                cur.execute(
                    """
                    UPDATE vocabulary
                    SET embedding = %s::jsonb,
                        embedding_model = %s
                    WHERE id = %s
                    """,
                    (json.dumps(vec), model_name, vid),
                )
                done = i + 1
                if done % save_progress_every == 0 or done == n:
                    elapsed = time.monotonic() - db_start
                    rate = done / elapsed if elapsed > 0 else 0
                    remaining = n - done
                    eta_secs = remaining / rate if rate > 0 else 0
                    print(
                        f"  DB · {done}/{n} ({100.0 * done / n:.1f}%) · "
                        f"{elapsed:.0f}s elapsed · ~{eta_secs:.0f}s rest",
                        flush=True,
                    )
        conn.commit()

    db_secs = time.monotonic() - db_start
    total_secs = encode_secs + db_secs
    print(
        f"OK — {len(ids)} Embeddings gespeichert ({model_name}) · "
        f"encode {encode_secs:.0f}s · DB {db_secs:.0f}s · gesamt ~{total_secs / 60:.1f} min",
        flush=True,
    )


if __name__ == "__main__":
    main()
