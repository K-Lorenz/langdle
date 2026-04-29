import { db } from '$lib/server/db';
import { puzzles, tags, vocabulary as vocabularyTable, vocabularyTags } from '$lib/server/db/schema';
import { normalizeLemmaKey } from '$lib/game/normalize';
import { allowedGuessKeysFromPuzzle } from '$lib/game/puzzleAllowedGuesses';
import { shuffleStable } from '$lib/game/shuffle';
import type { PuzzleSnapshotNode } from '$lib/game/types';
import type { VocabularyTag } from '$lib/game/pageTypes';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

function vocabularyClientLimit(): number {
	const raw = env.VOCABULARY_CLIENT_LIMIT;
	const n = Number(raw !== undefined && raw !== '' ? raw : '6500');
	if (!Number.isFinite(n) || n < 500) return 6500;
	return Math.min(Math.floor(n), 50_000);
}

export const load = async () => {
	const today = toIsoDate(new Date());

	let puzzle;
	try {
		puzzle = await db.query.puzzles.findFirst({ where: eq(puzzles.puzzleDate, today) });
	} catch {
		return { puzzle: null, vocabulary: [], targetGermanKey: null };
	}

	if (!puzzle) return { puzzle: null, vocabulary: [], targetGermanKey: null };

	const vocabs = await db
		.select({ id: vocabularyTable.id, lemma: vocabularyTable.lemma })
		.from(vocabularyTable)
		.where(eq(vocabularyTable.isActive, true));

	const tagRows = await db
		.select({
			vocabularyId: vocabularyTags.vocabularyId,
			layer: tags.layer,
			slug: tags.slug,
			label: tags.label
		})
		.from(vocabularyTags)
		.innerJoin(tags, eq(tags.id, vocabularyTags.tagId));

	const tagsByVocabId = new Map<number, VocabularyTag[]>();
	for (const r of tagRows) {
		const list = tagsByVocabId.get(r.vocabularyId) ?? [];
		list.push({
			layer: r.layer,
			slug: r.slug,
			label: r.label
		});
		tagsByVocabId.set(r.vocabularyId, list);
	}

	const fullVocabulary = vocabs.map((v) => ({
		id: v.id,
		lemma: v.lemma,
		key: normalizeLemmaKey(v.lemma),
		tags: tagsByVocabId.get(v.id) ?? []
	}));

	const allowedKeys = allowedGuessKeysFromPuzzle(puzzle);
	const guessPool = fullVocabulary.filter((v) => allowedKeys.has(v.key));

	const cap = vocabularyClientLimit();
	const vocabularyPayload =
		guessPool.length <= cap ? guessPool : shuffleStable(guessPool, puzzle.id).slice(0, cap);

	const nodes: PuzzleSnapshotNode[] = puzzle.snapshot.nodes.map((n) => ({
		lemma: n.lemma,
		lemmaNormalizedKey: normalizeLemmaKey(n.lemma),
		x: n.x,
		y: n.y,
		similarity: n.similarity,
		temperature: n.temperature,
		...(n.isRevealNode ? { isRevealNode: true } : {})
	}));

	const puzzlePayload = {
		id: puzzle.id,
		number: puzzle.puzzleNumber,
		date: puzzle.puzzleDate,
		targetForeign: puzzle.targetForeign,
		targetGermanCanonical: puzzle.targetGermanCanonical,
		targetGermanKey: normalizeLemmaKey(puzzle.targetGermanCanonical),
		snapshot: {
			vocabularySize: puzzle.snapshot.vocabularySize,
			nodes
		}
	};

	return {
		puzzle: puzzlePayload,
		vocabulary: vocabularyPayload,
		targetGermanKey: puzzlePayload.targetGermanKey
	};
};
