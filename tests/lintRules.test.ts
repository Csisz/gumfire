import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const simFile = join(root, 'packages/sim/src/__probe.ts');
const appFile = join(root, 'apps/sandbox/src/__probe.ts');

async function errorsFor(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? '');
}

describe('determinism lint rules (ADR-002)', () => {
  it.each([
    ['Math.random()', 'no-restricted-properties'],
    ['Math.sin(1)', 'no-restricted-properties'],
    ['Math.pow(2, 3)', 'no-restricted-properties'],
    ['Date.now()', 'no-restricted-properties'],
    ['new Date()', 'no-restricted-globals'],
    ['performance.now()', 'no-restricted-properties'],
  ])('rejects %s inside packages/sim', async (expr, rule) => {
    expect(await errorsFor(`export const x = ${expr};\n`, simFile)).toContain(rule);
  });

  it('rejects rendering imports inside packages/sim', async () => {
    expect(await errorsFor(`import { Application } from 'pixi.js';\nexport const a = Application;\n`, simFile)).toContain('no-restricted-imports');
  });

  it('allows integer Math and the same code outside the sim', async () => {
    expect(await errorsFor(`export const x = Math.trunc(Math.abs(-3.5));\n`, simFile)).toEqual([]);
    expect(await errorsFor(`export const x = Math.random() + performance.now();\n`, appFile)).toEqual([]);
  });
});
