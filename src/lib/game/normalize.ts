/** Einheitlicher Schlüssel für Lemmata (Groß-/Kleinschreibung, häufige Varianten für ß/Umlaute). */

export function normalizeLemmaKey(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/\s+/g, ' ')
		.replace(/ß/g, 'ss')
		.trim();
}

export function slugFromLemma(lemma: string): string {
	return normalizeLemmaKey(lemma).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'x';
}

/** Stabiler, mit hoher Wahrscheinlichkeit eindeutiger Slug (DB `vocabulary.slug` UNIQUE). */
export function uniqueVocabSlug(lemma: string): string {
	const key = normalizeLemmaKey(lemma);
	const base = slugFromLemma(lemma);
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const suf = (h >>> 0).toString(36);
	return `${base}-${suf}`;
}
