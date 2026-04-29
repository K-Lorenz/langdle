<script lang="ts">
	import type { PuzzleSnapshotNode } from '$lib/game/types';
	import {
		bubbleInsideTextFill,
		bubbleLayoutForLemma,
		bubbleLayoutForeignClue,
		foreignClueBadgeMetrics
	} from '$lib/game/similarityHeat';
	import { snapshotNodeByLemmaKey } from '$lib/game/snapshot';
	import * as d3 from 'd3';

	type ConceptEdge = { fromKey: string; toKey: string; weight?: number };

	type Props = {
		puzzleId: number;
		nodes: PuzzleSnapshotNode[];
		guessedLemmaKeys: ReadonlySet<string>;
		/** Rate-Reihenfolge für „Peek“ auf den neuen Gitter-Hinweis */
		guessedLemmaKeysInOrder?: readonly string[];
		solved: boolean;
		targetGermanKey: string;
		targetForeign: string;
		/** ConceptNet-Kanten zwischen geratenen Lemmata (Obsidian-artig). */
		conceptEdges?: readonly ConceptEdge[];
	};

	let {
		puzzleId,
		nodes,
		guessedLemmaKeys,
		guessedLemmaKeysInOrder = [],
		solved,
		targetGermanKey,
		targetForeign,
		conceptEdges = []
	}: Props = $props();

	/** Rate-Liste-Länge am Ende des vorherigen Effect-Laufs → erkennt „neuer Buchstabe eingegangen“ ohne Hydration zu peaken */
	let peekPrevPuzzleId = -1;
	let peekBaselineOrderLen = -1;

	let container = $state<HTMLDivElement | undefined>(undefined);
	let svgEl = $state<SVGSVGElement | undefined>(undefined);

	const DOMAIN_PAD = 0.14;

	const MARGIN_X = 72;
	const MARGIN_TOP = 70;
	const MARGIN_BOTTOM = 100;

	function makeScales(w: number, h: number) {
		const xs = nodes.map((n) => n.x);
		const ys = nodes.map((n) => n.y);
		const xExt: [number, number] = [
			(d3.min(xs) ?? -1) - DOMAIN_PAD,
			(d3.max(xs) ?? 1) + DOMAIN_PAD
		];
		const yExt: [number, number] = [
			(d3.min(ys) ?? -1) - DOMAIN_PAD,
			(d3.max(ys) ?? 1) + DOMAIN_PAD
		];
		return {
			sx: d3.scaleLinear().domain(xExt).range([MARGIN_X, w - MARGIN_X]),
			sy: d3.scaleLinear().domain(yExt).range([h - MARGIN_BOTTOM, MARGIN_TOP])
		};
	}

	$effect(() => {
		const box = container;
		const el = svgEl;
		if (!box || !el) return;

		const _puzzleId = puzzleId;
		const _nodes = nodes;
		const _guessed = guessedLemmaKeys;
		const _order = guessedLemmaKeysInOrder;
		const _solved = solved;
		const _targetKey = targetGermanKey;
		const _targetForeign = targetForeign;
		const _conceptEdges = conceptEdges;

		if (peekPrevPuzzleId !== _puzzleId) {
			peekPrevPuzzleId = _puzzleId;
			peekBaselineOrderLen = -1;
		}

		const svgSel = d3.select(el);
		const layerOuter = svgSel.select<SVGGElement>('g.layers');
		const canvas = svgSel.select<SVGGElement>('g.paint');

		const w = Math.max(box.clientWidth, 200);
		const h = Math.max(box.clientHeight, 200);
		svgSel.attr('viewBox', `0 0 ${w} ${h}`).attr('width', '100%').attr('height', '100%');

		const { sx, sy } = makeScales(w, h);

		function layoutFor(n: PuzzleSnapshotNode) {
			if (n.lemmaNormalizedKey === _targetKey && !_solved) {
				return bubbleLayoutForeignClue(_targetForeign);
			}
			return bubbleLayoutForLemma(n.lemma, n.similarity);
		}

		const inflateX = 32;
		const inflateYTop = 40;
		const inflateYBottom = 88;

		function screenExtentsForCircles(items: { x: number; y: number; radiusPx: number }[]) {
			let x0 = Infinity,
				y0 = Infinity,
				x1 = -Infinity,
				y1 = -Infinity;
			for (const it of items) {
				const r = it.radiusPx + 6;
				const sxv = sx(it.x);
				const syv = sy(it.y);
				x0 = Math.min(x0, sxv - r);
				x1 = Math.max(x1, sxv + r);
				y0 = Math.min(y0, syv - r);
				y1 = Math.max(y1, syv + r);
			}
			x0 -= inflateX;
			x1 += inflateX;
			y0 -= inflateYTop;
			y1 += inflateYBottom;
			return {
				boxW: Math.max(x1 - x0, 48),
				boxH: Math.max(y1 - y0, 48),
				cx: (x0 + x1) / 2,
				cy: (y0 + y1) / 2
			};
		}

		canvas.selectAll('*').remove();

		const snapByKey = snapshotNodeByLemmaKey(_nodes);

		if (_solved) {
			const visibleNodes = _nodes.filter((n) => {
				const isTarget = n.lemmaNormalizedKey === _targetKey;
				const guessed = _guessed.has(n.lemmaNormalizedKey);
				return _solved || isTarget || guessed;
			});
			visibleNodes.sort((a, b) => {
				const aT = a.lemmaNormalizedKey === _targetKey;
				const bT = b.lemmaNormalizedKey === _targetKey;
				if (aT === bT) return 0;
				return aT ? 1 : -1;
			});

			for (const n of visibleNodes) {
				const isTarget = n.lemmaNormalizedKey === _targetKey;
				const guessed = _guessed.has(n.lemmaNormalizedKey);

				const layout = layoutFor(n);
				const g = canvas.append('g').attr('transform', `translate(${sx(n.x)},${sy(n.y)})`);

				const heat = layout.heat;
				const isReveal = isTarget && _solved;
				const labelFill = isReveal ? 'rgba(255,255,255,0.96)' : bubbleInsideTextFill(n.similarity);
				const fillCircle = isReveal ? 'var(--color-accent)' : heat.dotFill;
				const pulseR = isReveal ? layout.radiusPx + 18 : 0;

				if (isReveal) {
					g.append('circle')
						.attr('r', 0)
						.attr('fill', 'none')
						.attr('stroke', 'var(--color-accent)')
						.attr('stroke-width', 2)
						.attr('opacity', 0.85)
						.transition()
						.duration(920)
						.ease(d3.easeCubicOut)
						.attr('r', pulseR)
						.attr('opacity', 0);
				}

				const dotRadius = layout.radiusPx;
				const circle = g
					.append('circle')
					.attr('r', isReveal ? 0 : dotRadius)
					.attr('fill', fillCircle)
					.attr('stroke', 'rgba(255,255,255,0.12)')
					.attr('stroke-width', 1)
					.attr('opacity', 1);

				if (isReveal) {
					circle
						.transition()
						.delay(105)
						.duration(680)
						.ease(d3.easeBackOut.overshoot(1.35))
						.attr('r', dotRadius);
				}

				const showLabel = _solved || guessed;
				if (showLabel) {
					const fs = isReveal ? Math.max(layout.fontSizePx + 1, 15) : layout.fontSizePx;
					const labelOp = Math.max(heat.textA, 0.78);
					const label = g
						.append('text')
						.text(n.lemma)
						.attr('text-anchor', 'middle')
						.attr('dominant-baseline', 'central')
						.attr('paint-order', 'stroke fill')
						.attr('transform', 'rotate(0)')
						.attr('fill', labelFill)
						.attr('font-size', isReveal ? 0 : fs)
						.attr('font-weight', isReveal ? 800 : heat.fontWeight)
						.attr('opacity', isReveal ? 0 : labelOp);

					if (isReveal) {
						label
							.transition()
							.delay(265)
							.duration(740)
							.ease(d3.easeBackOut.overshoot(1.1))
							.attr('font-size', fs)
							.attr('opacity', 1);
					}
				}
			}
		} else {
			const guessedOnly = _nodes.filter((n) => _guessed.has(n.lemmaNormalizedKey));

			const edgesG = canvas.append('g').attr('class', 'concept-edges');
			for (const e of _conceptEdges) {
				const na = snapByKey.get(e.fromKey);
				const nb = snapByKey.get(e.toKey);
				if (!na || !nb) continue;
				const w = typeof e.weight === 'number' ? e.weight : 1;
				const strokeW = 1.05 + Math.min(3.5, Math.max(0, w)) * 0.32;
				edgesG
					.append('line')
					.attr('x1', sx(na.x))
					.attr('y1', sy(na.y))
					.attr('x2', sx(nb.x))
					.attr('y2', sy(nb.y))
					.attr('stroke', 'rgba(152, 142, 208, 0.5)')
					.attr('stroke-width', strokeW)
					.attr('stroke-linecap', 'round');
			}

			for (const n of guessedOnly) {
				const layout = bubbleLayoutForLemma(n.lemma, n.similarity);
				const heat = layout.heat;
				const g = canvas.append('g').attr('transform', `translate(${sx(n.x)},${sy(n.y)})`);

				g.append('circle')
					.attr('r', layout.radiusPx)
					.attr('fill', heat.dotFill)
					.attr('stroke', 'rgba(255,255,255,0.12)')
					.attr('stroke-width', 1);

				g.append('text')
					.text(n.lemma)
					.attr('text-anchor', 'middle')
					.attr('dominant-baseline', 'central')
					.attr('fill', bubbleInsideTextFill(n.similarity))
					.attr('font-size', layout.fontSizePx)
					.attr('font-weight', heat.fontWeight)
					.attr('opacity', Math.max(heat.textA, 0.78));
			}

			const targetNode = _nodes.find((n) => n.lemmaNormalizedKey === _targetKey);
			if (targetNode) {
				const layout = bubbleLayoutForeignClue(_targetForeign);
				const badge = foreignClueBadgeMetrics(layout, _targetForeign);
				const g = canvas.append('g').attr('transform', `translate(${sx(targetNode.x)},${sy(targetNode.y)})`);

				g.append('circle')
					.attr('r', layout.radiusPx + 10)
					.attr('fill', 'rgba(145, 134, 230, 0.12)')
					.attr('stroke', 'none');

				g.append('rect')
					.attr('x', -badge.halfW)
					.attr('y', -badge.halfH)
					.attr('width', badge.halfW * 2)
					.attr('height', badge.halfH * 2)
					.attr('rx', badge.rx)
					.attr('fill', 'rgba(26, 22, 58, 0.97)')
					.attr('stroke', 'var(--color-primary)')
					.attr('stroke-width', 2.25);

				g.append('text')
					.text(_targetForeign)
					.attr('text-anchor', 'middle')
					.attr('dominant-baseline', 'central')
					.attr('fill', '#fefeff')
					.attr('font-size', layout.fontSizePx)
					.attr('font-weight', 700)
					.attr('stroke', 'rgba(8, 5, 22, 0.65)')
					.attr('stroke-width', 0.85)
					.attr('paint-order', 'stroke fill');
			}
		}

		const targetNode = _nodes.find((n) => n.lemmaNormalizedKey === _targetKey);
		const guessedNodes = _nodes.filter((n) => _guessed.has(n.lemmaNormalizedKey));

		function transformCenterOnTarget(): d3.ZoomTransform {
			let tx = w / 2;
			let ty = h / 2;
			if (targetNode) {
				tx = sx(targetNode.x);
				ty = sy(targetNode.y);
			}
			return d3.zoomIdentity.translate(w / 2, h / 2).scale(1).translate(-tx, -ty);
		}

		const orderLenPrev = peekBaselineOrderLen;
		const orderGrowing = orderLenPrev >= 0 && _order.length > orderLenPrev;
		const tailKey = _order.length === 0 ? null : _order[_order.length - 1]!;
		const tailOnGridPeek =
			tailKey != null && snapByKey.has(tailKey) && tailKey !== _targetKey;

		const playPeekIntoNewGuess =
			!_solved &&
			targetNode &&
			orderGrowing &&
			tailOnGridPeek &&
			guessedNodes.length > 0;

		let transformHome = transformCenterOnTarget();
		let transformPeek: d3.ZoomTransform | null = null;

		if (_solved) {
			const extentItems = _nodes.map((n) => ({
				x: n.x,
				y: n.y,
				radiusPx: layoutFor(n).radiusPx
			}));
			const { boxW, boxH, cx, cy } = screenExtentsForCircles(extentItems);
			const padPx = Math.max(MARGIN_BOTTOM + 64, Math.max(MARGIN_X, MARGIN_TOP) + 64, 168);
			const maxScale = 1.45;
			const rawScale = Math.min((w - 2 * padPx) / boxW, (h - 2 * padPx) / boxH, maxScale);
			const scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
			transformHome = d3.zoomIdentity.translate(w / 2, h / 2).scale(scale).translate(-cx, -cy);
		} else if (playPeekIntoNewGuess && tailKey != null) {
			const tailNode = snapByKey.get(tailKey);
			if (tailNode) {
				const lay = bubbleLayoutForLemma(tailNode.lemma, tailNode.similarity);
				const cx = sx(tailNode.x);
				const cy = sy(tailNode.y);
				const R = lay.radiusPx + 26;
				const padPeek = 48;
				const kPeek = Math.min(
					3,
					Math.max(1.12, (Math.min(w, h) - 2 * padPeek) / (2 * Math.max(R, 12)))
				);
				transformPeek = d3.zoomIdentity.translate(w / 2, h / 2).scale(kPeek).translate(-cx, -cy);
			}
		}

		peekBaselineOrderLen = _order.length;

		const zoom = d3
			.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.18, 10])
			.on('zoom', (ev) => layerOuter.attr('transform', ev.transform.toString()));
		svgSel.call(zoom);

		svgSel.interrupt();

		if (_solved) {
			svgSel.transition().duration(1380).ease(d3.easeBackOut.overshoot(0.28)).call(zoom.transform, transformHome);
		} else if (guessedNodes.length === 0) {
			svgSel.transition().duration(0).call(zoom.transform, transformHome);
		} else if (transformPeek !== null) {
			svgSel
				.transition()
				.duration(430)
				.ease(d3.easeCubicOut)
				.call(zoom.transform, transformPeek)
				.transition()
				.duration(760)
				.ease(d3.easeCubicInOut)
				.call(zoom.transform, transformHome);
		} else {
			/* Nur bewegen, wenn die Liste schon „eingefroren“ war und sich nicht gerade verlängert hat (sonst Doppel-Peek oder Stillstand) */
			const settleMs =
				orderLenPrev < 0 || orderGrowing || orderLenPrev === _order.length ? 0 : 480;
			svgSel.transition().duration(settleMs).ease(d3.easeCubicInOut).call(zoom.transform, transformHome);
		}

		const ro = new ResizeObserver(() => {
			const nw = Math.max(box.clientWidth, 200);
			const nh = Math.max(box.clientHeight, 200);
			svgSel.attr('viewBox', `0 0 ${nw} ${nh}`);
		});
		ro.observe(box);

		return () => ro.disconnect();
	});
</script>

<div
	bind:this={container}
	class="relative isolate size-full min-h-0 touch-none overflow-hidden [&>svg]:min-h-0"
	role="presentation"
>
	<svg
		bind:this={svgEl}
		class="block size-full max-h-full min-h-0 overflow-hidden"
		preserveAspectRatio="xMidYMid meet"
	>
		<g class="layers">
			<g class="paint" />
		</g>
	</svg>
</div>
