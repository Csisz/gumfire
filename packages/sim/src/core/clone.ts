/**
 * Deep clone for simulation state: plain objects, arrays, primitives and typed arrays
 * (terrain bitmaps from M1). Platform-independent; avoids relying on structuredClone.
 */
export function deepClone<T>(value: T): T {
  return cloneAny(value) as T;
}

function cloneAny(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) {
    const ta = v as unknown as { slice(): unknown };
    return ta.slice();
  }
  if (Array.isArray(v)) return v.map(cloneAny);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = cloneAny((v as Record<string, unknown>)[k]);
  return out;
}
