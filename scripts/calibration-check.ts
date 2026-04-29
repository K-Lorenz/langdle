/**
 * Smoke-Check für kalibrierte ConceptNet-Ähnlichkeit (manuell: npx tsx scripts/calibration-check.ts).
 */
import {
	calibrateSyntheticSimilarity,
	temperatureFromSyntheticSimilarity
} from '../src/lib/game/syntheticLayout.ts';

const samples = [0.03, 0.12, 0.28, 0.45, 0.62, 0.78, 0.92, 1];

console.log('raw_blend → calibrated_% → temp(synthetic)\n');
for (const x of samples) {
	const c = calibrateSyntheticSimilarity(x);
	const t = temperatureFromSyntheticSimilarity(c);
	console.log(
		`${x.toFixed(2).padStart(4)} → ${(c * 100).toFixed(1).padStart(5)}% → ${t.padEnd(4)} (${(c * 100).toFixed(1)}%)`
	);
}
