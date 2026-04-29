import type { PuzzleSnapshotNode } from '$lib/game/types';

export type LemmaCluster = {
	members: PuzzleSnapshotNode[];
	cx: number;
	cy: number;
};

/** Union-Find nach Distanz-Schwelle in Daten-Koordinaten (wie die Embedding-Achsen). */
function clusterIndices(points: PuzzleSnapshotNode[], eps: number): number[][] {
	const n = points.length;
	if (n <= 1) return points.map((_, i) => [i]);

	const parent = Array.from({ length: n }, (_, i) => i);
	function find(i: number): number {
		return parent[i] === i ? i : (parent[i] = find(parent[i]));
	}
	function union(a: number, b: number) {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[ra] = rb;
	}

	const eps2 = eps * eps;
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const dx = points[i].x - points[j].x;
			const dy = points[i].y - points[j].y;
			if (dx * dx + dy * dy <= eps2) union(i, j);
		}
	}

	const buckets = new Map<number, number[]>();
	for (let i = 0; i < n; i++) {
		const r = find(i);
		if (!buckets.has(r)) buckets.set(r, []);
		buckets.get(r)!.push(i);
	}
	return [...buckets.values()];
}

/**
 * Gruppiert geratene lemmas nach Nähe im Embedding — eine Bubble pro Gruppe am Schwerpunkt.
 * Schwelle relativ zur Punktwolken-Diagonale (kleiner ⇒ mehr Einzel-Bubbles).
 */
/** Label-Zeilen (sortiert nach Nähe); bei >4 Lemmas drei Zeilen + „+n“. */
export function lemmaLinesForCluster(members: PuzzleSnapshotNode[]): string[] {
	const sorted = [...members].sort((a, b) => b.similarity - a.similarity);
	if (sorted.length <= 4) return sorted.map((m) => m.lemma);
	const shown = sorted.slice(0, 3).map((m) => m.lemma);
	shown.push(`+${sorted.length - 3}`);
	return shown;
}

export function clusterGuessedNodes(nodes: PuzzleSnapshotNode[], epsFraction = 0.152): LemmaCluster[] {
	if (nodes.length === 0) return [];

	let minX = Infinity,
		maxX = -Infinity,
		minY = Infinity,
		maxY = -Infinity;
	for (const p of nodes) {
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}
	const dx = maxX - minX || 1e-9;
	const dy = maxY - minY || 1e-9;
	const diag = Math.hypot(dx, dy);
	const eps = Math.max(diag * epsFraction, 0.035);

	const idxGroups = clusterIndices(nodes, eps);
	return idxGroups.map((indices) => {
		const members = indices.map((i) => nodes[i]);
		let sx = 0,
			sy = 0;
		for (const m of members) {
			sx += m.x;
			sy += m.y;
		}
		const inv = 1 / members.length;
		return {
			members,
			cx: sx * inv,
			cy: sy * inv
		};
	});
}
