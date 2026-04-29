/**
 * Optional: lokaler ConceptNet-Clone via [rconceptnet](https://github.com/knadh/rconceptnet) (`rconceptnet serve`).
 * Liefert Kanten wie die öffentliche ConceptNet-API und eine heuristische Relatedness [0,1]
 * (direkte Kante + Jaccard der 1-Hop-Nachbarn), da es keinen /relatedness-Endpunkt gibt.
 */

import { normalizeLemmaKey } from '../game/normalize';

const GERMAN_PREFIX = '/c/de/';

export type RconceptnetEdgeRow = {
	relation?: string;
	relation_uri?: string;
	start_label?: string;
	start_uri?: string;
	end_label?: string;
	end_uri?: string;
	weight?: number;
};

function labelKey(raw: string): string {
	return normalizeLemmaKey(raw.replace(/_/g, ' '));
}

function normalizeBaseUrl(raw: string): string {
	const t = raw.trim().replace(/\/+$/, '');
	return t || '';
}

/** Lemma aus `/c/de/foo_bar` für Abfragen (Leerzeichen). */
export function lemmaFromGermanConceptUri(uri: string): string | null {
	if (!uri.startsWith(GERMAN_PREFIX)) return null;
	const tail = uri.slice(GERMAN_PREFIX.length).replace(/_/g, ' ');
	return tail.trim() ? tail : null;
}

export async function fetchRconceptnetEdges(
	baseUrl: string,
	lemma: string,
	lang: string,
	limit = 120,
	timeoutMs = 4_000
): Promise<RconceptnetEdgeRow[]> {
	const base = normalizeBaseUrl(baseUrl);
	if (!base) return [];
	const u = new URL(`${base}/`);
	u.searchParams.set('query', lemma.trim());
	u.searchParams.set('lang', lang);
	u.searchParams.set('limit', String(limit));

	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), timeoutMs);
	try {
		const res = await fetch(u.toString(), {
			signal: ac.signal,
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) return [];
		const ct = res.headers.get('content-type') ?? '';
		if (!ct.includes('json')) return [];
		const data = (await res.json()) as unknown;
		return Array.isArray(data) ? (data as RconceptnetEdgeRow[]) : [];
	} catch {
		return [];
	} finally {
		clearTimeout(t);
	}
}

/** Nachbar-Schlüssel (normalisiert) für lokale Kanten-Zeilen — u. a. für Seed-BFS. */
export function neighborKeys(rows: RconceptnetEdgeRow[], pivotKey: string): Set<string> {
	const out = new Set<string>();
	for (const r of rows) {
		const sl = r.start_label ? labelKey(r.start_label) : '';
		const el = r.end_label ? labelKey(r.end_label) : '';
		if (!sl || !el) continue;
		if (sl === pivotKey && el !== pivotKey) out.add(el);
		else if (el === pivotKey && sl !== pivotKey) out.add(sl);
	}
	return out;
}

function bestDirectWeight(rows: RconceptnetEdgeRow[], aKey: string, bKey: string): number {
	let best = 0;
	for (const r of rows) {
		const sl = r.start_label ? labelKey(r.start_label) : '';
		const el = r.end_label ? labelKey(r.end_label) : '';
		if (!sl || !el) continue;
		if ((sl === aKey && el === bKey) || (sl === bKey && el === aKey)) {
			const w = typeof r.weight === 'number' && Number.isFinite(r.weight) ? r.weight : 1;
			best = Math.max(best, w);
		}
	}
	return best;
}

/**
 * Relatedness aus lokalem Graph: direkte Kante (gewichtet) oder Jaccard der Nachbarschaften.
 * `null`, wenn kaum Daten vorliegen.
 */
export async function rconceptnetRelatedness01(
	baseUrl: string,
	lemmaA: string,
	lemmaB: string
): Promise<number | null> {
	const ka = labelKey(lemmaA);
	const kb = labelKey(lemmaB);
	if (!ka || !kb) return null;
	if (ka === kb) return 1;

	const [edgesA, edgesB] = await Promise.all([
		fetchRconceptnetEdges(baseUrl, lemmaA, 'de'),
		fetchRconceptnetEdges(baseUrl, lemmaB, 'de')
	]);

	const direct = Math.max(
		bestDirectWeight(edgesA, ka, kb),
		bestDirectWeight(edgesB, ka, kb)
	);

	const na = neighborKeys(edgesA, ka);
	const nb = neighborKeys(edgesB, kb);
	let jaccard = 0;
	if (na.size > 0 && nb.size > 0) {
		let inter = 0;
		for (const x of na) {
			if (nb.has(x)) inter += 1;
		}
		const union = na.size + nb.size - inter;
		jaccard = union > 0 ? inter / union : 0;
	}

	let score = 0;
	if (direct > 0) {
		const nw = Math.min(direct / 5, 1);
		score = Math.max(score, 0.42 + 0.58 * nw);
	}
	if (jaccard > 0) {
		score = Math.max(score, 0.08 + 0.92 * jaccard);
	}

	if (score <= 0) return null;
	return Math.min(1, score);
}
