//@ts-check

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */

/** Gap kept between the panel and the edge of the area / the content. */
const MARGIN = 12;

/** Shrink steps tried for resizable panels (down to 85 % of the original size). */
const SCALES = [1, 0.85];

/** @param {Rect} a @param {Rect} b */
function overlapArea(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
}

/** @param {Rect[]} rects @returns {Rect|null} */
function union(rects) {
    if (rects.length === 0) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const r of rects) {
        x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
        x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Turns a line segment (e.g. a link between two devices) into a chain of
 * small squares, so it counts as an obstacle along its actual path rather
 * than via its (for diagonal links far too large) bounding box.
 * @param {{x: number, y: number}} a @param {{x: number, y: number}} b
 * @param {number} [thickness]
 * @returns {Rect[]}
 */
export function segmentToRects(a, b, thickness = 14) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / thickness));
    /** @type {Rect[]} */
    const rects = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        rects.push({
            x: a.x + (b.x - a.x) * t - thickness / 2,
            y: a.y + (b.y - a.y) * t - thickness / 2,
            w: thickness,
            h: thickness,
        });
    }
    return rects;
}

/**
 * Candidate panel positions inside `bounds`: the four corners first (they
 * leave the largest connected free area), then the edge centres.
 * @param {Rect} bounds @param {number} w @param {number} h
 * @returns {{x: number, y: number}[]}
 */
function candidatePositions(bounds, w, h) {
    const left = bounds.x + MARGIN;
    const right = bounds.x + bounds.w - w - MARGIN;
    const top = bounds.y + MARGIN;
    const bottom = bounds.y + bounds.h - h - MARGIN;
    const cx = bounds.x + (bounds.w - w) / 2;
    const cy = bounds.y + (bounds.h - h) / 2;
    return [
        { x: right, y: top }, { x: left, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
        { x: cx, y: top }, { x: cx, y: bottom }, { x: left, y: cy }, { x: right, y: cy },
    ].map((p) => ({ x: Math.max(left, Math.min(p.x, right)), y: Math.max(top, Math.min(p.y, bottom)) }));
}

/** Clearance kept between a panel placed near its device and anything it must not cover. */
const CLEARANCE = 12;

/** Raster cell size (px) for the free-spot search; blockers are rounded outward to it. */
const CELL = 4;

/**
 * The free `w`×`h` spot in `bounds` closest to `anchor` (the device's icon)
 * that keeps CLEARANCE to every rect in `blockers`, or null if none exists.
 * Every position on a CELL grid is checked: blockers are rasterised once into
 * a summed-area table, so each check is O(1). Ties go to the spot most
 * centred on the anchor.
 * @param {Rect} bounds @param {number} w @param {number} h @param {Rect} anchor @param {Rect[]} blockers
 * @returns {Rect|null}
 */
function closestFreeSpot(bounds, w, h, anchor, blockers) {
    const cols = Math.floor(bounds.w / CELL), rows = Math.floor(bounds.h / CELL);
    const cw = Math.ceil(w / CELL), ch = Math.ceil(h / CELL);
    const m = Math.ceil(MARGIN / CELL);
    if (cols - 2 * m < cw || rows - 2 * m < ch) return null;

    const occ = new Uint8Array(cols * rows);
    for (const r of blockers) {
        const x0 = Math.max(0, Math.floor((r.x - CLEARANCE - bounds.x) / CELL));
        const x1 = Math.min(cols, Math.ceil((r.x + r.w + CLEARANCE - bounds.x) / CELL));
        const y0 = Math.max(0, Math.floor((r.y - CLEARANCE - bounds.y) / CELL));
        const y1 = Math.min(rows, Math.ceil((r.y + r.h + CLEARANCE - bounds.y) / CELL));
        for (let y = y0; y < y1; y++) occ.fill(1, y * cols + x0, y * cols + Math.max(x0, x1));
    }
    // sat[(y)*(cols+1)+x] = occupied cells in [0,x)×[0,y)
    const W = cols + 1;
    const sat = new Int32Array(W * (rows + 1));
    for (let y = 0; y < rows; y++) {
        let rowSum = 0;
        for (let x = 0; x < cols; x++) {
            rowSum += occ[y * cols + x];
            sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + rowSum;
        }
    }

    const acx = anchor.x + anchor.w / 2, acy = anchor.y + anchor.h / 2;
    /** @type {Rect|null} */
    let best = null;
    let bestGap = Infinity, bestOff = Infinity;
    for (let y = m; y + ch <= rows - m; y++) {
        for (let x = m; x + cw <= cols - m; x++) {
            if (sat[(y + ch) * W + x + cw] - sat[y * W + x + cw] - sat[(y + ch) * W + x] + sat[y * W + x] !== 0) continue;
            const rect = { x: bounds.x + x * CELL, y: bounds.y + y * CELL, w, h };
            const gap = distanceBetween(anchor, rect);
            if (gap > bestGap) continue;
            const off = Math.hypot(rect.x + w / 2 - acx, rect.y + h / 2 - acy);
            if (gap < bestGap || off < bestOff) { best = rect; bestGap = gap; bestOff = off; }
        }
    }
    return best;
}

/** Gap between two rects (0 if they touch or overlap). @param {Rect} a @param {Rect} b */
function distanceBetween(a, b) {
    const dx = Math.max(b.x - (a.x + a.w), 0, a.x - (b.x + b.w));
    const dy = Math.max(b.y - (a.y + a.h), 0, a.y - (b.y + b.h));
    return Math.hypot(dx, dy);
}

/**
 * Smallest move that brings `content` fully inside one of the free strips
 * `view` leaves around `panel` (left/right/above/below it) without moving it
 * under one of the `avoid` rects, or null if there is no such strip.
 * @param {Rect} content @param {Rect} panel @param {Rect} view @param {Rect[]} avoid
 * @returns {{dx: number, dy: number}|null}
 */
function shiftIntoFreeStrip(content, panel, view, avoid) {
    const strips = [
        { x: view.x, y: view.y, w: panel.x - view.x, h: view.h },                              // left
        { x: panel.x + panel.w, y: view.y, w: view.x + view.w - panel.x - panel.w, h: view.h }, // right
        { x: view.x, y: view.y, w: view.w, h: panel.y - view.y },                              // above
        { x: view.x, y: panel.y + panel.h, w: view.w, h: view.y + view.h - panel.y - panel.h }, // below
    ];
    /** @type {{dx: number, dy: number}|null} */
    let best = null;
    for (const s of strips) {
        const inner = { x: s.x + MARGIN, y: s.y + MARGIN, w: s.w - 2 * MARGIN, h: s.h - 2 * MARGIN };
        if (content.w > inner.w || content.h > inner.h) continue;
        const dx = Math.max(inner.x - content.x, Math.min(0, inner.x + inner.w - content.x - content.w));
        const dy = Math.max(inner.y - content.y, Math.min(0, inner.y + inner.h - content.y - content.h));
        const moved = { ...content, x: content.x + dx, y: content.y + dy };
        if (avoid.some((r) => overlapArea(moved, r) > 0)) continue;
        if (!best || Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy)) best = { dx, dy };
    }
    return best;
}

/**
 * Picks where a device panel opens so it covers as little as possible. The
 * candidates, at every allowed size, are the free spot closest to `anchor`
 * (the device's icon, if given) plus the corners and edge centres; they are
 * ranked by, in this order:
 *  1. it doesn't cover the network — either as is, or after panning the
 *     canvas by `shift` so the network fits next to the panel;
 *  2. it covers as little of the other open panels (`avoid`) as possible;
 *  3. it needs no (or as little as possible) panning;
 *  4. it is as large as possible — a resizable panel shrinks to 85 %
 *     (never below `minSize`) before the canvas gets panned;
 *  5. it is as close as possible to `anchor` — otherwise a roomy canvas
 *     would put every panel in the same corner.
 * If no position keeps the network free, the one covering least of it wins.
 *
 * All rects share one coordinate system (e.g. the panel layer's). `bounds` is
 * the area the panel may occupy, `view` the visible canvas (for panning the
 * network), `obstacles` the devices and links; `minSize` null/undefined means
 * the panel is not resizable.
 * @param {{
 *   bounds: Rect,
 *   view: Rect,
 *   size: {w: number, h: number},
 *   minSize?: {w: number, h: number}|null,
 *   obstacles: Rect[],
 *   avoid?: Rect[],
 *   anchor?: Rect|null,
 * }} opts
 * @returns {Rect & { shift: {dx: number, dy: number} }}
 */
export function choosePanelPlacement({ bounds, view, size, minSize, obstacles, avoid = [], anchor = null }) {
    const sizes = (minSize ? SCALES : [1]).map((s) => ({
        w: Math.round(Math.max(minSize?.w ?? 0, size.w * s)),
        h: Math.round(Math.max(minSize?.h ?? 0, size.h * s)),
    }));
    const content = union(obstacles);

    /** @param {Rect} r @param {Rect[]} rects */
    const cost = (r, rects) => rects.reduce((sum, o) => sum + overlapArea(r, o), 0);

    /** @type {{ rect: Rect, shift: {dx: number, dy: number}|null, covered: number, panels: number, sizeIdx: number }[]} */
    const options = [];
    sizes.forEach(({ w, h }, sizeIdx) => {
        const near = anchor ? closestFreeSpot(bounds, w, h, anchor, [...obstacles, ...avoid]) : null;
        if (near) options.push({ rect: near, shift: { dx: 0, dy: 0 }, covered: 0, panels: 0, sizeIdx });
        for (const p of candidatePositions(bounds, w, h)) {
            const rect = { x: p.x, y: p.y, w, h };
            const covered = cost(rect, obstacles);
            const shift = covered === 0 ? { dx: 0, dy: 0 } : content ? shiftIntoFreeStrip(content, rect, view, avoid) : null;
            options.push({ rect, shift, covered, panels: cost(rect, avoid), sizeIdx });
        }
    });

    /** @param {{dx: number, dy: number}|null} s */
    const dist = (s) => (s ? Math.hypot(s.dx, s.dy) : Infinity);
    options.sort((a, b) =>
        (a.shift ? 0 : 1) - (b.shift ? 0 : 1) ||
        (a.shift ? 0 : a.covered - b.covered) ||
        a.panels - b.panels ||
        dist(a.shift) - dist(b.shift) ||
        a.sizeIdx - b.sizeIdx ||
        (anchor ? distanceBetween(anchor, a.rect) - distanceBetween(anchor, b.rect) : 0));

    const best = options[0];
    return { ...best.rect, shift: best.shift ?? { dx: 0, dy: 0 } };
}
