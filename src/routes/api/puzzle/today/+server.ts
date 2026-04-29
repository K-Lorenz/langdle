import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { countries, languages, puzzleCountries, puzzles } from '$lib/server/db/schema';

const toIsoDate = (now: Date) => now.toISOString().slice(0, 10);

export const GET = async () => {
	const today = toIsoDate(new Date());

	const puzzle = await db.query.puzzles.findFirst({
		where: eq(puzzles.puzzleDate, today)
	});

	if (!puzzle) {
		return json(
			{
				error: 'No puzzle prepared for today yet',
				today
			},
			{ status: 404 }
		);
	}

	const [language] = await db
		.select({
			name: languages.name,
			iso639_3: languages.iso639_3,
			speakersApprox: languages.speakersApprox
		})
		.from(languages)
		.where(eq(languages.id, puzzle.languageId))
		.limit(1);

	const validCountries = await db
		.select({
			name: countries.name,
			iso2: countries.iso2
		})
		.from(puzzleCountries)
		.innerJoin(countries, eq(countries.id, puzzleCountries.countryId))
		.where(eq(puzzleCountries.puzzleId, puzzle.id))
		.orderBy(asc(countries.name));

	return json({
		puzzle: {
			id: puzzle.id,
			number: puzzle.puzzleNumber,
			date: puzzle.puzzleDate,
			targetForeign: puzzle.targetForeign,
			targetGermanCanonical: puzzle.targetGermanCanonical,
			snapshotVersion: puzzle.snapshotVersion,
			snapshot: puzzle.snapshot
		},
		bonus: {
			language,
			validCountries
		}
	});
};
