import { describe, expect, it } from 'vitest';
import { Camera } from '../src/camera.js';
import { CameraDirector, type CameraScene } from '../src/cameraDirector.js';

const scene = (s: Partial<CameraScene>): CameraScene => ({ projectiles: [], flyers: [], active: null, ...s });

describe('CameraDirector', () => {
  it('priority: projectile > recent blast > fastest flyer > active character', () => {
    const d = new CameraDirector();
    const active = { x: 100, y: 100 };
    expect(d.pick(scene({ active }), 0).focus).toBe('active');
    const flyers = [{ x: 300, y: 50, speed: 1 }, { x: 400, y: 60, speed: 6 }];
    expect(d.pick(scene({ active, flyers }), 0)).toEqual({ focus: 'flyer', target: flyers[1] });
    d.explosion(500, 500, 1000);
    expect(d.pick(scene({ active, flyers }), 1500).focus).toBe('blast');
    expect(d.pick(scene({ active, flyers }), 1900).focus).toBe('flyer'); // hold expired
    const p = { x: 10, y: 10, vx: 2, vy: -1 };
    expect(d.pick(scene({ active, flyers, projectiles: [p] }), 1000)).toEqual({ focus: 'projectile', target: { x: 34, y: -2 } });
  });

  it('manual control pauses following until released', () => {
    const d = new CameraDirector();
    d.takeManual();
    expect(d.pick(scene({ active: { x: 1, y: 1 } }), 0).focus).toBe('manual');
    d.release();
    expect(d.pick(scene({ active: { x: 1, y: 1 } }), 0).focus).toBe('active');
  });

  it('eases towards the subject, faster for projectiles', () => {
    const cam = new Camera(4000, 2000);
    cam.setViewport(800, 600);
    cam.centerOn(1000, 1000);
    const d = new CameraDirector();
    d.update(cam, scene({ active: { x: 2000, y: 1000 } }), 0, 16);
    const slowStep = cam.x - 1000;
    cam.centerOn(1000, 1000);
    d.update(cam, scene({ projectiles: [{ x: 2000, y: 1000, vx: 0, vy: 0 }] }), 0, 16);
    expect(cam.x - 1000).toBeGreaterThan(slowStep * 2);
    expect(slowStep).toBeGreaterThan(0);
  });
});
