/// <reference lib="webworker" />
import { planTurn, type AiLevel } from '@gumfire/ai';
import type { GameState } from '@gumfire/sim';

/**
 * The CPU's search runs here, off the main thread (M15b): the game keeps rendering at full
 * speed while the CPU thinks, however slow the frames are. The planner is pure, so the plan is
 * the same one the main thread would have found.
 */
interface Request {
  id: number;
  state: GameState;
  level: AiLevel;
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, state, level } = e.data;
  const search = planTurn(state, level);
  let r = search.next();
  while (!r.done) r = search.next();
  const plan = r.value;
  (self as unknown as Worker).postMessage({ id, plan: { script: plan.script, score: plan.score, label: plan.label, outcome: plan.outcome } });
};
