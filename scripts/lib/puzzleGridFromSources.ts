/**
 * Snapshot-Knoten: Kaikki-Lemmata mit ConceptNet-Graphdistanz (Hops) vom Zielwort.
 * Aufteilung der Nachbarfelder (ohne Zelle für das Ziel): 10 % 1 Hop, 20 % 2 Hops,
 * 50 % 3 Hops, 20 % 4 Hops.
 *
 * Ähnlichkeit und %-Anzeige leiten sich aus der Hop-Tiefe ab (nicht aus Kantengewicht),
 * damit Prozentwerte zur „Entfernung“ im Graph passen.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { normalizeLemmaKey } from '../../src/lib/game/normalize.ts';
import { lexicalSimilarity01 } from '../../src/lib/game/lexicalSimilarity.ts';
import {
	fetchRconceptnetEdges,
	neighborKeys,
	type RconceptnetEdgeRow
} from '../../src/lib/server/conceptNetLocal.ts';
import { polarXYFromSimilarity, temperatureFromSimilarity } from '../../src/lib/game/syntheticLayout.ts';
import { vocabulary as vocabularyTable } from '../../src/lib/server/db/schema.ts';
import * as dbSchema from '../../src/lib/server/db/schema.ts';

import {
	lemmaKeyMatchesGuessPool,
	resolveGuessPoolAllowedKeys,
	type GuessPoolMode
} from './guessPoolConstraint.ts';

export type { GuessPoolMode };

export type GeneratedPuzzleNode = {
	lemma: string;
	x: number;
	y: number;
	similarity: number;
	temperature: 'cold' | 'warm' | 'hot';
	isRevealNode?: boolean;
};

function cnLabelKey(raw: string): string {
	return normalizeLemmaKey(raw.replace(/_/g, ' '));
}

function lemmaFromRowsForNeighbor(
	rows: RconceptnetEdgeRow[],
	pivotKey: string,
	neighborKey: string
): string | null {
	for (const r of rows) {
		const sl = r.start_label ? cnLabelKey(r.start_label) : '';
		const el = r.end_label ? cnLabelKey(r.end_label) : '';
		if (!sl || !el) continue;
		if (sl === pivotKey && el === neighborKey)
			return (r.end_label ?? '').replace(/_/g, ' ').trim();
		if (el === pivotKey && sl === neighborKey)
			return (r.start_label ?? '').replace(/_/g, ' ').trim();
	}
	return null;
}

/** Kleine deterministische Streuung für eindeutige Werte / Anzeige. */
function tieBreakSimilarity(sim: number, key: string): number {
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const eps = ((h >>> 0) % 8001) / 2_000_000 - 0.002;
	return Math.max(0.0005, Math.min(0.9999, sim + eps));
}

/** Ziel-Mitten [0,1] je Hop — höher = näher am Ziel im Graph. */
const HOP_SIM_CENTER: Record<1 | 2 | 3 | 4, number> = {
	1: 0.9,
	2: 0.64,
	3: 0.37,
	4: 0.15
};

function similarityForHop(hop: 1 | 2 | 3 | 4, key: string): number {
	return tieBreakSimilarity(HOP_SIM_CENTER[hop], key);
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

async function loadVocabByKey(
	db: PostgresJsDatabase<typeof dbSchema>
): Promise<Map<string, string>> {
	const rows = await db.select({ lemma: vocabularyTable.lemma }).from(vocabularyTable);
	const byKey = new Map<string, string>();
	for (const { lemma } of rows) {
		const k = normalizeLemmaKey(lemma);
		if (!k) continue;
		if (!byKey.has(k)) byKey.set(k, lemma);
	}
	return byKey;
}

export type SeedProgressFn = (percent: number, detail: string) => void;

/**
 * Wellen-BFS (Hop 1…4) mit Schicht-Deckel: bei sehr breiten Schichten Stichprobe, damit der
 * Seed nicht minutenlang läuft. Distanz ist dann eine gute Näherung, nicht garantiert kürzester Weg.
 */
async function bfsHopDistances(
	baseUrl: string,
	canonicalTarget: string,
	targetKey: string,
	edgeLimit: number,
	vocabByKey: Map<string, string>,
	rand: () => number,
	onProgress?: SeedProgressFn,
	progressRange: { lo: number; hi: number } = { lo: 12, hi: 82 }
): Promise<{ dist: Map<string, number>; lemmaForKey: Map<string, string> }> {
	const lemmaForKey = new Map<string, string>([[targetKey, canonicalTarget]]);
	const dist = new Map<string, number>([[targetKey, 0]]);
	const seen = new Set<string>([targetKey]);

	/** Pro Hop-Schicht max. so viele Knoten expandieren (Rest zufällig). */
	const MAX_NODES_PER_WAVE = [0, 260, 380, 520, 680] as const;

	let currentLayer = new Set<string>([targetKey]);
	const { lo: progLo, hi: progHi } = progressRange;
	const progSpan = Math.max(1, progHi - progLo);

	for (let hop = 1; hop <= 4; hop++) {
		let keys = [...currentLayer];
		const cap = MAX_NODES_PER_WAVE[hop];
		if (keys.length > cap) {
			for (let i = keys.length - 1; i > 0; i--) {
				const j = Math.floor(rand() * (i + 1));
				[keys[i], keys[j]] = [keys[j]!, keys[i]!];
			}
			keys = keys.slice(0, cap);
		}

		const waveLo = progLo + ((hop - 1) / 4) * progSpan;
		const waveHi = progLo + (hop / 4) * progSpan;

		onProgress?.(
			waveLo,
			`ConceptNet Hop ${hop}/4 · Expandierung (${keys.length} Knoten im Batch)`
		);

		const chunkSize = 18;
		const chunks = Math.max(1, Math.ceil(keys.length / chunkSize));
		const expanded: { k: string; rows: RconceptnetEdgeRow[] }[] = [];

		for (let ci = 0; ci < chunks; ci++) {
			const part = keys.slice(ci * chunkSize, (ci + 1) * chunkSize);
			const batch = await Promise.all(
				part.map(async (k) => {
					const lemma = lemmaForKey.get(k);
					if (!lemma) return { k, rows: [] as RconceptnetEdgeRow[] };
					const rows = await fetchRconceptnetEdges(baseUrl, lemma, 'de', edgeLimit);
					return { k, rows };
				})
			);
			expanded.push(...batch);

			const t = (ci + 1) / chunks;
			onProgress?.(
				waveLo + t * (waveHi - waveLo),
				`ConceptNet Hop ${hop}/4 · Kanten-Abfragen ${ci + 1}/${chunks}`
			);
		}

		const nextLayer = new Set<string>();

		for (const { k, rows } of expanded) {
			const nbrs = neighborKeys(rows, k);
			for (const nk of nbrs) {
				if (nk === targetKey) continue;
				if (!lemmaForKey.has(nk)) {
					const lab = lemmaFromRowsForNeighbor(rows, k, nk) ?? vocabByKey.get(nk);
					if (!lab) continue;
					lemmaForKey.set(nk, lab);
				}
				if (!seen.has(nk)) {
					seen.add(nk);
					dist.set(nk, hop);
					nextLayer.add(nk);
				}
			}
		}

		currentLayer = nextLayer;
		onProgress?.(
			waveHi,
			`ConceptNet Hop ${hop}/4 · fertig (+${nextLayer.size} neue Knoten)`
		);
		if (currentLayer.size === 0) break;
	}

	onProgress?.(progHi, 'ConceptNet-BFS abgeschlossen');
	return { dist, lemmaForKey };
}

type HopPick = { lemma: string; key: string; hop: 1 | 2 | 3 | 4 };

function collectKaikkiAtHop(
	dist: Map<string, number>,
	vocabByKey: Map<string, string>,
	targetKey: string,
	hop: 1 | 2 | 3 | 4
): HopPick[] {
	const out: HopPick[] = [];
	for (const [k, d] of dist) {
		if (d !== hop || k === targetKey) continue;
		const lem = vocabByKey.get(k);
		if (lem) out.push({ lemma: lem, key: k, hop });
	}
	return out;
}

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

function pickHopRingNeighbors(
	hopPools: HopPick[][],
	needNeighbors: number,
	alloc: [number, number, number, number],
	canonicalTarget: string,
	lexicalDedupeMax: number,
	rand: () => number
): HopPick[] {
	const [n1, n2, n3, n4] = alloc;
	const usedKeys = new Set<string>();
	let picks: HopPick[] = [];

	const targets = [n1, n2, n3, n4] as const;

	for (let hi = 0; hi < 4; hi++) {
		const pool = hopPools[hi]!.filter((p) => !usedKeys.has(p.key));
		const got = pickFromHopPool(pool, targets[hi]!, canonicalTarget, lexicalDedupeMax, rand);
		for (const g of got) {
			usedKeys.add(g.key);
			picks.push(g);
		}
	}

	let deficit = needNeighbors - picks.length;
	while (deficit > 0) {
		let progressed = false;
		const order = [2, 3, 1, 0];
		for (const hi of order) {
			if (deficit <= 0) break;
			const pool = hopPools[hi]!.filter((p) => !usedKeys.has(p.key));
			const one = pickFromHopPool(pool, 1, canonicalTarget, lexicalDedupeMax, rand)[0];
			if (one) {
				usedKeys.add(one.key);
				picks.push(one);
				deficit--;
				progressed = true;
			}
		}
		if (!progressed) break;
	}

	return picks;
}

export async function buildPuzzleNodesFromKaikkiAndConceptNet(
	db: PostgresJsDatabase<typeof dbSchema>,
	opts: {
		targetGerman: string;
		gridSize: number;
		lexicalDedupeMax: number;
		cnEdgeLimit?: number;
		/** @default 'all' */
		guessPoolMode?: GuessPoolMode;
		/** Fortschritt 0–100 für diese Phase (optional). */
		onProgress?: SeedProgressFn;
	}
): Promise<GeneratedPuzzleNode[]> {
	const { targetGerman, gridSize, lexicalDedupeMax, onProgress } = opts;
	const guessPoolMode: GuessPoolMode = opts.guessPoolMode ?? 'all';
	const edgeLimit = opts.cnEdgeLimit ?? 320;
	const needNeighbors = Math.max(0, gridSize - 1);

	const baseUrl = process.env.RCONCEPTNET_URL?.trim();
	if (!baseUrl) {
		throw new Error(
			'RCONCEPTNET_URL muss gesetzt sein (lokaler rconceptnet), damit Hop-Distanzen berechnet werden können.'
		);
	}

	if (needNeighbors === 0) {
		onProgress?.(100, 'Nur Zielwort (gridSize 1)');
		return [
			{
				lemma: targetGerman.trim(),
				x: 0,
				y: 0,
				similarity: 1,
				temperature: 'hot',
				isRevealNode: true
			}
		];
	}

	onProgress?.(4, 'Kaikki-Vokabular aus Datenbank lesen…');
	const vocabByKey = await loadVocabByKey(db);
	onProgress?.(8, `Vokabular: ${vocabByKey.size} Lemma-Schlüssel`);
	const targetKey = normalizeLemmaKey(targetGerman);
	if (!targetKey) throw new Error('targetGerman ist leer.');
	const canonicalTarget = vocabByKey.get(targetKey);
	if (!canonicalTarget) {
		throw new Error(
			`Ziel-Lemma ist nicht in der Datenbank (Kaikki-Import?). Fehlt: "${targetGerman.trim()}"`
		);
	}

	const rand = seededRand(hashSeed(canonicalTarget + '|hop|v1'));
	onProgress?.(10, 'ConceptNet Graph-Hops (BFS) …');
	const { dist } = await bfsHopDistances(
		baseUrl,
		canonicalTarget,
		targetKey,
		edgeLimit,
		vocabByKey,
		rand,
		onProgress,
		{ lo: 12, hi: 82 }
	);

	onProgress?.(84, 'Hop-Ringe auswählen und Lemmata ziehen…');
	const hopAlloc = allocateHopCounts(needNeighbors);

	const hopPoolsFull: HopPick[][] = [
		collectKaikkiAtHop(dist, vocabByKey, targetKey, 1),
		collectKaikkiAtHop(dist, vocabByKey, targetKey, 2),
		collectKaikkiAtHop(dist, vocabByKey, targetKey, 3),
		collectKaikkiAtHop(dist, vocabByKey, targetKey, 4)
	];

	const poolRes = await resolveGuessPoolAllowedKeys(db, canonicalTarget, guessPoolMode);
	const guessAttempts = poolRes.allowedKeys !== null ? 2 : 1;

	let picks: HopPick[] = [];
	for (let attempt = 0; attempt < guessAttempts; attempt++) {
		const useFiltered = attempt === 0 && poolRes.allowedKeys !== null;
		const hopPools = useFiltered
			? hopPoolsFull.map((pool) =>
					pool.filter((p) => lemmaKeyMatchesGuessPool(p.key, poolRes.allowedKeys))
				)
			: hopPoolsFull;

		picks = pickHopRingNeighbors(
			hopPools,
			needNeighbors,
			hopAlloc,
			canonicalTarget,
			lexicalDedupeMax,
			rand
		);

		if (picks.length >= needNeighbors) break;
		if (useFiltered) {
			console.warn(
				`[puzzle-grid] guessPool=${guessPoolMode} (${poolRes.detail}) — nur ${picks.length}/${needNeighbors} Treffer in Hop-Ringen, Fallback ungefiltert`
			);
		}
	}

	if (picks.length < needNeighbors) {
		throw new Error(
			`Zu wenige Kaikki-Lemmata in Hop-Ringen 1–4 (habe ${picks.length}, brauche ${needNeighbors}). ` +
				`RCONCEPTNET_URL prüfen oder cnEdgeLimit erhöhen / Kaikki-Import vergrößern.`
		);
	}

	if (picks.length > needNeighbors) picks = picks.slice(0, needNeighbors);

	onProgress?.(93, 'Snapshot-Knoten (Koordinaten, Temperaturen) …');
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
		const similarity = similarityForHop(p.hop, p.key);
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

	onProgress?.(100, `Gitter bereit (${nodes.length} Knoten)`);
	return nodes;
}
