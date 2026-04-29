import { relations } from 'drizzle-orm';
import {
	boolean,
	date,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	real,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';

/**
 * Wiktextract: `topics` vs `categories` (Wiktionary category links).
 * Kaikki’s „place“ vs „other“ browse buckets are both category-like; we store one `category` layer unless you add a separate mapping.
 */
export const tagLayerEnum = pgEnum('tag_layer', ['topic', 'category']);

export const vocabulary = pgTable('vocabulary', {
	id: serial('id').primaryKey(),
	lemma: text('lemma').notNull().unique(),
	slug: text('slug').notNull().unique(),
	/** Wiktextract/Kaikki POS (Sense `pos` oder erstes POS-Tag), z. B. noun, interjection */
	primaryPos: text('primary_pos'),
	isActive: boolean('is_active').notNull().default(true),
	/** Satz-Transformer-Vektor (L2-normalisiert); Modellname siehe `embedding_model`. */
	embedding: jsonb('embedding').$type<number[]>(),
	embeddingModel: text('embedding_model'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const tags = pgTable(
	'tags',
	{
		id: serial('id').primaryKey(),
		layer: tagLayerEnum('layer').notNull(),
		slug: text('slug').notNull(),
		label: text('label').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('tags_layer_slug').on(t.layer, t.slug)]
);

export const vocabularyTags = pgTable(
	'vocabulary_tags',
	{
		vocabularyId: integer('vocabulary_id')
			.notNull()
			.references(() => vocabulary.id, { onDelete: 'cascade' }),
		tagId: integer('tag_id')
			.notNull()
			.references(() => tags.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.vocabularyId, t.tagId] })]
);

export const languages = pgTable('languages', {
	id: serial('id').primaryKey(),
	name: text('name').notNull().unique(),
	iso639_3: text('iso639_3').notNull().unique(),
	glottocode: text('glottocode'),
	speakersApprox: integer('speakers_approx'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const countries = pgTable('countries', {
	id: serial('id').primaryKey(),
	name: text('name').notNull().unique(),
	iso2: text('iso2').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const puzzles = pgTable('puzzles', {
	id: serial('id').primaryKey(),
	puzzleNumber: integer('puzzle_number').notNull().unique(),
	puzzleDate: date('puzzle_date', { mode: 'string' }).notNull().unique(),
	targetForeign: text('target_foreign').notNull(),
	targetGermanCanonical: text('target_german_canonical').notNull(),
	languageId: integer('language_id')
		.notNull()
		.references(() => languages.id, { onDelete: 'restrict' }),
	snapshotVersion: integer('snapshot_version').notNull().default(1),
	snapshot: jsonb('snapshot')
		.$type<{
			vocabularySize: number;
			/** Woher kommen die %- und Rang-Werte im Snapshot (Rates nutzen dieselbe Quelle wenn möglich). */
			similaritySource?: 'embedding' | 'conceptnet';
			nodes: Array<{
				lemma: string;
				x: number;
				y: number;
				similarity: number;
				temperature: 'cold' | 'warm' | 'hot';
				isRevealNode?: boolean;
			}>;
			/** Ohne eigene Koordinaten ratbar (selten; lieber weglassen). */
			extraAllowedLemmas?: string[];
		}>()
		.notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const puzzleCountries = pgTable(
	'puzzle_countries',
	{
		puzzleId: integer('puzzle_id')
			.notNull()
			.references(() => puzzles.id, { onDelete: 'cascade' }),
		countryId: integer('country_id')
			.notNull()
			.references(() => countries.id, { onDelete: 'cascade' })
	},
	(table) => [primaryKey({ columns: [table.puzzleId, table.countryId] })]
);

export const guesses = pgTable('guesses', {
	id: serial('id').primaryKey(),
	puzzleId: integer('puzzle_id')
		.notNull()
		.references(() => puzzles.id, { onDelete: 'cascade' }),
	vocabularyId: integer('vocabulary_id')
		.notNull()
		.references(() => vocabulary.id, { onDelete: 'restrict' }),
	cosineSimilarity: real('cosine_similarity').notNull(),
	rank: integer('rank').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const puzzleRelations = relations(puzzles, ({ one, many }) => ({
	language: one(languages, {
		fields: [puzzles.languageId],
		references: [languages.id]
	}),
	validCountries: many(puzzleCountries),
	guesses: many(guesses)
}));

export const puzzleCountryRelations = relations(puzzleCountries, ({ one }) => ({
	puzzle: one(puzzles, {
		fields: [puzzleCountries.puzzleId],
		references: [puzzles.id]
	}),
	country: one(countries, {
		fields: [puzzleCountries.countryId],
		references: [countries.id]
	})
}));
