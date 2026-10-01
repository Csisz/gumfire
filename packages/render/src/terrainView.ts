import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import { CHUNK_SIZE, chunkRect, takeDirtyChunks, type TerrainState } from '@gumfire/sim';
import { paintTerrainRect, PAINT_MARGIN, type TerrainTheme } from './terrainPaint.js';

interface ChunkGfx {
  source: BufferImageSource;
  buffer: Uint8Array;
  sprite: Sprite;
}

/**
 * Renders the terrain as one 64×64 texture per chunk (plan §8.3–8.6). The full-map colour
 * buffer is painted once; afterwards only chunks the sim marks dirty are repainted and
 * re-uploaded, at most `uploadBudget` per frame so a big blast never stalls a frame.
 */
export class TerrainView {
  readonly container = new Container();
  private readonly colors: Uint8Array;
  /** The bitmap as loaded; lets the painter show craters, scorch and the original crust. */
  private readonly original: Uint8Array;
  private readonly chunks: ChunkGfx[] = [];
  /** Chunk indices waiting for upload (overflow from earlier frames). */
  private readonly queue: number[] = [];
  private readonly queued: Uint8Array;

  constructor(
    private readonly terrain: TerrainState,
    private readonly theme: TerrainTheme,
    private readonly uploadBudget = 24,
  ) {
    this.container.label = 'terrain';
    this.colors = new Uint8Array(terrain.width * terrain.height * 4);
    this.original = terrain.mat.slice();
    this.queued = new Uint8Array(terrain.chunksX * terrain.chunksY);
    const t0 = performance.now();
    paintTerrainRect(terrain, theme, this.colors, 0, 0, terrain.width - 1, terrain.height - 1, this.original);
    this.paintMs = performance.now() - t0;

    for (let i = 0; i < terrain.chunksX * terrain.chunksY; i++) {
      const buffer = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
      const source = new BufferImageSource({ resource: buffer, width: CHUNK_SIZE, height: CHUNK_SIZE, scaleMode: 'nearest', alphaMode: 'premultiply-alpha-on-upload' }); // painter writes straight alpha
      const sprite = new Sprite(new Texture({ source }));
      const r = chunkRect(terrain, i);
      sprite.position.set(r.x0, r.y0);
      this.container.addChild(sprite);
      this.chunks.push({ source, buffer, sprite });
      this.copyChunk(i);
      source.update();
    }
    takeDirtyChunks(terrain); // everything is freshly uploaded
  }

  /** Time the initial full-map paint took (ms), for the sandbox HUD. */
  readonly paintMs: number;

  get pendingUploads(): number {
    return this.queue.length;
  }

  /** Pull newly dirty chunks from the sim, repaint and upload up to the budget. Returns uploads done. */
  update(): number {
    for (const i of takeDirtyChunks(this.terrain)) {
      if (!this.queued[i]) {
        this.queued[i] = 1;
        this.queue.push(i);
      }
    }
    let done = 0;
    while (done < this.uploadBudget && this.queue.length > 0) {
      const i = this.queue.shift()!;
      this.queued[i] = 0;
      const r = chunkRect(this.terrain, i);
      // Repaint the chunk (the painter reads a margin around it, so crusts stay correct).
      paintTerrainRect(this.terrain, this.theme, this.colors, r.x0, r.y0, r.x1, r.y1, this.original);
      this.copyChunk(i);
      this.chunks[i]!.source.update();
      done++;
    }
    return done;
  }

  /**
   * Queue a repaint of every chunk within PAINT_MARGIN of an edited pixel rect. Call with each
   * `TerrainChanged` event: an edit's outline and scorch reach into neighbouring chunks that the
   * sim did not mark dirty.
   */
  invalidateRect(x0: number, y0: number, x1: number, y1: number): void {
    const t = this.terrain;
    const m = PAINT_MARGIN;
    const cx0 = Math.max(0, (x0 - m) >> 6);
    const cy0 = Math.max(0, (y0 - m) >> 6);
    const cx1 = Math.min(t.chunksX - 1, (x1 + m) >> 6);
    const cy1 = Math.min(t.chunksY - 1, (y1 + m) >> 6);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * t.chunksX + cx;
        if (!this.queued[i]) {
          this.queued[i] = 1;
          this.queue.push(i);
        }
      }
  }

  private copyChunk(i: number): void {
    const t = this.terrain;
    const r = chunkRect(t, i);
    const buf = this.chunks[i]!.buffer;
    buf.fill(0);
    const rowBytes = (r.x1 - r.x0 + 1) * 4;
    for (let y = r.y0; y <= r.y1; y++) {
      const src = (y * t.width + r.x0) * 4;
      buf.set(this.colors.subarray(src, src + rowBytes), (y - r.y0) * CHUNK_SIZE * 4);
    }
  }

  destroy(): void {
    for (const c of this.chunks) c.sprite.texture.destroy(true);
    this.container.destroy({ children: true });
  }
}
