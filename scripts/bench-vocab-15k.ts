/**
 * Lokaler Performance-Test: 15 000 Vokabel-Einträge wie in VocabSearch
 * (prefix filter + slice(0, 8) pro „Tastatur-Schritt“).
 *
 * Run: npm run test:vocab-15k
 */
import { normalizeLemmaKey } from '../src/lib/game/normalize.ts';

type VocabRow = { id: number; lemma: string; key: string };

const MAX = 8;

/** Gleiche Logik wie `VocabSearch.svelte` → `matches` */
function prefixMatches(vocabulary: readonly VocabRow[], draft: string): VocabRow[] {
	const q = draft.trim().toLowerCase();
	if (!q || q.length < 1) return [];
	return vocabulary.filter((v) => v.lemma.toLowerCase().startsWith(q)).slice(0, MAX);
}

/** ~15 000 eindeutige Lemmata mit realistischer Präfix-Verteilung (viele teilen Anfang). */
function buildVocabulary15k(): VocabRow[] {
	const stems = [
		'abend',
		'arbeit',
		'auge',
		'baum',
		'berg',
		'blau',
		'breit',
		'dorf',
		'fahrt',
		'feld',
		'fisch',
		'frage',
		'frei',
		'freund',
		'frost',
		'garten',
		'glas',
		'gold',
		'grund',
		'hand',
		'haus',
		'herz',
		'hof',
		'kind',
		'kraft',
		'kreis',
		'licht',
		'luft',
		'mond',
		'morgen',
		'mund',
		'nacht',
		'nase',
		'ort',
		'pferd',
		'plan',
		'rad',
		'regen',
		'ring',
		'rose',
		'sand',
		'schiff',
		'schnee',
		'sonne',
		'stadt',
		'stern',
		'stift',
		'strom',
		'stunde',
		'tag',
		'tisch',
		'tor',
		'turm',
		'uhr',
		'wald',
		'weg',
		'welt',
		'wind',
		'winter',
		'wort',
		'wunde',
		'zeit',
		'ziel',
		'zug'
	];
	const out: VocabRow[] = [];
	let id = 1;
	while (out.length < 15_000) {
		for (const s of stems) {
			if (out.length >= 15_000) break;
			const lemma = `${s}${out.length}`;
			out.push({ id: id++, lemma, key: normalizeLemmaKey(lemma) });
		}
	}
	return out;
}

function mean(ns: number[]): number {
	if (ns.length === 0) return 0;
	return ns.reduce((a, b) => a + b, 0) / ns.length;
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
	return sorted[idx]!;
}

function bench(label: string, vocabulary: readonly VocabRow[], draft: string, runs: number): number[] {
	const times: number[] = [];
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		const m = prefixMatches(vocabulary, draft);
		const t1 = performance.now();
		times.push(t1 - t0);
		/* Verhindert, dass der Compiler alles wegoptimiert */
		if (m.length === 0 && draft === '__impossible__') void m;
	}
	times.sort((a, b) => a - b);
	const avg = mean(times);
	const p95 = percentile(times, 0.95);
	console.log(
		`  ${label.padEnd(28)} n=${runs}  avg=${avg.toFixed(3)} ms  p95=${p95.toFixed(3)} ms  hits=${prefixMatches(vocabulary, draft).length}`
	);
	return times;
}

const VOCAB_SIZE = 15_000;
/** Einzelner Prefix-Scan soll im Schnitt unter diesem Wert bleiben (lokale Maschine). */
const AVG_MS_BUDGET = 35;

const vocab = buildVocabulary15k();
if (vocab.length !== VOCAB_SIZE) {
	console.error(`Expected ${VOCAB_SIZE} rows, got ${vocab.length}`);
	process.exit(1);
}

const payloadBytes = Buffer.byteLength(JSON.stringify(vocab), 'utf8');
console.log(`Vocabulary rows: ${vocab.length}`);
console.log(`JSON payload (approx. +page data): ${(payloadBytes / 1024).toFixed(1)} KiB\n`);

console.log('Prefix-match benchmark (same algorithm as VocabSearch):');
const RUNS = 200;
/* Warmup */
for (let i = 0; i < 30; i++) prefixMatches(vocab, 'sch');

const heavyTimes = bench("query 's' (1 char)", vocab, 's', RUNS);
bench("query 'sch' (3 char)", vocab, 'sch', RUNS);
bench("query 'stern' (5 char)", vocab, 'stern', RUNS);
bench("query 'zzzzz' (no hits)", vocab, 'zzzzz', RUNS);

const avgHeavy = mean(heavyTimes);
console.log('');

if (avgHeavy > AVG_MS_BUDGET) {
	console.error(
		`FAIL: average time for worst-case-style scan (${avgHeavy.toFixed(3)} ms) > budget ${AVG_MS_BUDGET} ms.\n` +
			`Consider debouncing, a prefix index, or server-side search before shipping 15k client-side.`
	);
	process.exit(1);
}

console.log(
	`PASS: 15k vocabulary prefix scan stays within ~${AVG_MS_BUDGET} ms average on this machine.\n` +
		`Note: mobile devices may be slower; use the same script there or raise the budget if needed.`
);
process.exit(0);
