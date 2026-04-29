/** Deterministic pseudo-shuffle: gleiche Reihenfolge auf Server und Client. */
export function shuffleStable<T>(arr: readonly T[], seed: number): T[] {
	const a = [...arr];
	let state = seed >>> 0;
	const nextFloat = (): number => {
		state = (Math.imul(state, 48271) + 1337) % 2147483647;
		return state / 2147483647;
	};
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(nextFloat() * (i + 1));
		[a[i], a[j]] = [a[j]!, a[i]!];
	}
	return a;
}
