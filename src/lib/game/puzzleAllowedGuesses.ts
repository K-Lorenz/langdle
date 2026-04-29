import { normalizeLemmaKey } from '$lib/game/normalize';

/** Keys für erlaubte Raten: Gitter-Knoten + Ziel-Lemma + optionale Extras aus dem Snapshot. */
export function allowedGuessKeysFromPuzzle(puzzle: {
	snapshot: { nodes: { lemma: string }[]; extraAllowedLemmas?: string[] };
	targetGermanCanonical: string;
}): Set<string> {
	const keys = new Set<string>();
	keys.add(normalizeLemmaKey(puzzle.targetGermanCanonical));
	for (const n of puzzle.snapshot.nodes) {
		keys.add(normalizeLemmaKey(n.lemma));
	}
	for (const raw of puzzle.snapshot.extraAllowedLemmas ?? []) {
		const k = normalizeLemmaKey(raw);
		if (k) keys.add(k);
	}
	return keys;
}
