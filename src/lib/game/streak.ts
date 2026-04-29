const STREAK_STORAGE_KEY = 'langdle-streak-v1';

export type StreakState = {
	streak: number;
	lastWinUtcIsoDate: string | null;
};

function empty(): StreakState {
	return { streak: 0, lastWinUtcIsoDate: null };
}

export function utcTodayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

function yesterdayIsoFrom(todayIso: string): string {
	const d = new Date(`${todayIso}T12:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}

export function readStreak(): StreakState {
	if (typeof localStorage === 'undefined') return empty();
	try {
		const raw = localStorage.getItem(STREAK_STORAGE_KEY);
		if (!raw) return empty();
		const p = JSON.parse(raw) as Partial<StreakState>;
		return {
			streak: typeof p.streak === 'number' ? p.streak : 0,
			lastWinUtcIsoDate:
				typeof p.lastWinUtcIsoDate === 'string' || p.lastWinUtcIsoDate === null
					? p.lastWinUtcIsoDate ?? null
					: null
		};
	} catch {
		return empty();
	}
}

/**
 * WICHTIG: Serie zählt in UTC wie das Rätseldatum ([`puzzles.puzzle_date`)).
 * Bei erstem erfolgreichen Lösen des Haupt-Rätsels an einem Kalendertag:
 * wenn gestern bereits gewonnen: streak++; sonst (einschl. erste Teilnahme oder Lücke) streak = 1.
 */
export function recordMainSolveForUtcToday(): StreakState {
	const today = utcTodayIso();
	const prev = readStreak();

	if (prev.lastWinUtcIsoDate === today) {
		dispatchRefresh();
		return prev;
	}

	let nextStreak = 1;
	const y = yesterdayIsoFrom(today);
	if (prev.lastWinUtcIsoDate === y) {
		nextStreak = (prev.streak > 0 ? prev.streak : 0) + 1;
	}

	const next: StreakState = {
		streak: nextStreak,
		lastWinUtcIsoDate: today
	};
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(next));
	}
	dispatchRefresh();
	return next;
}

function dispatchRefresh(): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent('langdle-streak'));
}
