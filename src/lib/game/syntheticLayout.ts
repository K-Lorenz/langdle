import type { Temperature } from '$lib/game/types';

/** Gleiche grobe Schwellen wie die Embedding-Wolke (kalt / warm / heiß). */
export function temperatureFromSimilarity(s: number): Temperature {
	if (s < 0.38) return 'cold';
	if (s < 0.68) return 'warm';
	return 'hot';
}

/**
 * ConceptNet/Jaccard-Werte liegen oft zu hoch und vergleichen sich schlecht mit Embedding-Cosinus.
 * Kurve nach unten ziehen, damit %-Anzeige und Ränge näher am Snapshot wirken.
 */
export function calibrateSyntheticSimilarity(raw: number): number {
	const x = Math.max(0, Math.min(1, raw));
	return 0.05 + 0.78 * Math.pow(x, 1.52);
}

/** Strengere Stufen für kalibrierte ConceptNet-/Blend-Werte (nicht für reine Snapshot-Knoten). */
export function temperatureFromSyntheticSimilarity(s: number): Temperature {
	if (s < 0.34) return 'cold';
	if (s < 0.56) return 'warm';
	return 'hot';
}

/** Stabiler Randabstand im gleichen Koordinatenbereich wie das Snapshot-Gitter (−1 … 1). */
export function polarXYFromSimilarity(key: string, similarity: number): { x: number; y: number } {
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const angle = ((h >>> 0) % 10_000) / 10_000 * 2 * Math.PI;
	const maxR = 0.88;
	const r = (1 - similarity) * maxR;
	return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}
