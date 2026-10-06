/** Run-length coding for input logs and map materials: [value, count, value, count, …]. */
export function rle(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; ) {
    const v = values[i]!;
    let n = 1;
    while (i + n < values.length && values[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

export class RleError extends Error {}

export function unrle(pairs: readonly number[], expected: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const v = pairs[i]!, n = pairs[i + 1]!;
    if (!Number.isInteger(v) || !Number.isInteger(n) || n < 1 || out.length + n > expected) throw new RleError('broken run-length data');
    for (let k = 0; k < n; k++) out.push(v);
  }
  if (out.length !== expected) throw new RleError('run-length data has the wrong length');
  return out;
}
