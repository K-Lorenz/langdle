/**
 * ConceptNet-Kanten für Seed-Skripte (ohne SvelteKit-$env).
 * Nutzt `RCONCEPTNET_URL` wenn gesetzt, sonst api.conceptnet.io/query.
 */
import { normalizeLemmaKey } from '../../src/lib/game/normalize.ts';

const GERMAN_PREFIX = '/c/de/';
const CN_QUERY = 'https://api.conceptnet.io/query';

const SKIP_REL = new Set(['/r/ExternalURL', '/r/Dataset', '/r/CreativeWorkHasPublisher']);

export type RconceptnetEdgeRow = {
	relation?: string;
	relation_uri?: string;
	start_label?: string;
	start_uri?: string;
	end_label?: string;
	end_uri?: string;
	weight?: number;
};

function normalizeBaseUrl(raw: string): string {
	const t = raw.trim().replace(/\/+$/, '');
	return t || '';
}

export function conceptNetGermanUri(lemma: string): string | null {
	const raw = lemma.trim().toLowerCase();
	if (!raw) return null;
	const underscored = raw.replace(/\s+/g, '_');
	return `${GERMAN_PREFIX}${underscored}`;
}

/** Lemma aus `/c/de/foo_bar` für Abfragen (Leerzeichen). */
export function lemmaFromGermanConceptUri(uri: string): string | null {
	if (!uri.startsWith(GERMAN_PREFIX)) return null;
	const tail = uri.slice(GERMAN_PREFIX.length).replace(/_/g, ' ');
	return tail.trim() ? tail : null;
}

async function fetchRconceptnetEdgesLocal(
	baseUrl: string,
	lemma: string,
	lang: string,
	limit: number,
	timeoutMs = 8_000
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
			start: { '@id': sid, label: r.start_label?.replace(/_/g, ' ') },
			end: { '@id': eid, label: r.end_label?.replace(/_/g, ' ') },
			weight: typeof r.weight === 'number' && Number.isFinite(r.weight) ? r.weight : undefined
		});
	}
	return out;
}

type CnUriObj = { '@id'?: string; label?: string };
type CnEdge = {
	'@id'?: string;
	rel?: CnUriObj;
	start?: CnUriObj;
	end?: CnUriObj;
	weight?: number;
};
type CnQueryBody = { edges?: CnEdge[] };

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

export async function edgesTouchingGermanLemma(
	lemma: string,
	opts?: { limit?: number }
): Promise<CnEdge[]> {
	const uri = conceptNetGermanUri(lemma);
	if (!uri) return [];
	const limit = opts?.limit ?? 240;

	const localBase = process.env.RCONCEPTNET_URL?.trim();
	if (localBase) {
		const rows = await fetchRconceptnetEdgesLocal(localBase, lemma, 'de', limit);
		return mapRconceptnetRowsToCnEdges(rows);
	}

	const limitStr = String(Math.min(limit, 500));
	const [fromStart, fromEnd] = await Promise.all([
		fetchCnQuery({ start: uri, limit: limitStr }),
		fetchCnQuery({ end: uri, limit: limitStr })
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

export type WeightedNeighbor = { lemma: string; weight: number; rel: string };

export function neighborsFromEdges(edges: CnEdge[], pivotUri: string): WeightedNeighbor[] {
	const out: WeightedNeighbor[] = [];
	for (const edge of edges) {
		const rid = edge.rel?.['@id'];
		const ridNorm = rid ? normalizeCnUri(rid) : '';
		if (ridNorm && [...SKIP_REL].some((s) => ridNorm === normalizeCnUri(s))) continue;

		const other = otherGermanEndpoint(edge, pivotUri);
		if (!other?.label) continue;

		const weight =
			typeof edge.weight === 'number' && Number.isFinite(edge.weight) ? edge.weight : 1;
		const rel = relLabel(edge.rel);
		out.push({
			lemma: other.label.replace(/_/g, ' ').trim(),
			weight,
			rel
		});
	}
	return out;
}

/** Aggregiert Nachbarn pro normalisiertem Lemma (max. Gewicht). */
export function mergeNeighborWeights(rows: WeightedNeighbor[]): Map<string, number> {
	const m = new Map<string, number>();
	for (const { lemma, weight } of rows) {
		const k = normalizeLemmaKey(lemma);
		if (!k) continue;
		m.set(k, Math.max(m.get(k) ?? 0, weight));
	}
	return m;
}
