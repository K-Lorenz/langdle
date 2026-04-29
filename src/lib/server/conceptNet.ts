import { env } from '$env/dynamic/private';
import { normalizeLemmaKey } from '$lib/game/normalize';
import {
	fetchRconceptnetEdges,
	lemmaFromGermanConceptUri,
	rconceptnetRelatedness01,
	type RconceptnetEdgeRow
} from '$lib/server/conceptNetLocal';

const CN_QUERY = 'https://api.conceptnet.io/query';

/** Nur Kanten ins Deutsche — keine Übersetzungen ins Englische o. Ä. */
const GERMAN_PREFIX = '/c/de/';

const SKIP_REL = new Set([
	'/r/ExternalURL',
	'/r/Dataset',
	'/r/CreativeWorkHasPublisher'
]);

export type ConceptNetGraphEdge = {
	fromKey: string;
	toKey: string;
	rel: string;
	weight: number;
};

type CnUriObj = {
	'@id'?: string;
	label?: string;
	language?: string;
};

type CnEdge = {
	'@id'?: string;
	rel?: CnUriObj;
	start?: CnUriObj;
	end?: CnUriObj;
	weight?: number;
};

type CnQueryBody = {
	edges?: CnEdge[];
};

/** ConceptNet-Knotenpfadsegment aus dem angezeigten Lemma (Unicode, Unterstriche). */
export function conceptNetGermanUri(lemma: string): string | null {
	const raw = lemma.trim().toLowerCase();
	if (!raw) return null;
	const underscored = raw.replace(/\s+/g, '_');
	return `${GERMAN_PREFIX}${underscored}`;
}

function normalizeCnUri(uri: string): string {
	return uri.replace(/\/+$/, '');
}

function relLabel(rel: CnUriObj | undefined): string {
	const id = rel?.['@id'];
	if (!id) return '?';
	const parts = id.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? id;
}

function isGermanConcept(uri: string | undefined): boolean {
	return !!uri && uri.startsWith(GERMAN_PREFIX);
}

function mapRconceptnetRowsToCnEdges(rows: RconceptnetEdgeRow[]): CnEdge[] {
	const out: CnEdge[] = [];
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i]!;
		const relId = r.relation_uri?.trim() || `/r/${(r.relation ?? 'RelatedTo').replace(/^\//, '')}`;
		let sid = r.start_uri?.trim();
		let eid = r.end_uri?.trim();
		if (!sid && r.start_label) sid = conceptNetGermanUri(r.start_label.replace(/_/g, ' ')) ?? undefined;
		if (!eid && r.end_label) eid = conceptNetGermanUri(r.end_label.replace(/_/g, ' ')) ?? undefined;
		if (!sid || !eid) continue;
		out.push({
			'@id': `local-${i}-${sid}-${eid}`,
			rel: { '@id': relId },
			start: {
				'@id': sid,
				label: r.start_label?.replace(/_/g, ' ')
			},
			end: {
				'@id': eid,
				label: r.end_label?.replace(/_/g, ' ')
			},
			weight: typeof r.weight === 'number' && Number.isFinite(r.weight) ? r.weight : undefined
		});
	}
	return out;
}

async function fetchCnQuery(searchParams: Record<string, string>): Promise<CnEdge[]> {
	const url = `${CN_QUERY}?${new URLSearchParams(searchParams)}`;
	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), 12_000);
	const res = await fetch(url, {
		headers: { Accept: 'application/json' },
		signal: ac.signal
	}).finally(() => clearTimeout(t));
	if (!res.ok) return [];
	const body = (await res.json()) as CnQueryBody;
	return Array.isArray(body.edges) ? body.edges : [];
}

async function edgesTouchingGerman(uri: string): Promise<CnEdge[]> {
	const localBase = env.RCONCEPTNET_URL?.trim();
	if (localBase) {
		const lemma = lemmaFromGermanConceptUri(uri);
		if (lemma) {
			const rows = await fetchRconceptnetEdges(localBase, lemma, 'de');
			return mapRconceptnetRowsToCnEdges(rows);
		}
	}

	const [fromStart, fromEnd] = await Promise.all([
		fetchCnQuery({ start: uri, limit: '120' }),
		fetchCnQuery({ end: uri, limit: '120' })
	]);
	const seen = new Set<string>();
	const out: CnEdge[] = [];
	for (const e of [...fromStart, ...fromEnd]) {
		const id = e['@id'];
		if (id && seen.has(id)) continue;
		if (id) seen.add(id);
		out.push(e);
	}
	return out;
}

function otherGermanEndpoint(edge: CnEdge, pivotUri: string): CnUriObj | null {
	const p = normalizeCnUri(pivotUri);
	const sa = edge.start?.['@id'];
	const ea = edge.end?.['@id'];
	if (!sa || !ea) return null;
	const ns = normalizeCnUri(sa);
	const ne = normalizeCnUri(ea);
	if (ns === p && isGermanConcept(ne)) return edge.end ?? null;
	if (ne === p && isGermanConcept(ns)) return edge.start ?? null;
	return null;
}

/**
 * Für jedes geratene Lemma Kanten zu anderen geratenen Lemmata,
 * soweit ConceptNet einen deutschsprachigen Bezug meldet.
 */
export async function conceptNetEdgesAmongLemmaPairs(
	pairs: readonly { key: string; lemma: string }[],
	delayMs = env.RCONCEPTNET_URL?.trim() ? 0 : 120
): Promise<ConceptNetGraphEdge[]> {
	const cleaned = pairs.filter((p) => p.key && p.lemma.trim());
	if (cleaned.length < 2) return [];

	const keySet = new Set(cleaned.map((p) => p.key));
	const merged = new Map<string, ConceptNetGraphEdge>();

	function upsert(fromKey: string, toKey: string, rel: string, weight: number) {
		const [a, b] = fromKey < toKey ? [fromKey, toKey] : [toKey, fromKey];
		const pairKey = `${a}\t${b}`;
		const prev = merged.get(pairKey);
		if (!prev || weight > prev.weight) {
			merged.set(pairKey, { fromKey: a, toKey: b, rel: rel || '?', weight });
		}
	}

	for (let i = 0; i < cleaned.length; i++) {
		const { key: pivotKey, lemma } = cleaned[i]!;
		const uri = conceptNetGermanUri(lemma);
		if (!uri) continue;

		let edges: CnEdge[];
		try {
			edges = await edgesTouchingGerman(uri);
		} catch {
			edges = [];
		}

		for (const edge of edges) {
			const rid = edge.rel?.['@id'];
			const ridNorm = rid ? normalizeCnUri(rid) : '';
			if (ridNorm && [...SKIP_REL].some((s) => ridNorm === normalizeCnUri(s))) continue;

			const other = otherGermanEndpoint(edge, uri);
			if (!other?.label) continue;

			const otherKey = normalizeLemmaKey(other.label.replace(/_/g, ' '));
			if (!otherKey || otherKey === pivotKey || !keySet.has(otherKey)) continue;

			const rel = relLabel(edge.rel);
			const weight =
				typeof edge.weight === 'number' && Number.isFinite(edge.weight)
					? edge.weight
					: 1;

			upsert(pivotKey, otherKey, rel, weight);
		}

		if (i < cleaned.length - 1 && delayMs > 0) {
			await new Promise((r) => setTimeout(r, delayMs));
		}
	}

	return [...merged.values()].sort((a, b) => b.weight - a.weight);
}

const RELATEDNESS_URL = 'https://api.conceptnet.io/relatedness';

/** Kurzes Timeout: Relatedness ist nur Zusatz; Fallback übernimmt ohne Blockierung. */
const RELATEDNESS_TIMEOUT_MS = 1_200;

const relatednessCache = new Map<string, number | null>();
const RELATEDNESS_CACHE_CAP = 12_000;

function cacheRelatednessGet(key: string): number | null | undefined {
	return relatednessCache.get(key);
}

function cacheRelatednessSet(key: string, v: number | null): void {
	if (relatednessCache.size >= RELATEDNESS_CACHE_CAP) {
		const first = relatednessCache.keys().next().value as string | undefined;
		if (first !== undefined) relatednessCache.delete(first);
	}
	relatednessCache.set(key, v);
}

/** ConceptNet „Relatedness“ → [0, 1]. Bei API-Fehler `null`. */
export async function conceptNetRelatedness01(
	lemmaA: string,
	lemmaB: string
): Promise<number | null> {
	const u1 = conceptNetGermanUri(lemmaA);
	const u2 = conceptNetGermanUri(lemmaB);
	if (!u1 || !u2) return null;
	const cacheKey = `${u1}\t${u2}`;
	const hit = cacheRelatednessGet(cacheKey);
	if (hit !== undefined) return hit;

	const localBase = env.RCONCEPTNET_URL?.trim();
	if (localBase) {
		try {
			const local = await rconceptnetRelatedness01(localBase, lemmaA, lemmaB);
			if (local != null) {
				cacheRelatednessSet(cacheKey, local);
				return local;
			}
		} catch {
			/* öffentliche API versuchen */
		}
	}

	const url = `${RELATEDNESS_URL}?node1=${encodeURIComponent(u1)}&node2=${encodeURIComponent(u2)}`;
	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), RELATEDNESS_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			headers: {
				Accept: 'application/json',
				'User-Agent': 'langdle/1 (puzzle game; +https://github.com/)'
			},
			signal: ac.signal
		});
		if (!res.ok) {
			cacheRelatednessSet(cacheKey, null);
			return null;
		}
		const ct = res.headers.get('content-type') ?? '';
		if (!ct.includes('json')) {
			cacheRelatednessSet(cacheKey, null);
			return null;
		}
		const data = (await res.json()) as { value?: number };
		const v = data.value;
		if (typeof v !== 'number' || !Number.isFinite(v)) {
			cacheRelatednessSet(cacheKey, null);
			return null;
		}
		let out: number;
		if (v >= 0 && v <= 1) out = Math.max(0, Math.min(1, v));
		else {
			const c = Math.max(-1, Math.min(1, v));
			out = (c + 1) / 2;
		}
		cacheRelatednessSet(cacheKey, out);
		return out;
	} catch {
		cacheRelatednessSet(cacheKey, null);
		return null;
	} finally {
		clearTimeout(t);
	}
}
