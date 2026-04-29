export type Temperature = 'cold' | 'warm' | 'hot';

export type PuzzleSnapshotNode = {
	lemma: string;
	lemmaNormalizedKey: string;
	x: number;
	y: number;
	similarity: number;
	temperature: Temperature;
	isRevealNode?: boolean;
};
