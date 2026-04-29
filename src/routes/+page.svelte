<script lang="ts">
	import { Globe } from '$lib/icons';
	import GameBoard from '$lib/components/GameBoard.svelte';
	import { de } from '$lib/strings/de';

	let { data } = $props();
</script>

<svelte:head>
	<title>{de.meta.siteTitle}</title>
</svelte:head>

{#if !data.puzzle}
	<div class="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center">
		<Globe size={32} class="text-muted" />
		<p class="text-muted text-sm">{de.api.keinRaetselHeute}</p>
		<p class="text-muted/60 text-xs">Schau später nochmal rein.</p>
	</div>
{:else}
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		<GameBoard puzzle={data.puzzle} vocabulary={data.vocabulary} />
	</div>
{/if}
