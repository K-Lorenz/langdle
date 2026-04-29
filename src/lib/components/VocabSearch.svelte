<script lang="ts">
	import type { VocabularyEntry } from '$lib/game/pageTypes';

	type Props = {
		vocabulary: VocabularyEntry[];
		disabled?: boolean;
		onselect: (entry: VocabularyEntry) => void;
	};

	let { vocabulary, disabled = false, onselect }: Props = $props();

	let inputEl: HTMLInputElement | undefined;
	let draft = $state('');
	let open = $state(false);
	let activeIdx = $state(-1);

	const MAX = 8;

	const matches = $derived.by(() => {
		const q = draft.trim().toLowerCase();
		if (!q || q.length < 1) return [];
		return vocabulary
			.filter((v) => v.lemma.toLowerCase().startsWith(q))
			.slice(0, MAX);
	});

	$effect(() => {
		// Reset active index whenever matches change
		activeIdx = -1;
		open = matches.length > 0;
	});

	function select(entry: VocabularyEntry) {
		draft = '';
		open = false;
		activeIdx = -1;
		onselect(entry);
		inputEl?.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIdx = Math.min(activeIdx + 1, matches.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIdx = Math.max(activeIdx - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const target = activeIdx >= 0 ? matches[activeIdx] : matches[0];
			if (target) select(target);
		} else if (e.key === 'Escape') {
			open = false;
		}
	}

	function onblur() {
		// Delay so click on option registers first
		setTimeout(() => { open = false; }, 150);
	}
</script>

<div class="relative w-full">
	<input
		bind:this={inputEl}
		bind:value={draft}
		{disabled}
		type="text"
		autocomplete="off"
		spellcheck="false"
		placeholder="Begriff eingeben …"
		aria-autocomplete="list"
		aria-expanded={open}
		class="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text placeholder:text-muted transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
		onkeydown={onkeydown}
		onblur={onblur}
	/>

	{#if open}
		<ul
			role="listbox"
			class="absolute bottom-full left-0 right-0 mb-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg z-20"
		>
			{#each matches as entry, i}
				<li
					role="option"
					aria-selected={i === activeIdx}
					class="cursor-pointer px-4 py-2.5 text-sm transition-colors {i === activeIdx
						? 'bg-primary/20 text-primary'
						: 'text-text hover:bg-border/40'}"
					onmousedown={() => select(entry)}
				>
					{entry.lemma}
				</li>
			{/each}
		</ul>
	{/if}
</div>
