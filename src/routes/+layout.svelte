<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex h-[100svh] max-h-[100svh] flex-col overflow-hidden bg-bg font-sans text-text">
	<main class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
		{@render children()}
	</main>
</div>
