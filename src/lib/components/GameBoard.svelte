<script lang="ts">
	import WordCloud from './WordCloud.svelte';
	import VocabSearch from './VocabSearch.svelte';
	import { de } from '$lib/strings/de';
	import { guessListHeat } from '$lib/game/similarityHeat';
	import type { PuzzleProgressStored, SyntheticGridEntry } from '$lib/game/persistence';
	import { loadPuzzleProgress, savePuzzleProgress } from '$lib/game/persistence';
	import { similarityRankAcrossSnapshot, snapshotNodeByLemmaKey } from '$lib/game/snapshot';
	import type { PuzzleSnapshotNode } from '$lib/game/types';
	import { recordMainSolveForUtcToday } from '$lib/game/streak';
	import type { LoadedPuzzle, VocabularyEntry } from '$lib/game/pageTypes';
	import { onMount, tick } from 'svelte';

	type GuessKindLine =
		| {
				kind: 'grid';
				lemmaDisplay: string;
				key: string;
				rank: number;
				similarityPct: number;
				tempWord: string;
		  }
		| { kind: 'off'; lemmaDisplay: string; key: string };

	type Props = {
		puzzle: LoadedPuzzle;
		vocabulary: VocabularyEntry[];
	};

	let { puzzle, vocabulary }: Props = $props();

	let feedback = $state<string | undefined>(undefined);
	let progress = $state<PuzzleProgressStored>({
		v: 2,
		guessedLemmaKeysInOrder: [],
		mainSolved: false,
		bonusLanguageSolved: false,
		bonusCountrySolved: false,
		syntheticGridByKey: {}
	});

	function syntheticToNodes(
		rec: Record<string, SyntheticGridEntry> | undefined
	): PuzzleSnapshotNode[] {
		if (!rec) return [];
		return Object.entries(rec).map(([k, e]) => ({
			lemma: e.lemma,
			lemmaNormalizedKey: k,
			x: e.x,
			y: e.y,
			similarity: e.similarity,
			temperature: e.temperature
		}));
	}

	const cloudNodes = $derived.by((): PuzzleSnapshotNode[] => [
		...puzzle.snapshot.nodes,
		...syntheticToNodes(progress.syntheticGridByKey)
	]);
	let guesses = $state<GuessKindLine[]>([]);

	/** Scrollbarer Hinweisbereich (für neuen Eintrag + Scroll nach oben) */
	let hintListEl = $state<HTMLElement | undefined>(undefined);
	/** Aktueller Eintrag kurz zur optischen Rückmeldung hervorgehoben */
	let popGuessKey = $state<string | null>(null);

	function sortGuessesForDisplay(lines: GuessKindLine[]): GuessKindLine[] {
		const grid: Extract<GuessKindLine, { kind: 'grid' }>[] = [];
		const off: Extract<GuessKindLine, { kind: 'off' }>[] = [];
		for (const line of lines) {
			if (line.kind === 'grid') grid.push(line);
			else off.push(line);
		}
		grid.sort((a, b) => {
			if (a.rank !== b.rank) return a.rank - b.rank;
			return b.similarityPct - a.similarityPct;
		});
		return [...grid, ...off];
	}

	const displayedGuesses = $derived.by(() => {
		const recent = guesses.length <= 30 ? guesses : guesses.slice(-30);
		return sortGuessesForDisplay(recent);
	});

	async function highlightNewGuess(key: string) {
		await tick();
		popGuessKey = key;
		await tick();
		requestAnimationFrame(() => {
			const root = hintListEl;
			if (!root) return;
			const el = root.querySelector(`[data-guess-key="${CSS.escape(key)}"]`);
			el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		});
		window.setTimeout(() => {
			hintListEl?.scrollTo({ top: 0, behavior: 'smooth' });
		}, 1050);
		window.setTimeout(() => {
			popGuessKey = null;
		}, 1550);
	}

	onMount(() => {
		const stored = loadPuzzleProgress(puzzle.id);
		const merged = [...puzzle.snapshot.nodes, ...syntheticToNodes(stored.syntheticGridByKey)];
		const nodeMap = snapshotNodeByLemmaKey(merged);
		const vocabMap = new Map(vocabulary.map((v) => [v.key, v] as const));
		const lines: GuessKindLine[] = [];

		for (const key of stored.guessedLemmaKeysInOrder) {
			const lemmaDisplay = vocabMap.get(key)?.lemma ?? key;
			const sn = nodeMap.get(key);
			if (!sn) {
				lines.push({ kind: 'off', lemmaDisplay, key });
				continue;
			}
			const rank = similarityRankAcrossSnapshot(merged, key) ?? 0;
			lines.push({
				kind: 'grid',
				lemmaDisplay,
				key,
				rank,
				similarityPct: Math.round(sn.similarity * 1000) / 10,
				tempWord: de.game.temperatureLabel[sn.temperature]
			});
		}

		let mainSolved = stored.mainSolved;
		const targetHit = stored.guessedLemmaKeysInOrder.some((k) => k === puzzle.targetGermanKey);
		if (targetHit && nodeMap.has(puzzle.targetGermanKey)) mainSolved = true;

		guesses = lines;
		progress = {
			...stored,
			v: 2,
			syntheticGridByKey: stored.syntheticGridByKey ?? {},
			mainSolved,
			bonusLanguageSolved: !!stored.bonusLanguageSolved,
			bonusCountrySolved: !!stored.bonusCountrySolved
		};
	});

	const gridGuessedKeys = $derived.by(
		() => new Set(progress.guessedLemmaKeysInOrder)
	);

	let conceptEdges = $state<{ fromKey: string; toKey: string; weight?: number }[]>([]);

	$effect(() => {
		const puzzleId = puzzle.id;
		const ac = new AbortController();

		if (progress.mainSolved || gridGuessedKeys.size < 2) {
			conceptEdges = [];
			return () => ac.abort();
		}

		const vocabMap = new Map(vocabulary.map((v) => [v.key, v] as const));
		const syn = progress.syntheticGridByKey ?? {};
		const lemmas = [...gridGuessedKeys].map((key) => ({
			key,
			lemma: vocabMap.get(key)?.lemma ?? syn[key]?.lemma ?? key
		}));

		void (async () => {
			try {
				const res = await fetch('/api/conceptnet/graph', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ lemmas }),
					signal: ac.signal
				});
				if (!res.ok) return;
				const j = (await res.json()) as {
					edges?: { fromKey: string; toKey: string; weight?: number }[];
				};
				if (!ac.signal.aborted && puzzleId === puzzle.id) {
					conceptEdges = j.edges ?? [];
				}
			} catch {
				/* Abbruch oder Netzwerk */
			}
		})();

		return () => ac.abort();
	});

	function persist(next: Partial<PuzzleProgressStored>) {
		const merged: PuzzleProgressStored = {
			...progress,
			...next,
			v: 2,
			syntheticGridByKey: next.syntheticGridByKey ?? progress.syntheticGridByKey ?? {}
		};
		progress = merged;
		savePuzzleProgress(puzzle.id, merged);
	}

	async function submitGuess(entry: VocabularyEntry) {
		feedback = undefined;
		const key = entry.key;

		if (progress.guessedLemmaKeysInOrder.includes(key)) {
			feedback = de.game.duplicateGuess;
			return;
		}

		let data: {
			ok: boolean;
			reason?: string;
			layout?: 'snapshot' | 'conceptnet' | 'embedding';
			similarity?: number;
			rank?: number;
			temperature?: 'cold' | 'warm' | 'hot';
			x?: number;
			y?: number;
			lemma?: string;
		};
		try {
			const res = await fetch(`/api/puzzle/${puzzle.id}/guess`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ lemma: entry.lemma })
			});
			data = (await res.json()) as typeof data;
			if (!res.ok || !data.ok) {
				let showErr = true;
				if (data.reason === 'not_in_vocab') showErr = false;
				if (showErr) feedback = de.guessTelemetry.failed;
				return;
			}
		} catch {
			feedback = de.guessTelemetry.failed;
			return;
		}

		const sim = data.similarity ?? 0;
		const temp = data.temperature ?? 'cold';
		const rank = data.rank ?? 0;

		let nextSynthetic = { ...(progress.syntheticGridByKey ?? {}) };
		if (
			(data.layout === 'conceptnet' || data.layout === 'embedding') &&
			data.x != null &&
			data.y != null &&
			data.lemma
		) {
			nextSynthetic[key] = {
				lemma: data.lemma,
				x: data.x,
				y: data.y,
				similarity: sim,
				temperature: temp
			};
		}

		const nextKeys = [...progress.guessedLemmaKeysInOrder, key];
		persist({
			guessedLemmaKeysInOrder: nextKeys,
			syntheticGridByKey: nextSynthetic,
			...(key === puzzle.targetGermanKey ? { mainSolved: true } : {})
		});

		if (key === puzzle.targetGermanKey) {
			recordMainSolveForUtcToday();
		}

		guesses = [
			...guesses,
			{
				kind: 'grid' as const,
				lemmaDisplay: entry.lemma,
				key,
				rank,
				similarityPct: Math.round(sim * 1000) / 10,
				tempWord: de.game.temperatureLabel[temp]
			}
		];

		await highlightNewGuess(key);
	}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
	<section
		class="mx-6 mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
		aria-label="Wortwolke"
	>
		<div
			class="relative flex min-h-0 flex-1 overflow-hidden rounded-xl border border-primary/35 bg-gradient-to-br from-primary/[0.11] via-transparent to-accent/[0.08] px-3 pb-4 pt-3 ring-1 ring-inset ring-primary/25 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] [min-height:min(52vh,360px)]"
		>
			<WordCloud
				puzzleId={puzzle.id}
				nodes={cloudNodes}
				guessedLemmaKeys={gridGuessedKeys}
				guessedLemmaKeysInOrder={progress.guessedLemmaKeysInOrder}
				solved={progress.mainSolved}
				targetGermanKey={puzzle.targetGermanKey}
				targetForeign={puzzle.targetForeign}
				conceptEdges={conceptEdges}
			/>
		</div>
	</section>

	{#if progress.mainSolved}
		<div class="mx-6 mt-6 rounded-xl border border-border bg-bg/70 px-5 py-4">
			<p class="text-sm font-semibold text-accent">{de.game.revealSectionTitle}</p>
			<p class="mt-2 text-lg text-text">
				{de.game.revealTargetEn.replace('{wort}', puzzle.targetGermanCanonical)}
			</p>
			{#if puzzle.targetForeign}
				<p class="mt-2 text-sm text-muted">
					{de.game.revealForeignWord.replace('{wort}', puzzle.targetForeign)}
				</p>
			{/if}
		</div>
	{/if}

	{#if guesses.length > 0}
		<section
			class="mx-6 mt-6 flex min-h-0 max-h-[min(36vh,280px)] shrink-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-surface/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
			aria-labelledby="hints-panel-h"
		>
			<header
				class="shrink-0 border-b border-border/60 bg-surface px-4 pb-3.5 pt-3.5"
			>
				<h2
					id="hints-panel-h"
					class="text-xs font-semibold uppercase tracking-wider text-muted"
				>
					{de.game.guessHeading}
					<span class="sr-only"> — {de.game.guessListSortedByRank}</span>
				</h2>
			</header>
			<div
				bind:this={hintListEl}
				class="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-pb-4 px-4"
			>
				<ul class="flex flex-col gap-3.5 pb-6 pt-4">
				{#each displayedGuesses as g (g.key)}
					{#if g.kind === 'grid'}
						{@const gh = guessListHeat(g.similarityPct)}
						<li
							data-guess-key={g.key}
							class="guess-feedback-row flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-border/25 px-3 py-2 text-sm {popGuessKey === g.key
								? 'guess-feedback-row--pulse'
								: ''}"
							style={gh.rowStyle}
						>
							<span
								aria-hidden="true"
								class="mt-2 h-2 w-2 shrink-0 rounded-full ring-1 ring-white/15"
								style:background={gh.dotSwatch}
							></span>
							<strong style:color={gh.lemmaColor}>{g.lemmaDisplay}</strong>
							<span class="text-muted" style:opacity={gh.metaOpacity}>{g.similarityPct}% ähnlich</span>
							<span class="text-muted" style:opacity={gh.metaOpacity}>·</span>
							<span class="text-muted" style:opacity={gh.metaOpacity}>{g.tempWord}</span>
							<span class="text-muted" style:opacity={gh.metaOpacity}>·</span>
							<span class="text-muted" style:opacity={gh.metaOpacity}
								>{de.game.rankLabel.replace('{n}', String(g.rank))}</span>
							<span class="sr-only">
								{de.game.normalHintAria
									.replace('{lemma}', g.lemmaDisplay)
									.replace('{pct}', String(g.similarityPct))
									.replace('{rang}', String(g.rank))}
							</span>
						</li>
					{:else}
						<li
							data-guess-key={g.key}
							class="guess-feedback-row rounded-md border border-dashed border-border/80 px-3 py-2 text-sm text-muted {popGuessKey ===
							g.key
								? 'guess-feedback-row--pulse'
								: ''}"
						>
							{g.lemmaDisplay} · {de.game.offGridGuess}
							<span class="sr-only">{de.game.offGridAria}</span>
						</li>
					{/if}
				{/each}
				</ul>
			</div>
		</section>
	{/if}

	{#if feedback}
		<p aria-live="polite" class="mx-6 mt-3 text-xs text-accent" role="status">{feedback}</p>
	{/if}

	<div
		class="relative mx-6 mt-auto shrink-0 border-t border-border/50 bg-bg/95 pb-[max(1.5rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] pt-6 backdrop-blur-md"
		style:padding-inline="max(1rem, env(safe-area-inset-inline, 0px))"
	>
		<VocabSearch
			{vocabulary}
			disabled={progress.mainSolved}
			onselect={submitGuess}
		/>
	</div>
</div>
