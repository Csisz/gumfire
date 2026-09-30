/**
 * FNV-1a 32-bit hashing over a canonical byte stream.
 * Used for state hashes (desync detection, golden replays) and RNG stream derivation.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const TWO_32 = 4294967296;

export class Hasher {
  private h = FNV_OFFSET;

  u8(v: number): this {
    this.h = Math.imul(this.h ^ (v & 0xff), FNV_PRIME) >>> 0;
    return this;
  }

  /** Any 32-bit integer (signed or unsigned); hashed as its two's-complement bytes. */
  u32(v: number): this {
    const x = v >>> 0;
    return this.u8(x).u8(x >>> 8).u8(x >>> 16).u8(x >>> 24);
  }

  /** Any safe integer, including values beyond 32 bits and negatives. */
  int(v: number): this {
    if (!Number.isSafeInteger(v)) throw new RangeError(`Hasher.int: not a safe integer: ${v}`);
    const lo = v >>> 0;
    const hi = Math.floor(v / TWO_32) | 0;
    return this.u32(lo).u32(hi);
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

  str(s: string): this {
    this.u32(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.u8(c).u8(c >>> 8);
    }
    return this;
  }

  bytes(b: Uint8Array): this {
    this.u32(b.length);
    for (let i = 0; i < b.length; i++) this.u8(b[i]!);
    return this;
  }

  digest(): number {
    return this.h >>> 0;
  }
}

export function hashString(s: string): number {
  return new Hasher().str(s).digest();
}

export function hashHex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
