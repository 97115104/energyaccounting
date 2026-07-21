/** ND-aligned tip templates for the floating tips sheet. */

export type TipContext = {
  available: number;
  depositTotal: number;
  withdrawalTotal: number;
  incompleteWithdrawals: number;
  weatherKind: "sun" | "rain" | "cloud" | "unknown";
  justFreed?: number;
};

export type Tip = {
  id: string;
  title: string;
  body: string;
};

export function buildTips(ctx: TipContext): Tip[] {
  const tips: Tip[] = [];

  if (ctx.justFreed && ctx.justFreed > 0) {
    tips.push({
      id: "freed",
      title: "Capacity opened up",
      body: `You freed ${ctx.justFreed} points. You can allocate them to a new task, or leave them unallocated and bank the space.`,
    });
  }

  if (ctx.withdrawalTotal > ctx.depositTotal) {
    tips.push({
      id: "rebalance",
      title: "Withdrawals are ahead",
      body: "The ledger is weighted toward withdrawals. A play deposit can restore energy without framing the day as a failure.",
    });
  }

  if (ctx.incompleteWithdrawals >= 3) {
    tips.push({
      id: "boundaries",
      title: "Protect the remaining pool",
      body: "Several withdrawals are still open. Completing one frees capacity, and saying no to a new drain is a valid deposit of boundary energy.",
    });
  }

  if (ctx.available >= 30 && ctx.depositTotal <= ctx.withdrawalTotal) {
    tips.push({
      id: "deposit-window",
      title: "Room for a deposit",
      body: `You still have ${ctx.available} points available. A short restorative deposit often steadies the rest of the day.`,
    });
  }

  if (ctx.weatherKind === "rain") {
    tips.push({
      id: "rain",
      title: "Rainy day rhythm",
      body: "Outdoor withdrawals may cost more in the rain. Indoor play deposits, including music or a fiction chapter, can refill without fighting the weather.",
    });
  } else if (ctx.weatherKind === "sun") {
    tips.push({
      id: "sun",
      title: "Sunlight window",
      body: "Bright weather can make a short outdoor walk a strong deposit. Match the deposit to how much capacity you actually have left.",
    });
  }

  if (tips.length === 0) {
    tips.push({
      id: "default",
      title: "Energy is finite today",
      body: "Plan deposits and withdrawals, complete what you can, and free capacity when a task is done so you can choose the next allocation with intention.",
    });
  }

  return tips.slice(0, 3);
}
