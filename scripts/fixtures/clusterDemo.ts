/**
 * Test-/Demo-Snapshot für die Wortwolke: mehrere eng benachbarte Gruppen im Embedding-Raum,
 * damit `clusterGuessedNodes` echte Mehrwort-Bubbles bildet (Schwellen wie in Produktion).
 *
 * Siehe `npm run db:seed:cluster-demo` und README.
 */
import { normalizeLemmaKey } from '../../src/lib/game/normalize.ts';

type Temp = 'cold' | 'warm' | 'hot';

export type ClusterDemoWord = {
	lemma: string;
	x: number;
	y: number;
	similarity: number;
	temperature: Temp;
	isRevealNode?: boolean;
};

/**
 * Drei Cluster (Alpha/Beta/Gamma) mit Abständen ≈≤ 0,03 — verschmelzen bei mehreren Rates,
 * sobald die Wolken-Diagonale groß genug ist; Zielwort „danke“ mittig bei (0, 0).
 */
export const CLUSTER_DEMO_WORDS: ClusterDemoWord[] = [
	{ lemma: 'danke', x: 0, y: 0, similarity: 1, temperature: 'hot', isRevealNode: true },

	/* Cluster Alpha — „Danke-Umfeld“ */
	{ lemma: 'freundlich', x: 0.58, y: 0.58, similarity: 0.74, temperature: 'warm' },
	{ lemma: 'vielen Dank', x: 0.595, y: 0.585, similarity: 0.81, temperature: 'hot' },
	{ lemma: 'Dankeschön', x: 0.565, y: 0.595, similarity: 0.79, temperature: 'hot' },

	/* Cluster Beta — Zeit/Wetter-Lexik */
	{ lemma: 'Morgen', x: -0.52, y: -0.48, similarity: 0.36, temperature: 'cold' },
	{ lemma: 'Woche', x: -0.505, y: -0.495, similarity: 0.34, temperature: 'cold' },
	{ lemma: 'Wetter', x: -0.535, y: -0.465, similarity: 0.33, temperature: 'cold' },

	/* Cluster Gamma — Gruß-/Modalwörter */
	{ lemma: 'bitte', x: -0.15, y: 0.62, similarity: 0.66, temperature: 'warm' },
	{ lemma: 'schön', x: -0.135, y: 0.605, similarity: 0.57, temperature: 'cold' },
	{ lemma: 'Tschüs', x: -0.165, y: 0.635, similarity: 0.41, temperature: 'cold' },

	/* Streuer — keine weiteren Cluster gewünscht */
	{ lemma: 'hoffentlich', x: 0.42, y: -0.33, similarity: 0.44, temperature: 'cold' },
	{ lemma: 'grüße', x: -0.28, y: -0.22, similarity: 0.52, temperature: 'cold' },
	{ lemma: 'guten Tag', x: 0.48, y: -0.08, similarity: 0.37, temperature: 'cold' },
	{ lemma: 'froh', x: -0.41, y: -0.14, similarity: 0.39, temperature: 'cold' },
	{ lemma: 'Hilfe', x: -0.48, y: 0.41, similarity: 0.26, temperature: 'cold' },
	{ lemma: 'Himmel', x: -0.58, y: -0.21, similarity: 0.18, temperature: 'cold' },
	{ lemma: 'Feder', x: 0.58, y: -0.19, similarity: 0.07, temperature: 'cold' },
	{ lemma: 'Bleistift', x: 0.38, y: -0.58, similarity: 0.05, temperature: 'cold' },
	{ lemma: 'Hütte', x: -0.31, y: -0.57, similarity: 0.09, temperature: 'cold' },
	{ lemma: 'Können', x: 0.11, y: -0.49, similarity: 0.32, temperature: 'cold' },
	{ lemma: 'Lachen', x: -0.21, y: -0.59, similarity: 0.35, temperature: 'cold' },
	{ lemma: 'Küste', x: 0.49, y: -0.29, similarity: 0.12, temperature: 'cold' },
	{ lemma: 'Karte', x: -0.39, y: -0.38, similarity: 0.15, temperature: 'cold' },
	{ lemma: 'Herd', x: 0.29, y: -0.48, similarity: 0.08, temperature: 'cold' }
];

/** Lemmata in Rate-Reihenfolge — drei Cluster abdecken (je eine Bubble mit mehreren Lemmata sobald eingeloggt). */
export const CLUSTER_DEMO_GUESSES_LEMMAS_IN_ORDER = [
	'freundlich',
	'vielen Dank',
	'Dankeschön',
	'Morgen',
	'Woche',
	'Wetter',
	'bitte',
	'schön',
	'Tschüs'
] as const;

export const CLUSTER_DEMO_PRELOAD_KEYS_IN_ORDER = CLUSTER_DEMO_GUESSES_LEMMAS_IN_ORDER.map((lemma) =>
	normalizeLemmaKey(lemma)
);
