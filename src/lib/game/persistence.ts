import type { Temperature } from '$lib/game/types';

const STORAGE_VERSION = 2;

export type SyntheticGridEntry = {
	lemma: string;
	x: number;
	y: number;
	similarity: number;
	temperature: Temperature;
};

export type PuzzleProgressStored = {
	v: typeof STORAGE_VERSION;
	guessedLemmaKeysInOrder: string[];
	mainSolved: boolean;
	bonusLanguageSolved?: boolean;
	bonusCountrySolved?: boolean;
	/** ConceptNet-Layout für Lexikon-Tipps ohne Eintrag im Tages-Snapshot */
	syntheticGridByKey?: Record<string, SyntheticGridEntry>;
};

export function puzzleStorageKey(puzzleId: number): string {
	return `langdle-puzzle-${puzzleId}-v${STORAGE_VERSION}`;
}

function legacyPuzzleStorageKeyV1(puzzleId: number): string {
	return `langdle-puzzle-${puzzleId}-v1`;
}

export function loadPuzzleProgress(puzzleId: number): PuzzleProgressStored {
	const empty: PuzzleProgressStored = {
		v: STORAGE_VERSION,
		guessedLemmaKeysInOrder: [],
		mainSolved: false,
		bonusLanguageSolved: false,
		bonusCountrySolved: false,
		syntheticGridByKey: {}
	};
	if (typeof localStorage === 'undefined') return empty;
	try {
		let raw = localStorage.getItem(puzzleStorageKey(puzzleId));
		if (!raw) raw = localStorage.getItem(legacyPuzzleStorageKeyV1(puzzleId));
		if (!raw) return empty;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const ver = typeof parsed.v === 'number' ? parsed.v : NaN;
		if (!parsed || (ver !== STORAGE_VERSION && ver !== 1)) return empty;

		if (ver === 1) {
			return {
				v: STORAGE_VERSION,
				guessedLemmaKeysInOrder: Array.isArray(parsed.guessedLemmaKeysInOrder)
					? parsed.guessedLemmaKeysInOrder
					: [],
				mainSolved: Boolean(parsed.mainSolved),
				bonusLanguageSolved: Boolean(parsed.bonusLanguageSolved),
				bonusCountrySolved: Boolean(parsed.bonusCountrySolved),
				syntheticGridByKey: {}
			};
		}

		const syntheticRaw = parsed.syntheticGridByKey;
		const syntheticGridByKey: Record<string, SyntheticGridEntry> = {};
		if (syntheticRaw && typeof syntheticRaw === 'object') {
			for (const [k, v] of Object.entries(syntheticRaw)) {
				if (!v || typeof v !== 'object') continue;
				const o = v as Partial<SyntheticGridEntry>;
				if (
					typeof o.lemma === 'string' &&
					typeof o.x === 'number' &&
					typeof o.y === 'number' &&
					typeof o.similarity === 'number' &&
					(o.temperature === 'cold' || o.temperature === 'warm' || o.temperature === 'hot')
				) {
					syntheticGridByKey[k] = {
						lemma: o.lemma,
						x: o.x,
						y: o.y,
						similarity: o.similarity,
						temperature: o.temperature
					};
				}
			}
		}

		return {
			v: STORAGE_VERSION,
			guessedLemmaKeysInOrder: Array.isArray(parsed.guessedLemmaKeysInOrder)
				? parsed.guessedLemmaKeysInOrder
				: [],
			mainSolved: Boolean(parsed.mainSolved),
			bonusLanguageSolved: Boolean(parsed.bonusLanguageSolved),
			bonusCountrySolved: Boolean(parsed.bonusCountrySolved),
			syntheticGridByKey
		};
	} catch {
		return empty;
	}
}

export function savePuzzleProgress(puzzleId: number, progress: PuzzleProgressStored): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(puzzleStorageKey(puzzleId), JSON.stringify(progress));
	try {
		localStorage.removeItem(legacyPuzzleStorageKeyV1(puzzleId));
	} catch {
		/* noop */
	}
}
