/**
 * Seeds Stammdaten + Tagesrätsel für den aktuellen UTC-Tag (idempotent per Unique-Constraints).
 *
 * Puzzle-Inhalt: JSON (`data/puzzle-spec.json`, oder `PUZZLE_SPEC_PATH`): Meta (Zielwort,
 * Übersetzung, Sprache, Gittergröße, optional `guessPool`: all | same_pos | shared_tag). **Gitter-Lemmata:** bevorzugt Kaikki +
 * gespeicherten **Embeddings** (`npm run db:embeddings`), sonst ConceptNet-Kanten — keine Lemma-Listen in der JSON-Datei.
 *
 * Voraussetzungen:
 * - `npm run db:import:kaikki -- …` (oder gleichwertiger Befüllung von `vocabulary`)
 * - Optional `npm run db:embeddings` (Sentence-Transformers), dann semantisch konsistente %- und Rang-Werte
 * - Falls ohne Embeddings: ConceptNet — öffentliche API oder empfohlen `RCONCEPTNET_URL` (lokal)
 *
 * Requires: Postgres, `DATABASE_URL`, Schema `npm run db:push`.
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
import * as dbSchema from '../src/lib/server/db/schema.ts';
import { slugFromLemma } from '../src/lib/game/normalize.ts';
import type { GuessPoolMode } from './lib/guessPoolConstraint.ts';
import {
	buildPuzzleNodesFromEmbeddings,
	countVocabularyRowsWithEmbedding,
	targetLemmaHasEmbedding
} from './lib/puzzleGridFromEmbeddings.ts';
import { buildPuzzleNodesFromKaikkiAndConceptNet } from './lib/puzzleGridFromSources.ts';
import { createSeedProgress } from './lib/seedProgress.ts';

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

type PuzzleSpecMeta = {
	targetGerman: string;
	targetForeign: string;
	languageIso639_3: string;
	gridSize: number;
	lexicalDedupeMax: number;
	cnEdgeLimit?: number;
	/** Gitter-Kandidaten einschränken (requires Kaikki-Tags / primary_pos im Import). */
	guessPool: GuessPoolMode;
	extraVocabularyLemmas: string[];
};

function parseGuessPoolMode(raw: unknown): GuessPoolMode {
	const s = String(raw ?? 'all')
		.trim()
		.toLowerCase()
		.replace(/-/g, '_');
	if (s === 'all' || s === 'same_pos' || s === 'shared_tag') return s;
	console.warn(
		`Puzzle-Spezifikation: unbekanntes guessPool "${String(raw)}", verwende "all". Erlaubt: all, same_pos, shared_tag.`
	);
	return 'all';
}

function loadPuzzleSpecMeta(): PuzzleSpecMeta {
	const rawPath =
		process.env.PUZZLE_SPEC_PATH ?? resolve(__dirname, '../data/puzzle-spec.json');
	const pathResolved = resolve(process.cwd(), rawPath);
	if (!existsSync(pathResolved)) {
		console.error(
			`Puzzle-Spezifikation nicht gefunden: ${pathResolved}\n` +
				'Lege data/puzzle-spec.json an oder setze PUZZLE_SPEC_PATH.'
		);
		process.exit(1);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(pathResolved, 'utf8'));
	} catch (e) {
		console.error(`JSON in ${pathResolved} ist ungültig:`, e);
		process.exit(1);
	}
	if (!parsed || typeof parsed !== 'object') {
		console.error('Puzzle-Spezifikation: Root muss ein Objekt sein.');
		process.exit(1);
	}
	const o = parsed as Record<string, unknown>;
	const targetGerman = String(o.targetGerman ?? '').trim();
	const targetForeign = String(o.targetForeign ?? '').trim();
	const languageIso639_3 = String(o.languageIso639_3 ?? '').trim().toLowerCase();
	if (!targetGerman || !targetForeign || !languageIso639_3) {
		console.error('Puzzle-Spezifikation: targetGerman, targetForeign, languageIso639_3 sind Pflicht.');
		process.exit(1);
	}

	const gridSizeRaw = o.gridSize ?? o.grid_size;
	const gridSize =
		typeof gridSizeRaw === 'number' && Number.isFinite(gridSizeRaw) && gridSizeRaw >= 1
			? Math.floor(gridSizeRaw)
			: Number.parseInt(String(gridSizeRaw ?? '32'), 10);
	const gridSizeFinal = Number.isFinite(gridSize) && gridSize >= 1 ? Math.min(gridSize, 120) : 32;

	const lexRaw = o.lexicalDedupeMax ?? o.lexical_dedupe_max;
	let lexicalDedupeMax = 0.82;
	if (typeof lexRaw === 'number' && Number.isFinite(lexRaw)) lexicalDedupeMax = lexRaw;
	else if (lexRaw !== undefined) {
		const p = Number.parseFloat(String(lexRaw));
		if (Number.isFinite(p)) lexicalDedupeMax = p;
	}
	lexicalDedupeMax = Math.max(0.5, Math.min(0.98, lexicalDedupeMax));

	let cnEdgeLimit: number | undefined;
	const cnRaw = o.cnEdgeLimit ?? o.cn_edge_limit;
	if (typeof cnRaw === 'number' && Number.isFinite(cnRaw)) cnEdgeLimit = Math.floor(cnRaw);
	else if (cnRaw !== undefined) {
		const p = Number.parseInt(String(cnRaw), 10);
		if (Number.isFinite(p)) cnEdgeLimit = p;
	}

	let extraVocabularyLemmas: string[] = [];
	if (Array.isArray(o.extraVocabularyLemmas)) {
		extraVocabularyLemmas = o.extraVocabularyLemmas
			.map((x) => String(x).trim())
			.filter(Boolean);
	}

	const guessPool = parseGuessPoolMode(o.guessPool ?? o.guess_pool);

	return {
		targetGerman,
		targetForeign,
		languageIso639_3,
		gridSize: gridSizeFinal,
		lexicalDedupeMax,
		guessPool,
		...(cnEdgeLimit != null && cnEdgeLimit > 0 ? { cnEdgeLimit } : {}),
		extraVocabularyLemmas
	};
}

function utcIsoDate(now = new Date()): string {
	return now.toISOString().slice(0, 10);
}

async function main() {
	const meta = loadPuzzleSpecMeta();
	const quiet = process.env.SEED_QUIET === '1' || process.env.SEED_QUIET === 'true';
	const prog = createSeedProgress('[seed]', quiet);
	prog.set(1, 'Spezifikation geladen');

	const client = postgres(DATABASE_URL!);
	const db = drizzle(client, { schema: dbSchema });

	const langs = [
		{ name: 'Finnisch', iso639_3: 'fin', speakersApprox: 5_400_000, glottocode: null as string | null },
		{ name: 'Schwedisch', iso639_3: 'swe', speakersApprox: 10_000_000, glottocode: null },
		{ name: 'Englisch', iso639_3: 'eng', speakersApprox: 400_000_000, glottocode: null },
		{ name: 'Russisch', iso639_3: 'rus', speakersApprox: 150_000_000, glottocode: null }
	];

	for (const l of langs) {
		await db
			.insert(languagesTable)
			.values(l)
			.onConflictDoUpdate({
				target: languagesTable.iso639_3,
				set: { name: sql`excluded.name`, speakersApprox: sql`excluded.speakers_approx` }
			});
	}

	const ctrs = [
		{ name: 'Deutschland', iso2: 'DE' },
		{ name: 'Finnland', iso2: 'FI' },
		{ name: 'Österreich', iso2: 'AT' },
		{ name: 'Schweden', iso2: 'SE' }
	];

	for (const c of ctrs) {
		await db
			.insert(countriesTable)
			.values(c)
			.onConflictDoUpdate({ target: countriesTable.iso2, set: { name: sql`excluded.name` } });
	}

	prog.set(5, 'Sprachen & Länder synchronisiert');

	const slug = slugFromLemma(meta.targetGerman);
	await db
		.insert(vocabularyTable)
		.values({ lemma: meta.targetGerman, slug, isActive: false })
		.onConflictDoNothing({ target: vocabularyTable.lemma });

	const gridSource = process.env.PUZZLE_GRID_SOURCE?.trim().toLowerCase();
	const embeddingCandidate =
		gridSource !== 'conceptnet' &&
		(await targetLemmaHasEmbedding(db, meta.targetGerman)) &&
		(await countVocabularyRowsWithEmbedding(db)) >= meta.gridSize;

	let nodes;
	let similaritySource: 'embedding' | 'conceptnet' = 'conceptnet';
	try {
		if (embeddingCandidate) {
			nodes = await buildPuzzleNodesFromEmbeddings(db, {
				targetGerman: meta.targetGerman,
				gridSize: meta.gridSize,
				lexicalDedupeMax: meta.lexicalDedupeMax,
				guessPoolMode: meta.guessPool,
				onProgress: quiet
					? undefined
					: (pct, detail) => {
							prog.set(6 + Math.round((pct / 100) * 82), detail);
					  }
			});
			similaritySource = 'embedding';
		} else {
			if (gridSource === 'embedding') {
				prog.done();
				console.error(
					'PUZZLE_GRID_SOURCE=embedding, aber es fehlen Embeddings oder zu wenige Zeilen — zuerst `npm run db:embeddings`, Zielwort braucht Vektor, und es müssen mindestens gridSize Lemmata mit Embedding existieren.'
				);
				process.exit(1);
			}
			nodes = await buildPuzzleNodesFromKaikkiAndConceptNet(db, {
				targetGerman: meta.targetGerman,
				gridSize: meta.gridSize,
				lexicalDedupeMax: meta.lexicalDedupeMax,
				guessPoolMode: meta.guessPool,
				...(meta.cnEdgeLimit != null ? { cnEdgeLimit: meta.cnEdgeLimit } : {}),
				onProgress: quiet
					? undefined
					: (pct, detail) => {
							/* Puzzle-Phase 0–100 → Gesamt-Balken ca. 6–88 % */
							prog.set(6 + Math.round((pct / 100) * 82), detail);
					  }
			});
		}
	} catch (e) {
		prog.done();
		console.error(e);
		process.exit(1);
	}

	prog.set(89, 'Rätsel-Vokabular aktivieren …');

	const lemmasForVocab = new Set<string>();
	for (const n of nodes) lemmasForVocab.add(n.lemma);
	for (const e of meta.extraVocabularyLemmas) lemmasForVocab.add(e);

	await db.update(vocabularyTable).set({ isActive: false });

	for (const lemma of lemmasForVocab) {
		const s = slugFromLemma(lemma);
		await db
			.insert(vocabularyTable)
			.values({ lemma, slug: s, isActive: true })
			.onConflictDoUpdate({
				target: vocabularyTable.lemma,
				set: { slug: sql`excluded.slug`, isActive: true }
			});
	}

	const [langRow] = await db
		.select({ id: languagesTable.id })
		.from(languagesTable)
		.where(eq(languagesTable.iso639_3, meta.languageIso639_3));

	if (!langRow) {
		console.error(
			`Sprache ${meta.languageIso639_3} fehlt in der Tabelle languages — bitte Stammdaten erweitern.`
		);
		process.exit(1);
	}

	prog.set(93, 'Tagesrätsel in Datenbank schreiben …');

	const today = utcIsoDate();
	const vocabSizeRow = await db
		.select({ c: sql<number>`count(*)::int` })
		.from(vocabularyTable)
		.where(eq(vocabularyTable.isActive, true));
	const vocabularySize = vocabSizeRow[0]?.c ?? nodes.length;

	const snapshot = {
		vocabularySize,
		similaritySource,
		nodes: nodes.map((w) => ({
			lemma: w.lemma,
			x: w.x,
			y: w.y,
			similarity: w.similarity,
			temperature: w.temperature,
			...(w.isRevealNode ? { isRevealNode: true } : {})
		})),
		...(meta.extraVocabularyLemmas.length
			? { extraAllowedLemmas: [...meta.extraVocabularyLemmas] }
			: {})
	};

	const puzzleNumberSeed = crypto.createHash('sha256').update(today).digest()[0]! % 90_000 + 1;

	await db.insert(puzzles).values({
		puzzleNumber: puzzleNumberSeed,
		puzzleDate: today,
		targetForeign: meta.targetForeign,
		targetGermanCanonical: meta.targetGerman,
		languageId: langRow.id,
		snapshotVersion: 1,
		snapshot
	}).onConflictDoUpdate({
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

	const [puzzleRow] = await db.select({ id: puzzles.id }).from(puzzles).where(eq(puzzles.puzzleDate, today)).limit(1);

	if (!puzzleRow) throw new Error('Puzzle konnte nicht ermittelt werden');

	const fi = await db.select({ id: countriesTable.id }).from(countriesTable).where(eq(countriesTable.iso2, 'FI')).limit(1);
	const at = await db.select({ id: countriesTable.id }).from(countriesTable).where(eq(countriesTable.iso2, 'AT')).limit(1);

	for (const row of [...fi, ...at]) {
		await db
			.insert(puzzleCountries)
			.values({ puzzleId: puzzleRow.id, countryId: row.id })
			.onConflictDoNothing();
	}

	prog.set(99, 'Fertig');
	prog.done();

	await client.end();
	console.log(
		`Seed OK — UTC ${today} | ${meta.targetForeign} → ${meta.targetGerman} | Gitter=${nodes.length} | aktive Lemmata: ${vocabularySize}`
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
