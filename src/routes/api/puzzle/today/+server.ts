import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { de } from '$lib/strings/de';
import { db } from '$lib/server/db';
import { puzzles } from '$lib/server/db/schema';

const toIsoDate = (now: Date) => now.toISOString().slice(0, 10);

export const GET = async () => {
	const today = toIsoDate(new Date());

	const puzzle = await db.query.puzzles.findFirst({
		where: eq(puzzles.puzzleDate, today)
	});

	if (!puzzle) {
		return json(
			{
				nachricht: de.api.keinRaetselHeute,
				datum: today
			},
			{ status: 404 }
		);
	}

	return json({
		puzzle: {
			id: puzzle.id,
			number: puzzle.puzzleNumber,
			date: puzzle.puzzleDate,
			targetForeign: puzzle.targetForeign,
			targetGermanCanonical: puzzle.targetGermanCanonical,
			snapshotVersion: puzzle.snapshotVersion,
			snapshot: puzzle.snapshot
		}
	});
};
