/**
 * Snapshot-Knoten aus Satz-Embeddings (kosinus-basierte Ähnlichkeit zum Zielwort).
 * Ring-Aufteilung analog zu ConceptNet-Hops: obere Perzentile der Kosinus-Werte ≈ „nah“, untere ≈ „fern“.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

import { embeddingSimilarity01 } from '../../src/lib/game/embeddingSimilarity.ts';
import { lexicalSimilarity01 } from '../../src/lib/game/lexicalSimilarity.ts';
import { normalizeLemmaKey } from '../../src/lib/game/normalize.ts';
import { polarXYFromSimilarity, temperatureFromSimilarity } from '../../src/lib/game/syntheticLayout.ts';
import { vocabulary as vocabularyTable } from '../../src/lib/server/db/schema.ts';
import * as dbSchema from '../../src/lib/server/db/schema.ts';

import {
	lemmaKeyMatchesGuessPool,
	resolveGuessPoolAllowedKeys,
	type GuessPoolMode
} from './guessPoolConstraint.ts';
import type { GeneratedPuzzleNode, SeedProgressFn } from './puzzleGridFromSources.ts';

export type { GeneratedPuzzleNode };

/** Kleine deterministische Streuung — gleiche Idee wie ConceptNet-Snapshot. */
function tieBreakSimilarity(sim: number, key: string): number {
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const eps = ((h >>> 0) % 8001) / 2_000_000 - 0.002;
	return Math.max(0.0005, Math.min(0.9999, sim + eps));
}

function hashSeed(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function seededRand(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function allocateHopCounts(totalSlots: number): [number, number, number, number] {
	const fracs = [0.1, 0.2, 0.5, 0.2];
	const exact = fracs.map((f) => totalSlots * f);
	const floors = exact.map((x) => Math.floor(x));
	let rem = totalSlots - floors.reduce((a, b) => a + b, 0);
	const fracRem = exact.map((x, i) => x - floors[i]!);
	const order = [0, 1, 2, 3].sort((a, b) => (fracRem[b] ?? 0) - (fracRem[a] ?? 0));
	let j = 0;
	while (rem > 0) {
		floors[order[j % 4]!]!++;
		rem--;
		j++;
	}
	return [floors[0]!, floors[1]!, floors[2]!, floors[3]!];
}

type Scored = { lemma: string; key: string; sim01: number; hop: 1 | 2 | 3 | 4 };

type HopPick = { lemma: string; key: string; hop: 1 | 2 | 3 | 4 };

function pickFromHopPool(
	pool: HopPick[],
	n: number,
	canonicalTarget: string,
	lexicalDedupeMax: number,
	rand: () => number
): HopPick[] {
	if (n <= 0) return [];
	const shuffled = [...pool];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
	}

	const picked: HopPick[] = [];
	const LEX_NEAR = 0.78;

	function tryPick(strictLex: boolean): void {
		for (const c of shuffled) {
			if (picked.length >= n) break;
			if (picked.some((p) => p.key === c.key)) continue;
			if (strictLex && lexicalSimilarity01(canonicalTarget, c.lemma) > lexicalDedupeMax) continue;
			let near = false;
			for (const p of picked) {
				if (lexicalSimilarity01(p.lemma, c.lemma) > LEX_NEAR) {
					near = true;
					break;
				}
			}
			if (near) continue;
			picked.push(c);
		}
	}

	tryPick(true);
	if (picked.length < n) tryPick(false);
	return picked;
}

/** Index-Grenzen für 4 „Ringe“ entlang absteigender Ähnlichkeit (ohne Ziel). */
function bucketBounds(len: number): [number, number, number, number, number] {
	if (len <= 0) return [0, 0, 0, 0, 0];
	const a = Math.max(1, Math.ceil(len * 0.1));
	const b = Math.max(a + 1, Math.ceil(len * 0.3));
	const c = Math.max(b + 1, Math.ceil(len * 0.75));
	const d = len;
	return [0, a, b, c, d];
}

function hopAtIndex(idx: number, bounds: [number, number, number, number, number]): 1 | 2 | 3 | 4 {
	if (idx < bounds[1]) return 1;
	if (idx < bounds[2]) return 2;
	if (idx < bounds[3]) return 3;
	return 4;
}

function partitionByHop(reranked: Scored[]): HopPick[][] {
	const pools: HopPick[][] = [[], [], [], []];
	for (const s of reranked) {
		pools[s.hop - 1]!.push({ lemma: s.lemma, key: s.key, hop: s.hop });
	}
	return pools;
}

/**
 * Gitter aus Kaikki-Vokabular mit gespeicherten Embeddings (kein ConceptNet nötig).
 */
export async function buildPuzzleNodesFromEmbeddings(
	db: PostgresJsDatabase<typeof dbSchema>,
	opts: {
		targetGerman: string;
		gridSize: number;
		lexicalDedupeMax: number;
		/** @default 'all' */
		guessPoolMode?: GuessPoolMode;
		onProgress?: SeedProgressFn;
	}
): Promise<GeneratedPuzzleNode[]> {
	const { targetGerman, gridSize, lexicalDedupeMax, onProgress } = opts;
	const guessPoolMode: GuessPoolMode = opts.guessPoolMode ?? 'all';
	const needNeighbors = Math.max(0, gridSize - 1);

	onProgress?.(8, 'Embeddings aus Datenbank lesen…');

	const rows = await db
		.select({
			lemma: vocabularyTable.lemma,
			embedding: vocabularyTable.embedding
		})
		.from(vocabularyTable)
		.where(sql`${vocabularyTable.embedding} is not null`);

	const targetKey = normalizeLemmaKey(targetGerman);
	if (!targetKey) throw new Error('targetGerman ist leer.');

	let canonicalTarget: string | undefined;
	let targetEmb: number[] | undefined;

	for (const r of rows) {
		if (normalizeLemmaKey(r.lemma) === targetKey) {
			canonicalTarget = r.lemma;
			const emb = r.embedding;
			if (Array.isArray(emb) && emb.length > 0) targetEmb = emb as number[];
			break;
		}
	}

	if (!canonicalTarget || !targetEmb) {
		throw new Error(
			`Zielwort „${targetGerman.trim()}“ hat kein Embedding — zuerst \`npm run db:embeddings\` ausführen (Lemma muss in vocabulary stehen).`
		);
	}

	const partial: Omit<Scored, 'hop'>[] = [];
	for (const r of rows) {
		const k = normalizeLemmaKey(r.lemma);
		if (!k || k === targetKey) continue;
		const emb = r.embedding;
		if (!Array.isArray(emb) || emb.length === 0) continue;
		const sim01 = embeddingSimilarity01(targetEmb, emb as number[]);
		partial.push({ lemma: r.lemma, key: k, sim01 });
	}

	const poolRes = await resolveGuessPoolAllowedKeys(db, canonicalTarget, guessPoolMode);
	let partialForRings = partial;
	if (poolRes.allowedKeys !== null) {
		const filtered = partial.filter((s) => lemmaKeyMatchesGuessPool(s.key, poolRes.allowedKeys));
		if (filtered.length >= needNeighbors) {
			partialForRings = filtered;
		} else {
			console.warn(
				`[puzzle-grid] guessPool=${guessPoolMode} (${poolRes.detail}) — nur ${filtered.length} Kandidaten mit Embedding, Fallback ungefiltert`
			);
		}
	}

	partialForRings.sort((a, b) => b.sim01 - a.sim01);

	const bounds = bucketBounds(partialForRings.length);
	const reranked: Scored[] = partialForRings.map((s, idx) => ({
		...s,
		hop: hopAtIndex(idx, bounds)
	}));

	onProgress?.(
		40,
		`Kandidaten: ${reranked.length} Lemmata mit Embedding · Ringe nach Kosinus-Rang`
	);

	const hopPools = partitionByHop(reranked);
	const rand = seededRand(hashSeed(canonicalTarget + '|embed-grid|v1'));
	const [n1, n2, n3, n4] = allocateHopCounts(needNeighbors);
	const targets = [n1, n2, n3, n4] as const;

	const usedKeys = new Set<string>();
	let picks: HopPick[] = [];

	for (let hi = 0; hi < 4; hi++) {
		const hop = (hi + 1) as 1 | 2 | 3 | 4;
		const pool = hopPools[hi]!.filter((p) => !usedKeys.has(p.key));
		const got = pickFromHopPool(pool, targets[hi]!, canonicalTarget, lexicalDedupeMax, rand);
		for (const g of got) {
			usedKeys.add(g.key);
			picks.push({ ...g, hop });
		}
	}

	let deficit = needNeighbors - picks.length;
	while (deficit > 0) {
		let progressed = false;
		const order = [0, 1, 2, 3];
		for (const hi of order) {
			if (deficit <= 0) break;
			const hop = (hi + 1) as 1 | 2 | 3 | 4;
			const pool = hopPools[hi]!.filter((p) => !usedKeys.has(p.key));
			const one = pickFromHopPool(pool, 1, canonicalTarget, lexicalDedupeMax, rand)[0];
			if (one) {
				usedKeys.add(one.key);
				picks.push({ ...one, hop });
				deficit--;
				progressed = true;
			}
		}
		if (!progressed) break;
	}

	if (picks.length < needNeighbors) {
		throw new Error(
			`Zu wenige Lemmata mit Embedding für das Gitter (habe ${picks.length}, brauche ${needNeighbors}). ` +
				`Kaikki-Vokabular vergrößern oder gridSize senken.`
		);
	}

	if (picks.length > needNeighbors) picks = picks.slice(0, needNeighbors);

	const simByKey = new Map(reranked.map((s) => [s.key, s.sim01] as const));

	onProgress?.(88, 'Snapshot-Knoten (Koordinaten, Temperaturen) …');

	const nodes: GeneratedPuzzleNode[] = [];

	nodes.push({
		lemma: canonicalTarget,
		x: 0,
		y: 0,
		similarity: 1,
		temperature: 'hot',
		isRevealNode: true
	});

	for (const p of picks) {
		const baseSim = simByKey.get(p.key) ?? 0.35;
		const similarity = tieBreakSimilarity(baseSim, p.key);
		const { x, y } = polarXYFromSimilarity(p.key, similarity);
		const temperature = temperatureFromSimilarity(similarity);

		nodes.push({
			lemma: p.lemma,
			x,
			y,
			similarity,
			temperature
		});
	}

	nodes.sort((a, b) => {
		if (a.isRevealNode) return -1;
		if (b.isRevealNode) return 1;
		return b.similarity - a.similarity;
	});

	onProgress?.(100, `Gitter bereit (${nodes.length} Knoten, Embedding)`);
	return nodes;
}

export async function countVocabularyRowsWithEmbedding(
	db: PostgresJsDatabase<typeof dbSchema>
): Promise<number> {
	const [row] = await db
		.select({ c: sql<number>`count(*)::int` })
		.from(vocabularyTable)
		.where(sql`${vocabularyTable.embedding} is not null`);
	return row?.c ?? 0;
}

export async function targetLemmaHasEmbedding(
	db: PostgresJsDatabase<typeof dbSchema>,
	targetGerman: string
): Promise<boolean> {
	const targetKey = normalizeLemmaKey(targetGerman);
	if (!targetKey) return false;

	const rows = await db
		.select({
			lemma: vocabularyTable.lemma,
			embedding: vocabularyTable.embedding
		})
		.from(vocabularyTable)
		.where(sql`${vocabularyTable.embedding} is not null`);

	for (const r of rows) {
		if (normalizeLemmaKey(r.lemma) === targetKey) return true;
	}
	return false;
}
