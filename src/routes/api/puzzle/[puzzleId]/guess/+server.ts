import { error, json, type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

import { embeddingSimilarity01 } from '$lib/game/embeddingSimilarity';
import { normalizeLemmaKey } from '$lib/game/normalize';
import { allowedGuessKeysFromPuzzle } from '$lib/game/puzzleAllowedGuesses';
import { lexicalSimilarity01 } from '$lib/game/lexicalSimilarity';
import {
	calibrateSyntheticSimilarity,
	polarXYFromSimilarity,
	temperatureFromSimilarity,
	temperatureFromSyntheticSimilarity
} from '$lib/game/syntheticLayout';
import { similarityRankAcrossSnapshot, snapshotNodeByLemmaKey } from '$lib/game/snapshot';
import type { Temperature } from '$lib/game/types';
import { conceptNetRelatedness01 } from '$lib/server/conceptNet';
import { db } from '$lib/server/db';
import { guesses, puzzles, vocabulary as vocabularyTable } from '$lib/server/db/schema';

type Body = {
	lemma?: string;
};

export const POST: RequestHandler = async ({ params, request }) => {
	const puzzleId = Number.parseInt(String(params.puzzleId), 10);
	if (!Number.isFinite(puzzleId)) throw error(400, 'Bad puzzle');

	let body: Body;
	try {
		body = (await request.json()) as Body;
	} catch {
		throw error(400, 'Bad JSON');
	}

	const key = normalizeLemmaKey(String(body.lemma ?? ''));
	if (!key) throw error(422, 'Leer');

	const puzzle = await db.query.puzzles.findFirst({ where: eq(puzzles.id, puzzleId) });
	if (!puzzle) throw error(404, 'Puzzle nicht gefunden');

	const vocabRows = await db
		.select({
			id: vocabularyTable.id,
			lemma: vocabularyTable.lemma,
			embedding: vocabularyTable.embedding
		})
		.from(vocabularyTable)
		.where(eq(vocabularyTable.isActive, true));

	const vocabRow = vocabRows.find((v) => normalizeLemmaKey(v.lemma) === key);
	if (!vocabRow) return json({ ok: false, reason: 'not_in_vocab' }, { status: 400 });

	const allowedKeys = allowedGuessKeysFromPuzzle(puzzle);
	if (!allowedKeys.has(key)) return json({ ok: false, reason: 'not_in_vocab' }, { status: 400 });

	const nodesPlain = puzzle.snapshot.nodes.map((n) => ({
		lemma: n.lemma,
		lemmaNormalizedKey: normalizeLemmaKey(n.lemma),
		x: n.x,
		y: n.y,
		similarity: n.similarity,
		temperature: n.temperature,
		...(n.isRevealNode ? { isRevealNode: true as const } : {})
	}));

	const ix = snapshotNodeByLemmaKey(nodesPlain);
	const node = ix.get(key);

	if (node) {
		const cosineSimilarity = node.similarity;
		const rankGuess = similarityRankAcrossSnapshot(nodesPlain, key) ?? 0;

		await db.insert(guesses).values({
			puzzleId,
			vocabularyId: vocabRow.id,
			cosineSimilarity,
			rank: rankGuess
		});

		return json({
			ok: true as const,
			layout: 'snapshot' as const,
			similarity: cosineSimilarity,
			rank: rankGuess,
			temperature: node.temperature
		});
	}

	const lexical = lexicalSimilarity01(puzzle.targetGermanCanonical, vocabRow.lemma);
	const similaritySource = puzzle.snapshot.similaritySource ?? 'conceptnet';

	const targetRow = vocabRows.find(
		(v) => normalizeLemmaKey(v.lemma) === normalizeLemmaKey(puzzle.targetGermanCanonical)
	);
	const guessEmb = vocabRow.embedding;
	const targetEmb = targetRow?.embedding;
	const embOk = (e: unknown): e is number[] =>
		Array.isArray(e) && e.length > 0 && e.every((x) => typeof x === 'number' && Number.isFinite(x));

	let similarity: number;
	let temperature: Temperature;
	if (similaritySource === 'embedding' && embOk(targetEmb) && embOk(guessEmb)) {
		similarity = embeddingSimilarity01(targetEmb, guessEmb);
		temperature = temperatureFromSimilarity(similarity);
	} else {
		const simRaw = await conceptNetRelatedness01(puzzle.targetGermanCanonical, vocabRow.lemma);
		if (simRaw != null) {
			/* ConceptNet liefert Semantik; lexikalische Nähe nur leicht mischen (sonst zu viele Stamm-/Flexions-Treffer). */
			const blended = 0.9 * simRaw + 0.1 * lexical;
			similarity = calibrateSyntheticSimilarity(blended);
			temperature = temperatureFromSyntheticSimilarity(similarity);
		} else {
			similarity = lexical;
			temperature = temperatureFromSimilarity(similarity);
		}
	}
	const { x, y } = polarXYFromSimilarity(key, similarity);

	const syntheticRow = {
		lemma: vocabRow.lemma,
		lemmaNormalizedKey: key,
		x,
		y,
		similarity,
		temperature
	};
	const rankGuess =
		similarityRankAcrossSnapshot([...nodesPlain, syntheticRow], key) ?? nodesPlain.length + 1;

	await db.insert(guesses).values({
		puzzleId,
		vocabularyId: vocabRow.id,
		cosineSimilarity: similarity,
		rank: rankGuess
	});

	const layout =
		similaritySource === 'embedding' && embOk(targetEmb) && embOk(guessEmb)
			? ('embedding' as const)
			: ('conceptnet' as const);

	return json({
		ok: true as const,
		layout,
		similarity,
		rank: rankGuess,
		temperature,
		x,
		y,
		lemma: vocabRow.lemma
	});
};
