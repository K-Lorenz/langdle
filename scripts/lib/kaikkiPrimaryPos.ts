/**
 * Primäre Wortart aus Kaikki/Wiktextract-Zeilen (Sense.pos bzw. Tags).
 */
const POS_ALIASES: Record<string, string> = {
	adj: 'adjective',
	adjective: 'adjective',
	adv: 'adverb',
	adverb: 'adverb',
	art: 'article',
	article: 'article',
	conj: 'conjunction',
	conjunction: 'conjunction',
	det: 'determiner',
	determiner: 'determiner',
	interj: 'interjection',
	interjection: 'interjection',
	name: 'name',
	noun: 'noun',
	num: 'numeral',
	numeral: 'numeral',
	part: 'particle',
	particle: 'particle',
	phrase: 'phrase',
	prep: 'preposition',
	preposition: 'preposition',
	pron: 'pronoun',
	pronoun: 'pronoun',
	prop: 'proper noun',
	verb: 'verb',
	v: 'verb'
};

/** Explizite POS-Werte (Kleinbuchstaben), keine Flexions-/Usage-Tags. */
const KNOWN_POS = new Set<string>([
	'abbreviation',
	'adjective',
	'adverb',
	'article',
	'auxiliary verb',
	'character',
	'combining form',
	'conjunction',
	'contraction',
	'counter',
	'determiner',
	'diacritical mark',
	'gerund',
	'interfix',
	'interjection',
	'letter',
	'modal verb',
	'name',
	'noun',
	'numeral',
	'numeral symbol',
	'particle',
	'participle',
	'phrase',
	'prefix',
	'preposition',
	'pronoun',
	'proper noun',
	'proverb',
	'punctuation mark',
	'suffix',
	'symbol',
	'verb'
]);

/** Tags, die keine POS sind (Morphologie, Register, …). */
const NOT_POS_TAG = new Set<string>([
	'abstract noun',
	'accusative',
	'active',
	'animate',
	'archaic',
	'attributive',
	'augmentative',
	'collective',
	'common gender',
	'comparable',
	'comparative',
	'concrete',
	'dative',
	'dated',
	'definite',
	'demonstrative',
	'dependent',
	'diminutive',
	'ergative',
	'feminine',
	'formal',
	'genitive',
	'hyphenated',
	'imperative',
	'inanimate',
	'informal',
	'instrumental',
	'intransitive',
	'irregular',
	'locative',
	'masculine',
	'misspelling',
	'mixed',
	'neuter',
	'nominative',
	'obsolete',
	'passive',
	'past',
	'person',
	'plural',
	'positive',
	'possessive',
	'present',
	'preterite',
	'reflexive',
	'rare',
	'relative',
	'singular',
	'slang',
	'subjunctive',
	'superlative',
	'supine',
	'transitive',
	'uncountable',
	'usually',
	'vocative',
	'weak'
]);

function canonicalFromRaw(raw: string): string | null {
	const t = raw.trim().toLowerCase();
	if (!t) return null;
	const aliased = POS_ALIASES[t] ?? t;
	if (KNOWN_POS.has(aliased)) return aliased;
	if (KNOWN_POS.has(t)) return t;
	return null;
}

function canonicalFromSenseTag(raw: string): string | null {
	const t = raw.trim().toLowerCase();
	if (!t || NOT_POS_TAG.has(t)) return null;
	return canonicalFromRaw(t);
}

/**
 * Erste erkannte POS über alle Senses (Sense.pos hat Vorrang vor tags).
 */
export function primaryPosFromKaikkiEntry(obj: Record<string, unknown>): string | null {
	const senses = obj.senses;
	if (!Array.isArray(senses)) return null;

	for (const raw of senses) {
		if (!raw || typeof raw !== 'object') continue;
		const s = raw as Record<string, unknown>;

		if (typeof s.pos === 'string') {
			const c = canonicalFromRaw(s.pos);
			if (c) return c;
		}

		const tags = s.tags;
		if (Array.isArray(tags)) {
			for (const tag of tags) {
				if (typeof tag !== 'string') continue;
				const c = canonicalFromSenseTag(tag);
				if (c) return c;
			}
		}
	}

	return null;
}
