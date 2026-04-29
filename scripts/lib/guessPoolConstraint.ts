/**
 * Optional Einschränkung der Gitter-Kandidaten beim Seed (gleiche Wortart oder gemeinsames Kaikki-Tag).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';

import { normalizeLemmaKey } from '../../src/lib/game/normalize.ts';
import {
	vocabulary as vocabularyTable,
	vocabularyTags
} from '../../src/lib/server/db/schema.ts';
import * as dbSchema from '../../src/lib/server/db/schema.ts';

export type GuessPoolMode = 'all' | 'same_pos' | 'shared_tag';

export type GuessPoolResolution = {
	/** null = keine Einschränkung */
	allowedKeys: Set<string> | null;
	/** Kurzgrund für Logs */
	detail: string;
};

/**
 * Lemmata-Schlüssel, die für guessPoolMode erlaubt sind (inkl. Ziellemma).
 * Bei fehlenden Metadaten am Zielwort: keine Einschränkung (wie `all`).
 */
export async function resolveGuessPoolAllowedKeys(
	db: PostgresJsDatabase<typeof dbSchema>,
	canonicalTargetLemma: string,
	mode: GuessPoolMode
): Promise<GuessPoolResolution> {
	if (mode === 'all') {
		return { allowedKeys: null, detail: 'guessPool=all' };
	}

	const targetLemma = canonicalTargetLemma.trim();
	if (!normalizeLemmaKey(targetLemma)) {
		return { allowedKeys: null, detail: 'leeres Ziellemma — Pool ungefiltert' };
	}

	const [targetRow] = await db
		.select({
			id: vocabularyTable.id,
			primaryPos: vocabularyTable.primaryPos
		})
		.from(vocabularyTable)
		.where(eq(vocabularyTable.lemma, targetLemma))
		.limit(1);

	if (!targetRow) {
		return {
			allowedKeys: null,
			detail: 'Ziellemma nicht in vocabulary — Pool ungefiltert'
		};
	}

	if (mode === 'same_pos') {
		const pos = targetRow.primaryPos?.trim();
		if (!pos) {
			return {
				allowedKeys: null,
				detail: 'same_pos: Ziel ohne primary_pos — Pool ungefiltert'
			};
		}

		const rows = await db
			.select({ lemma: vocabularyTable.lemma })
			.from(vocabularyTable)
			.where(eq(vocabularyTable.primaryPos, pos));

		const keys = new Set<string>();
		for (const { lemma } of rows) {
			const k = normalizeLemmaKey(lemma);
			if (k) keys.add(k);
		}
		if (keys.size <= 1) {
			return {
				allowedKeys: null,
				detail: `same_pos:${pos} — nur Zielwort, Pool ungefiltert`
			};
		}
		return {
			allowedKeys: keys,
			detail: `same_pos:${pos} (${keys.size} Lemmata)`
		};
	}

	// shared_tag
	const tagRows = await db
		.select({ tagId: vocabularyTags.tagId })
		.from(vocabularyTags)
		.where(eq(vocabularyTags.vocabularyId, targetRow.id));

	const tagIds = tagRows.map((r) => r.tagId);
	if (tagIds.length === 0) {
		return {
			allowedKeys: null,
			detail: 'shared_tag: Ziel ohne Tags — Pool ungefiltert'
		};
	}

	const shared = await db
		.selectDistinct({ lemma: vocabularyTable.lemma })
		.from(vocabularyTags)
		.innerJoin(vocabularyTable, eq(vocabularyTable.id, vocabularyTags.vocabularyId))
		.where(inArray(vocabularyTags.tagId, tagIds));

	const keys = new Set<string>();
	for (const { lemma } of shared) {
		const k = normalizeLemmaKey(lemma);
		if (k) keys.add(k);
	}

	if (keys.size <= 1) {
		return {
			allowedKeys: null,
			detail: 'shared_tag: nur Zielwort — Pool ungefiltert'
		};
	}

	return {
		allowedKeys: keys,
		detail: `shared_tag:${tagIds.length} Tag(s), ${keys.size} Lemmata`
	};
}

/** Filter anwenden; null-Set = alles erlaubt. Leeres Set = nichts erlaubt (Caller soll Fallback nutzen). */
export function lemmaKeyMatchesGuessPool(
	key: string,
	allowedKeys: Set<string> | null
): boolean {
	if (allowedKeys === null) return true;
	return allowedKeys.has(key);
}
