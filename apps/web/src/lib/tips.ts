/** ND-aligned tips for the floating tips sheet, driven by the research corpus. */

import { selectFromCorpus, type CorpusContext } from "./tipsCorpus";
import type { WeatherKind } from "./weatherUi";

export type TipContext = {
  available: number;
  depositTotal: number;
  withdrawalTotal: number;
  incompleteWithdrawals: number;
  weatherKind: WeatherKind;
  uvMax?: number | null;
  /** When false, UV tips (which cite daily max) stay quiet. */
  isDaylight?: boolean;
  justFreed?: number;
};

export type Tip = {
  id: string;
  title: string;
  body: string;
};

const MAX_TIPS = 3;

export function buildTips(ctx: TipContext): Tip[] {
  const tips: Tip[] = [];

  // Event-driven tip always leads: reacting to what the user just did.
  if (ctx.justFreed && ctx.justFreed > 0) {
    tips.push({
      id: "freed",
      title: "Capacity opened up",
      body: `You freed ${ctx.justFreed} points. Spend them on something new, or leave them banked — the ledger won't judge either way.`,
    });
  }

  const corpusCtx: CorpusContext = {
    weatherKind: ctx.weatherKind,
    uvMax: ctx.uvMax ?? null,
    isDaylight: ctx.isDaylight ?? true,
    available: ctx.available,
    depositTotal: ctx.depositTotal,
    withdrawalTotal: ctx.withdrawalTotal,
    incompleteWithdrawals: ctx.incompleteWithdrawals,
  };
  for (const entry of selectFromCorpus(corpusCtx, MAX_TIPS - tips.length)) {
    tips.push({ id: entry.id, title: entry.title, body: entry.body });
  }

  if (tips.length === 0) {
    tips.push({
      id: "default",
      title: "Energy is finite today",
      body: "Plan deposits and withdrawals, complete what you can, and free capacity when a task is done. Future-you appreciates a balanced ledger.",
    });
  }

  return tips.slice(0, MAX_TIPS);
}
