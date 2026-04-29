import type { PuzzleSnapshotNode } from './types';

export function snapshotNodeByLemmaKey(snapshot: PuzzleSnapshotNode[]): Map<string, PuzzleSnapshotNode> {
	const map = new Map<string, PuzzleSnapshotNode>();
	for (const n of snapshot) {
		map.set(n.lemmaNormalizedKey, n);
	}
	return map;
}

/**
 * Rank 1 = höchste Similarity. Bei Gleichstand eindeutig über Lemma-Schlüssel
 * (vermeidet doppelte „Rang 3“ mit gleicher Prozentzahl).
 */
export function similarityRankAcrossSnapshot(
	snapshot: PuzzleSnapshotNode[],
	targetKey: string
): number | null {
	const target = snapshot.find((n) => n.lemmaNormalizedKey === targetKey);
	if (!target) return null;
	const sorted = [...snapshot].sort((a, b) => {
		const ds = (b.similarity ?? 0) - (a.similarity ?? 0);
		if (ds !== 0) return ds;
		return a.lemmaNormalizedKey.localeCompare(b.lemmaNormalizedKey);
	});
	const ix = sorted.findIndex((n) => n.lemmaNormalizedKey === targetKey);
	return ix >= 0 ? ix + 1 : null;
}
