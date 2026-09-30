/**
 * JSON serialisation that preserves typed arrays (terrain bitmaps) using run-length
 * encoding: a 1920×696 map of large air/soil regions becomes a few KB. Used for resync
 * snapshots (plan §15) and save files.
 */

type TypedArrayName = 'Uint8Array' | 'Uint16Array' | 'Uint32Array' | 'Int16Array' | 'Int32Array';
interface EncodedTyped {
  __ta: TypedArrayName;
  n: number;
  /** [value, runLength, value, runLength, ...] */
  rle: number[];
}

const CTORS: Record<TypedArrayName, new (n: number) => { length: number; [i: number]: number }> = {
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int16Array,
  Int32Array,
};

export function rleEncode(a: ArrayLike<number>): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i]!;
    let j = i + 1;
    while (j < a.length && a[j] === v) j++;
    out.push(v, j - i);
    i = j;
  }
  return out;
}

export function rleDecodeInto(rle: readonly number[], target: { length: number; [i: number]: number }): void {
  let p = 0;
  for (let k = 0; k < rle.length; k += 2) {
    const v = rle[k]!;
    const run = rle[k + 1]!;
    if (p + run > target.length) throw new RangeError('RLE data overruns target');
    for (let r = 0; r < run; r++) target[p++] = v;
  }
  if (p !== target.length) throw new RangeError(`RLE data length ${p} ≠ ${target.length}`);
}

function isTypedName(name: string): name is TypedArrayName {
  return name in CTORS;
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const name = (v as { constructor: { name: string } }).constructor.name;
      if (!isTypedName(name)) throw new TypeError(`Cannot serialise ${name}`);
      const arr = v as unknown as ArrayLike<number>;
      const enc: EncodedTyped = { __ta: name, n: arr.length, rle: rleEncode(arr) };
      return enc;
    }
    return v;
  });
}

export function fromJson<T>(json: string): T {
  return JSON.parse(json, (_key, v: unknown) => {
    if (v && typeof v === 'object' && '__ta' in v) {
      const e = v as EncodedTyped;
      if (!isTypedName(e.__ta)) throw new TypeError(`Unknown typed array ${String(e.__ta)}`);
      const out = new CTORS[e.__ta](e.n);
      rleDecodeInto(e.rle, out);
      return out;
    }
    return v;
  }) as T;
}
