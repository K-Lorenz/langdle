import type { PuzzleSnapshotNode } from './types';

/** Erweiterte Snaphot-Nodes wie von `+page.server` geliefert. */
export type LoadedPuzzle = {
	id: number;
	number: number;
	date: string;
	targetForeign: string;
	targetGermanCanonical: string;
	targetGermanKey: string;
	snapshot: {
		vocabularySize: number;
		nodes: PuzzleSnapshotNode[];
	};
};

/** Entspricht `tag_layer` in der DB — Wiktextract topics vs. categories. */
export type VocabularyTagLayer = 'topic' | 'category';

export type VocabularyTag = {
	layer: VocabularyTagLayer;
	slug: string;
	label: string;
};

export type VocabularyEntry = {
	id: number;
	lemma: string;
	key: string;
	/** Kaikki/Wiktextract: Themen & Kategorien (Kaikki „place“/„other“ = beides category-artig). */
	tags: VocabularyTag[];
};

export type BonusLanguageRow = {
	name: string;
	iso639_3: string;
	speakersApprox: number | null;
};

export type BonusCountryRow = {
	name: string;
	iso2: string;
};

export type LangQuizChoice = {
	name: string;
	iso639_3: string;
};
