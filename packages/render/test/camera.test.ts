import { describe, expect, it } from 'vitest';
import { Camera } from '../src/camera.js';

describe('Camera', () => {
  const make = () => {
    const c = new Camera(1920, 696);
    c.setViewport(1200, 700);
    return c;
  };

  it('screen ↔ world round-trips', () => {
    const c = make();
    c.zoom = 1.7;
    c.centerOn(800, 400);
    const w = c.screenToWorld(123, 456);
    const s = c.worldToScreen(w.x, w.y);
    expect(s.x).toBeCloseTo(123);
    expect(s.y).toBeCloseTo(456);
  });

  it('zoomAt keeps the world point under the cursor fixed', () => {
    const c = make();
    c.zoom = 1;
    c.centerOn(960, 400);
    const before = c.screenToWorld(900, 300);
    c.zoomAt(1.5, 900, 300);
    const after = c.screenToWorld(900, 300);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(c.zoom).toBeCloseTo(1.5);
  });

  it('clamps zoom to its limits', () => {
    const c = make();
    c.zoomAt(100, 600, 350);
    expect(c.zoom).toBe(c.maxZoom);
    c.zoomAt(0.0001, 600, 350);
    expect(c.zoom).toBe(c.minZoom);
  });

  it('keeps the view within the map plus margins when panning', () => {
    const c = make();
    c.zoom = 1.5;
    c.panByScreen(100000, 0); // drag far right → camera moves left
    const left = c.screenToWorld(0, 0).x;
    expect(left).toBeGreaterThanOrEqual(-240 - 1e-6);
    c.panByScreen(-200000, 0);
    const right = c.screenToWorld(c.viewW, 0).x;
    expect(right).toBeLessThanOrEqual(1920 + 240 + 1e-6);
  });

  it('fitWorld shows the whole map width', () => {
    const c = make();
    c.fitWorld();
    expect(c.screenToWorld(0, 0).x).toBeLessThanOrEqual(0);
    expect(c.screenToWorld(c.viewW, 0).x).toBeGreaterThanOrEqual(1920);
  });

  it('transform maps world to screen consistently', () => {
    const c = make();
    c.zoom = 2;
    c.centerOn(500, 300);
    const tr = c.transform();
    const s = c.worldToScreen(510, 320);
    expect(510 * tr.scale + tr.x).toBeCloseTo(s.x);
    expect(320 * tr.scale + tr.y).toBeCloseTo(s.y);
  });
});
