import { json, error, type RequestHandler } from '@sveltejs/kit';

import { normalizeLemmaKey } from '$lib/game/normalize';
import { conceptNetEdgesAmongLemmaPairs } from '$lib/server/conceptNet';

type Body = {
	lemmas?: unknown;
};

export const POST: RequestHandler = async ({ request }) => {
	let body: Body;
	try {
		body = (await request.json()) as Body;
	} catch {
		throw error(400, 'Bad JSON');
	}

	const raw = body.lemmas;
	if (!Array.isArray(raw)) throw error(400, 'Expected lemmas array');

	const byKey = new Map<string, string>();
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const o = item as { key?: unknown; lemma?: unknown };
		const lemmaStr = typeof o.lemma === 'string' ? o.lemma : '';
		const key =
			typeof o.key === 'string' ? normalizeLemmaKey(o.key) : normalizeLemmaKey(lemmaStr);
		if (!key) continue;
		if (!byKey.has(key)) byKey.set(key, lemmaStr.trim() || key);
	}
	const pairs = [...byKey.entries()].map(([key, lemma]) => ({ key, lemma }));

	if (pairs.length > 22) throw error(422, 'Too many lemmas');

	try {
		const edges = await conceptNetEdgesAmongLemmaPairs(pairs);
		return json({ edges });
	} catch (e) {
		console.error('conceptnet graph', e);
		throw error(502, 'ConceptNet unavailable');
	}
};
