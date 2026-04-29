/**
 * Schnelle, lokale Näherung für semantische Ähnlichkeit (ohne externes API),
 * wenn ConceptNet ausfällt oder zu langsam ist. Ergänzt keine echte Semantik,
 * vermeidet aber identische Default-Werte für alle Lemmata.
 */

function bigrams(s: string): Map<string, number> {
	const m = new Map<string, number>();
	const t = s.trim().toLowerCase();
	if (t.length < 2) return m;
	for (let i = 0; i < t.length - 1; i++) {
		const bg = t.slice(i, i + 2);
		m.set(bg, (m.get(bg) ?? 0) + 1);
	}
	return m;
}

/** Sørensen–Dice auf Zeichen-Bigrammen → [0, 1]. */
function diceCoefficient(a: string, b: string): number {
	const A = bigrams(a);
	const B = bigrams(b);
	if (A.size === 0 && B.size === 0) return a.toLowerCase() === b.toLowerCase() ? 1 : 0;
	if (A.size === 0 || B.size === 0) return 0;
	let inter = 0;
	for (const [k, ca] of A) {
		const cb = B.get(k);
		if (cb != null) inter += Math.min(ca, cb);
	}
	return (2 * inter) / ([...A.values()].reduce((s, x) => s + x, 0) + [...B.values()].reduce((s, x) => s + x, 0));
}

/** Längster gemeinsamer Präfix-Anteil (Zeichen), normalisiert. */
function prefixShare(a: string, b: string): number {
	const x = a.toLowerCase();
	const y = b.toLowerCase();
	const n = Math.min(x.length, y.length);
	let i = 0;
	for (; i < n && x[i] === y[i]; i++);
	return i / Math.max(x.length, y.length, 1);
}

function commonPrefixLen(a: string, b: string): number {
	const x = a.toLowerCase();
	const y = b.toLowerCase();
	const n = Math.min(x.length, y.length);
	let i = 0;
	for (; i < n && x[i] === y[i]; i++);
	return i;
}

/**
 * Reduziert „scheinbare Nähe“ bei Stamm+Flexion (gleicher Anfang, abweichende Endung)
 * und wenn das kürzere Lemma Anfang des längeren ist — typisch für Konjugation/Steigerung.
 */
function morphologicalDampen(target: string, guess: string, raw: number): number {
	const t = target.trim().toLowerCase();
	const g = guess.trim().toLowerCase();
	if (!t || !g || t === g) return raw;

	let m = 1;
	const minLen = Math.min(t.length, g.length);
	const maxLen = Math.max(t.length, g.length);
	const cpl = commonPrefixLen(target, guess);
	if (minLen >= 3 && cpl / minLen >= 0.62) {
		m *= 0.62;
	}

	const shorter = t.length <= g.length ? t : g;
	const longer = t.length <= g.length ? g : t;
	if (longer.startsWith(shorter) && longer.length - shorter.length >= 1) {
		m *= 0.48;
	}

	return Math.max(0.02, raw * m);
}

/**
 * Heuristische Ähnlichkeit [0, 1] nur aus Zeichenketten — für Offline-/Fallback-Rangfolge.
 */
export function lexicalSimilarity01(target: string, guess: string): number {
	const t = target.trim();
	const g = guess.trim();
	if (!t || !g) return 0;
	if (t.toLowerCase() === g.toLowerCase()) return 1;
	const dice = diceCoefficient(t, g);
	const pref = prefixShare(t, g);
	// Weniger Präfix-Gewicht: morphologisch verwandte Wörter (Konjugation, gleicher Stamm) nicht als „fast richtig“.
	const raw = 0.84 * dice + 0.16 * pref;
	const damped = morphologicalDampen(t, g, raw);
	return Math.max(0.025, Math.min(1, damped));
}
