/**
 * Importiert Lemmata aus Kaikki/Wiktextract-JSONL in `vocabulary` und optional Tags
 * (Wiktextract `topics` + `categories` auf Wort- und Sense-Ebene).
 *
 * Kaikki-Web „Senses by topic“ ≈ `topics`; „place“/„other category“ sind Kategorie-Links → `category`.
 *
 * Mit Tags: die gesamte JSONL wird einmal gelesen, damit mehrere Zeilen pro Lemma zusammengeführt werden.
 *
 * Usage:
 *   npm run db:import:kaikki -- ./data/kaikki/kaikki.org-dictionary-German.jsonl
 *   npm run db:import:kaikki -- ./file.jsonl --limit=15000
 *   npm run db:import:kaikki -- ./file.jsonl --no-tags
 *   npm run db:import:kaikki -- ./file.jsonl --deactivate-synthetic
 */
import * as crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq, inArray, like, sql } from 'drizzle-orm';

import { normalizeLemmaKey, slugFromLemma, uniqueVocabSlug } from '../src/lib/game/normalize.ts';
import { primaryPosFromKaikkiEntry } from './lib/kaikkiPrimaryPos.ts';
import {
	tags,
	vocabulary as vocabularyTable,
	vocabularyTags
} from '../src/lib/server/db/schema.ts';

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
	console.error('DATABASE_URL unset');
	process.exit(1);
}

type TagLayer = 'topic' | 'category';

type KaikkiLine = {
	word?: string;
	lang_code?: string;
	redirect?: string;
	topics?: unknown;
	categories?: unknown;
	senses?: unknown;
};

type Pending = {
	lemma: string;
	topics: Set<string>;
	categories: Set<string>;
	/** Erste erkannte POS aus Kaikki-Senses */
	primaryPos?: string;
};

const BATCH_KEYS = 400;

function tagSlug(label: string): string {
	const s = slugFromLemma(label);
	if (s && s !== 'x') return s.slice(0, 220);
	const h = crypto.createHash('sha256').update(label, 'utf8').digest('hex').slice(0, 24);
	return `h${h}`;
}

function addStringList(target: Set<string>, arr: unknown): void {
	if (!Array.isArray(arr)) return;
	for (const x of arr) {
		if (typeof x === 'string') {
			const t = x.trim();
			if (t) target.add(t);
		}
	}
}

function collectTopicsAndCategories(obj: Record<string, unknown>): { topics: string[]; categories: string[] } {
	const topics = new Set<string>();
	const categories = new Set<string>();
	addStringList(topics, obj.topics);
	addStringList(categories, obj.categories);
	const senses = obj.senses;
	if (Array.isArray(senses)) {
		for (const s of senses) {
			if (!s || typeof s !== 'object') continue;
			const se = s as Record<string, unknown>;
			addStringList(topics, se.topics);
			addStringList(categories, se.categories);
		}
	}
	return { topics: [...topics], categories: [...categories] };
}

function parseArgs(argv: string[]) {
	let pathArg: string | null = null;
	let limit: number | null = null;
	let deactivateSynthetic = false;
	let withTags = true;
	for (const a of argv) {
		if (a.startsWith('--limit=')) {
			const n = Number.parseInt(a.slice('--limit='.length), 10);
			if (Number.isFinite(n) && n > 0) limit = n;
		} else if (a === '--deactivate-synthetic') {
			deactivateSynthetic = true;
		} else if (a === '--no-tags') {
			withTags = false;
		} else if (!a.startsWith('--')) {
			pathArg = a;
		}
	}
	return { pathArg, limit, deactivateSynthetic, withTags };
}

function isPlausibleLemma(w: string): boolean {
	const t = w.trim();
	if (t.length < 2 || t.length > 80) return false;
	if (/^\s|\s$/.test(w)) return false;
	if (/^[0-9]+$/.test(t)) return false;
	return true;
}

async function main() {
	const { pathArg, limit, deactivateSynthetic, withTags } = parseArgs(process.argv.slice(2));
	const jsonlPath =
		pathArg ?? process.env.KAIKKI_GERMAN_JSONL ?? resolve(__dirname, '../data/kaikki/kaikki.org-dictionary-German.jsonl');

	if (!existsSync(jsonlPath)) {
		console.error(`Datei fehlt: ${jsonlPath}`);
		console.error('Download: https://kaikki.org/dictionary/German/');
		process.exit(1);
	}

	const client = postgres(DATABASE_URL);
	const db = drizzle(client);

	if (deactivateSynthetic) {
		await db
			.update(vocabularyTable)
			.set({ isActive: false })
			.where(like(vocabularyTable.lemma, 'zzf%'));
		console.log('Deaktiviert: lemma LIKE zzf% (Seed-Platzhalter).');
	}

	const tagIdCache = new Map<string, number>();

	function tagIdFor(layer: TagLayer, label: string): number | undefined {
		return tagIdCache.get(`${layer}:${tagSlug(label)}`);
	}

	async function ensureTagIds(layer: TagLayer, labelSet: Set<string>): Promise<void> {
		for (const label of labelSet) {
			const slug = tagSlug(label);
			const ck = `${layer}:${slug}`;
			if (tagIdCache.has(ck)) continue;
			const shortLabel = label.length > 512 ? label.slice(0, 512) : label;
			const [row] = await db
				.insert(tags)
				.values({ layer, slug, label: shortLabel })
				.onConflictDoUpdate({
					target: [tags.layer, tags.slug],
					set: { label: sql`excluded.label` }
				})
				.returning({ id: tags.id });
			if (row) {
				tagIdCache.set(ck, row.id);
				continue;
			}
			const [found] = await db
				.select({ id: tags.id })
				.from(tags)
				.where(and(eq(tags.layer, layer), eq(tags.slug, slug)))
				.limit(1);
			if (found) tagIdCache.set(ck, found.id);
		}
	}

	async function flushEntries(entries: [string, Pending][]): Promise<void> {
		if (entries.length === 0) return;
		const rows = entries.map(([, p]) => ({
			lemma: p.lemma,
			slug: uniqueVocabSlug(p.lemma),
			isActive: true as const,
			primaryPos: p.primaryPos ?? null
		}));

		const inserted = await db
			.insert(vocabularyTable)
			.values(rows)
			.onConflictDoUpdate({
				target: vocabularyTable.lemma,
				set: {
					slug: sql`excluded.slug`,
					primaryPos: sql`COALESCE(excluded.primary_pos, ${vocabularyTable.primaryPos})`
				}
			})
			.returning({ id: vocabularyTable.id, lemma: vocabularyTable.lemma });

		const idByKey = new Map<string, number>();
		for (const r of inserted) {
			idByKey.set(normalizeLemmaKey(r.lemma), r.id);
		}

		const missingLemmas = entries
			.map(([, p]) => p.lemma)
			.filter((lemma) => !idByKey.has(normalizeLemmaKey(lemma)));
		if (missingLemmas.length > 0) {
			const found = await db
				.select({ id: vocabularyTable.id, lemma: vocabularyTable.lemma })
				.from(vocabularyTable)
				.where(inArray(vocabularyTable.lemma, missingLemmas));
			for (const r of found) {
				idByKey.set(normalizeLemmaKey(r.lemma), r.id);
			}
		}

		if (!withTags) return;

		const allTopics = new Set<string>();
		const allCats = new Set<string>();
		for (const [, p] of entries) {
			p.topics.forEach((t) => allTopics.add(t));
			p.categories.forEach((c) => allCats.add(c));
		}
		await ensureTagIds('topic', allTopics);
		await ensureTagIds('category', allCats);

		const vt: { vocabularyId: number; tagId: number }[] = [];
		for (const [key, p] of entries) {
			const vid = idByKey.get(key);
			if (vid == null) continue;
			for (const t of p.topics) {
				const tid = tagIdFor('topic', t);
				if (tid != null) vt.push({ vocabularyId: vid, tagId: tid });
			}
			for (const c of p.categories) {
				const tid = tagIdFor('category', c);
				if (tid != null) vt.push({ vocabularyId: vid, tagId: tid });
			}
		}
		if (vt.length === 0) return;
		const CH = 800;
		for (let i = 0; i < vt.length; i += CH) {
			await db.insert(vocabularyTags).values(vt.slice(i, i + CH)).onConflictDoNothing();
		}
	}

	let lines = 0;
	let skipped = 0;
	let uniqueLemmaKeys = 0;

	if (withTags) {
		const acc = new Map<string, Pending>();

		const rl = createInterface({
			input: createReadStream(jsonlPath, { encoding: 'utf8' }),
			crlfDelay: Infinity
		});

		for await (const line of rl) {
			lines++;
			if (!line.trim()) continue;
			let obj: KaikkiLine;
			try {
				obj = JSON.parse(line) as KaikkiLine;
			} catch {
				skipped++;
				continue;
			}
			if (obj.redirect) {
				skipped++;
				continue;
			}
			const w = typeof obj.word === 'string' ? obj.word : '';
			if (!w || !isPlausibleLemma(w)) {
				skipped++;
				continue;
			}
			if (obj.lang_code && obj.lang_code !== 'de') {
				skipped++;
				continue;
			}

			const key = normalizeLemmaKey(w);
			const { topics, categories } = collectTopicsAndCategories(obj as Record<string, unknown>);
			const pos = primaryPosFromKaikkiEntry(obj as Record<string, unknown>);

			if (!acc.has(key)) {
				if (limit != null && acc.size >= limit) continue;
				acc.set(key, {
					lemma: w.trim(),
					topics: new Set(),
					categories: new Set(),
					...(pos ? { primaryPos: pos } : {})
				});
			}
			const p = acc.get(key);
			if (!p) continue;
			topics.forEach((t) => p.topics.add(t));
			categories.forEach((c) => p.categories.add(c));
			if (pos && !p.primaryPos) p.primaryPos = pos;
		}

		uniqueLemmaKeys = acc.size;

		const all = [...acc.entries()];
		for (let i = 0; i < all.length; i += BATCH_KEYS) {
			await flushEntries(all.slice(i, i + BATCH_KEYS));
		}
	} else {
		const seen = new Set<string>();
		const pending = new Map<string, Pending>();

		const rl = createInterface({
			input: createReadStream(jsonlPath, { encoding: 'utf8' }),
			crlfDelay: Infinity
		});

		for await (const line of rl) {
			lines++;
			if (!line.trim()) continue;
			let obj: KaikkiLine;
			try {
				obj = JSON.parse(line) as KaikkiLine;
			} catch {
				skipped++;
				continue;
			}
			if (obj.redirect) {
				skipped++;
				continue;
			}
			const w = typeof obj.word === 'string' ? obj.word : '';
			if (!w || !isPlausibleLemma(w)) {
				skipped++;
				continue;
			}
			if (obj.lang_code && obj.lang_code !== 'de') {
				skipped++;
				continue;
			}

			const key = normalizeLemmaKey(w);
			if (seen.has(key)) continue;
			seen.add(key);
			uniqueLemmaKeys++;

			const pos = primaryPosFromKaikkiEntry(obj as Record<string, unknown>);
			pending.set(key, {
				lemma: w.trim(),
				topics: new Set(),
				categories: new Set(),
				...(pos ? { primaryPos: pos } : {})
			});

			if (pending.size >= BATCH_KEYS) {
				await flushEntries([...pending.entries()]);
				pending.clear();
			}

			if (limit != null && uniqueLemmaKeys >= limit) break;
		}

		if (pending.size > 0) await flushEntries([...pending.entries()]);
	}

	const [{ c: total }] = await db
		.select({ c: sql<number>`count(*)::int` })
		.from(vocabularyTable)
		.where(eq(vocabularyTable.isActive, true));

	await client.end();

	console.log(
		`Kaikki-Import: JSONL-Zeilen=${lines}, eindeutige Lemmata=${uniqueLemmaKeys}, übersprungen≈${skipped}. Tags: ${withTags ? 'an (volle Datei gelesen)' : 'aus'}. Aktive Vokabeln gesamt: ${total}.`
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
