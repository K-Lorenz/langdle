/**
 * Kosinus-Ähnlichkeit für gespeicherte Embedding-Vektoren (Sentence-Transformers: typisch L2-normalisiert).
 * Ausgabe [0, 1] für Anzeige und Vergleich mit Snapshot-Knoten.
 */

export function cosineSimilarityRaw(a: readonly number[], b: readonly number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i]!;
		const y = b[i]!;
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb);
	if (denom === 0) return 0;
	const cos = dot / denom;
	return Math.max(-1, Math.min(1, cos));
}

/** Maps cosine [-1, 1] → [0, 1] für UI und Temperature-Schwellen. */
export function cosineToSimilarity01(cos: number): number {
	const u = (cos + 1) / 2;
	return Math.max(0.0005, Math.min(0.9999, u));
}

export function embeddingSimilarity01(a: readonly number[], b: readonly number[]): number {
	return cosineToSimilarity01(cosineSimilarityRaw(a, b));
}
