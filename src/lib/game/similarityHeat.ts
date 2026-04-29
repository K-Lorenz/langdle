/** Einheitliche Näherungs-Skala: kühl/blau-grau → feurig für Wolke und Hinweisliste. */

/** Damit sehr niedrige Nähe (z. B. ~5 % ähnlich) nie „verschwindet“. */
const MIN_DOT_ALPHA = 0.44;
const MIN_TEXT_ALPHA = 0.42;
const MIN_META_OPACITY = 0.58;
const MIN_LEMMA_LINE_ALPHA = 0.74;
const MIN_ROW_BORDER_ALPHA = 0.52;
const MIN_ROW_SHIMMER_ALPHA = 0.085;

export function clamp01(x: number): number {
	return Math.max(0, Math.min(1, x));
}

export type SimilarityHeat = {
	t: number;
	dotFill: string;
	dotR: number;
	textFill: string;
	fontSize: number;
	fontWeight: number;
	textA: number;
};

/** Nähe zum Zielwort: kühles Blau-Grau → feuriges Rot (mit Mindestlesbarkeit). */
export function heatFromSimilarity(similarity: number): SimilarityHeat {
	const t = clamp01(similarity);
	const dr = 26 + t * 229;
	const dg = 32 + t * 88;
	const db = 58 + t * 42;
	const dotA = MIN_DOT_ALPHA + t * (0.93 - MIN_DOT_ALPHA);
	const dotFill = `rgba(${Math.round(dr)},${Math.round(dg)},${Math.round(db)},${dotA})`;
	const dotR = 1.85 + t * 8.15;
	const tr = 70 + t * 185;
	const tg = 75 + t * 95;
	const tb = 110 + t * 70;
	const textA = MIN_TEXT_ALPHA + t * (1 - MIN_TEXT_ALPHA);
	const textFill = `rgba(${Math.round(tr)},${Math.round(tg)},${Math.round(tb)},${textA})`;
	/* SVG-Pixel: kompakt, obere Kante ~7–16px */
	const fontSize = 7 + t * 9;
	const fontWeight = t > 0.72 ? 700 : t > 0.4 ? 600 : 400;
	return { t, dotFill, dotR, textFill, fontSize, fontWeight, textA };
}

export type BubbleLayout = {
	radiusPx: number;
	fontSizePx: number;
	heat: SimilarityHeat;
};

/**
 * Skaliert einen Kreis so, dass das Lemma mittig hineinpasst — `similarity` spannt minimale/maximale Bubble-Größe.
 */
export function bubbleLayoutForLemma(lemmaRaw: string, similarity: number): BubbleLayout {
	const heat = heatFromSimilarity(similarity);
	const { t } = heat;
	const lemma = lemmaRaw.trim() || '?';
	const len = Math.min(lemma.length, 40);

	/* Relativ klein zur Einbettung: weniger Overlap bei ähnlicher Nähe. */
	const rFloor = 11 + t * 12;
	const rCeil = 26 + t * 20;

	let fs = 6.5 + t * 11;
	const fsMin = 5 + t * 4.25;

	function circleRadius(fontSize: number): number {
		const halfW = (len * fontSize * 0.52) / 2 + 10;
		const halfH = fontSize * 0.7 + 8;
		return Math.max(Math.sqrt(halfW ** 2 + halfH ** 2), rFloor * 0.9);
	}

	while (circleRadius(fs) > rCeil && fs > fsMin + 0.2) {
		fs -= 0.45;
	}

	let radiusPx = Math.min(Math.max(circleRadius(fs), rFloor), rCeil);
	let fontSizePx = fs;
	if (circleRadius(fontSizePx) > radiusPx) {
		while (circleRadius(fontSizePx) > radiusPx && fontSizePx > fsMin) {
			fontSizePx -= 0.35;
		}
	}
	radiusPx = Math.min(Math.max(circleRadius(fontSizePx), rFloor), rCeil);

	/* Feintuning: Knoten haben feste Datenabstände — etwas kleinere Kreise = optisch weiter auseinander. */
	radiusPx = Math.round(radiusPx * 0.9 * 100) / 100;
	fontSizePx = Math.round(Math.max(fontSizePx * 0.95, fsMin) * 100) / 100;

	return { radiusPx, fontSizePx, heat };
}

/** Helle Label-Farbe im Inneren gefüllter Bubbles */
export function bubbleInsideTextFill(similarity: number): string {
	const t = clamp01(similarity);
	const opacity = Math.min(1, 0.58 + t * 0.4);
	return `rgba(252, 250, 255, ${opacity})`;
}

/** Fremdwort vor dem Auflösen — lesbar aber nicht maximal, damit es nicht andere Bubbles schneidet */
export function bubbleLayoutForeignClue(word: string): BubbleLayout {
	return bubbleLayoutForLemma(word.trim() || '?', 0.88);
}

export type LemmaLinesLayout = BubbleLayout & {
	lines: string[];
	lineHeightPx: number;
};

/**
 * Mehrzeiliges Cluster-Label — gleiche Heat-Skala wie Einzel-Lemmata.
 */
export function bubbleLayoutForLemmaLines(linesRaw: string[], similarity: number): LemmaLinesLayout {
	const heat = heatFromSimilarity(similarity);
	const { t } = heat;
	const lines = linesRaw.map((l) => (l.trim() || '?').slice(0, 42));
	const lineCount = Math.max(1, lines.length);
	const maxLen = Math.max(...lines.map((l) => l.length), 1);

	const rFloor = 11 + t * 12;
	const rCeil = 28 + t * 22;

	let fs = 6 + t * 10;
	const fsMin = 4.75 + t * 4;

	function circleRadius(fontSize: number): number {
		const lh = fontSize * 1.08;
		const halfW = (maxLen * fontSize * 0.52) / 2 + 12;
		const halfH = (lineCount * lh) / 2 + 10;
		return Math.max(Math.sqrt(halfW ** 2 + halfH ** 2), rFloor * 0.9);
	}

	while (circleRadius(fs) > rCeil && fs > fsMin + 0.2) {
		fs -= 0.45;
	}

	let radiusPx = Math.min(Math.max(circleRadius(fs), rFloor), rCeil);
	let fontSizePx = fs;
	if (circleRadius(fontSizePx) > radiusPx) {
		while (circleRadius(fontSizePx) > radiusPx && fontSizePx > fsMin) {
			fontSizePx -= 0.35;
		}
	}
	radiusPx = Math.min(Math.max(circleRadius(fontSizePx), rFloor), rCeil);

	radiusPx = Math.round(radiusPx * 0.9 * 100) / 100;
	fontSizePx = Math.round(Math.max(fontSizePx * 0.95, fsMin) * 100) / 100;
	const lineHeightPx = Math.round(fontSizePx * 1.08 * 100) / 100;

	return { radiusPx, fontSizePx, heat, lines, lineHeightPx };
}

/** Abgerundetes Badge hinter dem Fremdwort-Hinweis (SVG-Rechteck relativ zur Mitte). */
export function foreignClueBadgeMetrics(layout: BubbleLayout, word: string): {
	halfW: number;
	halfH: number;
	rx: number;
} {
	const w = word.trim() || '?';
	const fs = layout.fontSizePx;
	const halfW = Math.min((w.length * fs * 0.52) / 2 + 16, fs * 14 + 24);
	const halfH = fs * 0.58 + 11;
	const rx = Math.min(14, halfH * 0.85);
	return { halfW, halfH, rx };
}

export type GuessListHeatUi = {
	rowStyle: string;
	lemmaColor: string;
	metaOpacity: number;
	dotSwatch: string;
};

/** Für eine Zeile in „Deine Hinweise“ (`similarityPct` = Anzeige-Prozent wie 87,5). */
export function guessListHeat(similarityPct: number): GuessListHeatUi {
	const h = heatFromSimilarity(similarityPct / 100);
	const { t } = h;
	const br = Math.round(26 + t * 229);
	const bg = Math.round(32 + t * 88);
	const bb = Math.round(58 + t * 42);
	const lr = Math.round(70 + t * 185);
	const lg = Math.round(75 + t * 95);
	const lb = Math.round(110 + t * 70);
	const borderA = MIN_ROW_BORDER_ALPHA + t * (0.9 - MIN_ROW_BORDER_ALPHA);
	const rowGlowA = MIN_ROW_SHIMMER_ALPHA + t * 0.12;
	const rowStyle = [
		`border-left: 3px solid rgba(${br},${bg},${bb},${borderA})`,
		`background-image: linear-gradient(98deg, rgba(${lr},${lg},${lb},${rowGlowA}) 0%, transparent 72%)`,
		`font-weight: ${h.fontWeight > 660 ? 700 : h.fontWeight > 520 ? 600 : 500}`,
		`font-size: ${0.8125 + t * 0.09375}rem`
	].join('; ');
	const lemmaOp = Math.max(MIN_LEMMA_LINE_ALPHA, Math.min(1, 0.58 + t * 0.42));
	const lemmaColor = `rgba(${lr},${lg},${lb},${lemmaOp})`;
	const metaOpacity = Math.max(MIN_META_OPACITY, 0.36 + t * 0.46);
	return { rowStyle, lemmaColor, metaOpacity, dotSwatch: h.dotFill };
}
