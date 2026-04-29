/**
 * Schreibt das Tagesrätsel (UTC-Datum) mit dem Cluster-Demo-Snapshot aus `fixtures/clusterDemo.ts`.
 * Stammdaten (Sprachen/Länder) müssen existieren — bei leerer DB zuerst `npm run db:seed` ausführen.
 */
import * as crypto from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';

import {
	countries as countriesTable,
	languages as languagesTable,
	puzzleCountries,
	puzzles,
	vocabulary as vocabularyTable
} from '../src/lib/server/db/schema.ts';
import { slugFromLemma } from '../src/lib/game/normalize.ts';
import {
	CLUSTER_DEMO_WORDS,
	CLUSTER_DEMO_PRELOAD_KEYS_IN_ORDER
} from './fixtures/clusterDemo.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv(): void {
	const envPath = resolve(__dirname, '../.env');
	if (!existsSync(envPath)) return;
	const text = readFileSync(envPath, 'utf8');
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) continue;
		const key = trimmed.slice(0, eqIndex).trim();
		let value = trimmed.slice(eqIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (process.env[key] === undefined) process.env[key] = value;
	}
}

loadDotEnv();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('DATABASE_URL unset. Add it to .env');
	process.exit(1);
}

function utcIsoDate(now = new Date()): string {
	return now.toISOString().slice(0, 10);
}

async function main() {
	const client = postgres(DATABASE_URL);
	const db = drizzle(client);

	const [finnish] = await db
		.select({ id: languagesTable.id })
		.from(languagesTable)
		.where(eq(languagesTable.iso639_3, 'fin'));

	if (!finnish) {
		console.error('Sprache „Finnisch“ (fin) fehlt — bitte zuerst `npm run db:seed` ausführen.');
		await client.end();
		process.exit(1);
	}

	const extraVocabLemmas = ['gefunden', 'geraten', 'Versuch'];

	for (const w of CLUSTER_DEMO_WORDS) {
		const slug = slugFromLemma(w.lemma);
		await db
			.insert(vocabularyTable)
			.values({ lemma: w.lemma, slug, isActive: true })
			.onConflictDoUpdate({
				target: vocabularyTable.slug,
				set: { lemma: sql`excluded.lemma`, isActive: true }
			});
	}

	for (const lemma of extraVocabLemmas) {
		const slug = slugFromLemma(lemma);
		await db
			.insert(vocabularyTable)
			.values({ lemma, slug, isActive: true })
			.onConflictDoNothing();
	}

	const today = utcIsoDate();
	const vocabSizeRow = await db
		.select({ c: sql<number>`count(*)::int` })
		.from(vocabularyTable)
		.where(eq(vocabularyTable.isActive, true));
	const vocabularySize = vocabSizeRow[0]?.c ?? CLUSTER_DEMO_WORDS.length;

	const snapshot = {
		vocabularySize,
		nodes: CLUSTER_DEMO_WORDS.map((w) => ({
			lemma: w.lemma,
			x: w.x,
			y: w.y,
			similarity: w.similarity,
			temperature: w.temperature,
			...(w.isRevealNode ? { isRevealNode: true } : {})
		}))
	};

	const puzzleNumberSeed = crypto.createHash('sha256').update(`${today}:cluster-demo`).digest()[0]! % 90_000 + 1;

	await db
		.insert(puzzles)
		.values({
			puzzleNumber: puzzleNumberSeed,
			puzzleDate: today,
			targetForeign: 'kiitos',
			targetGermanCanonical: 'danke',
			languageId: finnish.id,
			snapshotVersion: 1,
			snapshot
		})
		.onConflictDoUpdate({
			target: puzzles.puzzleDate,
			set: {
				targetForeign: sql`excluded.target_foreign`,
				targetGermanCanonical: sql`excluded.target_german_canonical`,
				languageId: sql`excluded.language_id`,
				snapshotVersion: sql`excluded.snapshot_version`,
				snapshot: sql`excluded.snapshot`,
				puzzleNumber: sql`excluded.puzzle_number`
			}
		});

	const [puzzleRow] = await db
		.select({ id: puzzles.id })
		.from(puzzles)
		.where(eq(puzzles.puzzleDate, today))
		.limit(1);

	if (!puzzleRow) throw new Error('Puzzle konnte nicht ermittelt werden');

	const fi = await db
		.select({ id: countriesTable.id })
		.from(countriesTable)
		.where(eq(countriesTable.iso2, 'FI'))
		.limit(1);
	const at = await db
		.select({ id: countriesTable.id })
		.from(countriesTable)
		.where(eq(countriesTable.iso2, 'AT'))
		.limit(1);

	for (const row of [...fi, ...at]) {
		await db.insert(puzzleCountries).values({ puzzleId: puzzleRow.id, countryId: row.id }).onConflictDoNothing();
	}

	await client.end();

	const preloadPayload = JSON.stringify({
		v: 1 as const,
		guessedLemmaKeysInOrder: CLUSTER_DEMO_PRELOAD_KEYS_IN_ORDER,
		mainSolved: false,
		bonusLanguageSolved: false,
		bonusCountrySolved: false
	});

	console.log('');
	console.log('Cluster-Demo Seed OK');
	console.log(`  Datum (UTC): ${today}`);
	console.log(`  Puzzle-ID:   ${puzzleRow.id}`);
	console.log('');
	console.log('Optional — gespeicherten Wolken-Zustand sofort laden (DevTools-Konsole auf dieser Origin):');
	console.log(`  localStorage.setItem(`);
	console.log(`    ${JSON.stringify(`langdle-puzzle-${puzzleRow.id}-v1`)},`);
	console.log(`    ${JSON.stringify(preloadPayload)}`);
	console.log(`  );`);
	console.log('');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
