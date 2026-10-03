import { describe, it, expect } from "vitest";
import { choosePanelPlacement, segmentToRects } from "../../src/lib/panelPlacement.js";

/** @param {{x:number,y:number,w:number,h:number}} a @param {{x:number,y:number,w:number,h:number}} b */
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const bounds = { x: 0, y: 0, w: 1000, h: 800 };
const view = bounds;

describe("choosePanelPlacement", () => {
  it("picks a free corner when the network sits on one side", () => {
    // two PCs + link in the left half
    const obstacles = [
      { x: 50, y: 350, w: 110, h: 70 },
      { x: 220, y: 350, w: 110, h: 70 },
      ...segmentToRects({ x: 105, y: 385 }, { x: 275, y: 385 }),
    ];
    const p = choosePanelPlacement({ bounds, view, size: { w: 600, h: 540 }, obstacles });
    expect(p.shift).toEqual({ dx: 0, dy: 0 });
    for (const o of obstacles) expect(overlaps(p, o)).toBe(false);
  });

  it("shrinks a resizable panel (but not below 85 % / minSize) to find a free spot", () => {
    // network in the middle row: a 600x540 panel can't avoid it, 510x459 can (above it)
    const obstacles = [{ x: 450, y: 480, w: 110, h: 70 }];
    const p = choosePanelPlacement({ bounds, view, size: { w: 600, h: 540 }, minSize: { w: 320, h: 300 }, obstacles });
    expect(p.w).toBeGreaterThanOrEqual(510);
    expect(p.w).toBeLessThan(600);
    expect(overlaps(p, obstacles[0])).toBe(false);
    expect(p.shift).toEqual({ dx: 0, dy: 0 });
  });

  it("pans the network into the free strip when no spot is free", () => {
    // wide row of devices across the middle, panel not resizable
    const obstacles = [{ x: 100, y: 350, w: 110, h: 70 }, { x: 790, y: 350, w: 110, h: 70 }];
    const p = choosePanelPlacement({ bounds, view, size: { w: 600, h: 540 }, obstacles });
    expect(p.shift.dx !== 0 || p.shift.dy !== 0).toBe(true);
    for (const o of obstacles) {
      const moved = { ...o, x: o.x + p.shift.dx, y: o.y + p.shift.dy };
      expect(overlaps(p, moved)).toBe(false);
    }
  });

  it("avoids covering another open panel if the network allows it", () => {
    const obstacles = [{ x: 450, y: 650, w: 110, h: 70 }];
    const first = choosePanelPlacement({ bounds, view, size: { w: 450, h: 500 }, obstacles });
    const second = choosePanelPlacement({ bounds, view, size: { w: 450, h: 500 }, obstacles, avoid: [first] });
    expect(overlaps(first, second)).toBe(false);
    expect(overlaps(second, obstacles[0])).toBe(false);
  });

  it("keeps the panel inside the bounds", () => {
    const p = choosePanelPlacement({ bounds, view, size: { w: 600, h: 540 }, obstacles: [] });
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x + p.w).toBeLessThanOrEqual(1000);
    expect(p.y + p.h).toBeLessThanOrEqual(800);
  });
});
