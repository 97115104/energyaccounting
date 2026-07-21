import { describe, expect, test } from "bun:test";
import {
  DAILY_ENERGY,
  attwoodTotals,
  closingBalance,
  openingBalance,
  clampCost,
  clampDifficulty,
  reservedCapacity,
  completedFreedEnergy,
  availableCapacity,
  isWithdrawalHeavy,
} from "./src/balance";

describe("energy balance math", () => {
  test("opening uses the finite daily supply", () => {
    expect(DAILY_ENERGY).toBe(100);
    expect(openingBalance()).toBe(DAILY_ENERGY);
  });

  test("opening never carries a prior closing", () => {
    expect(openingBalance(-20)).toBe(DAILY_ENERGY);
    expect(openingBalance(40)).toBe(DAILY_ENERGY);
  });

  test("attwood totals and closing", () => {
    const tasks = [
      { side: "withdrawal" as const, planned: 30, actual: null },
      { side: "withdrawal" as const, planned: 10, actual: 15 },
      { side: "deposit" as const, planned: 40, actual: null },
    ];
    const a = attwoodTotals(tasks);
    expect(a.withdrawalTotal).toBe(45);
    expect(a.depositTotal).toBe(40);
    expect(a.attwoodNet).toBe(-5);
    expect(closingBalance(100, tasks)).toBe(95);
  });

  test("clampCost", () => {
    expect(clampCost(-1)).toBe(0);
    expect(clampCost(150)).toBe(100);
    expect(clampCost(33.7)).toBe(34);
  });

  test("clampDifficulty preserves missing ratings and clamps 1-10", () => {
    expect(clampDifficulty(null)).toBeNull();
    expect(clampDifficulty(undefined)).toBeNull();
    expect(clampDifficulty(0)).toBe(1);
    expect(clampDifficulty(11)).toBe(10);
    expect(clampDifficulty(6.6)).toBe(7);
  });

  test("reserved and available capacity free on complete", () => {
    const tasks = [
      { side: "withdrawal" as const, planned: 20, actual: null, completed: false },
      { side: "deposit" as const, planned: 30, actual: null, completed: true },
      { side: "withdrawal" as const, planned: 15, actual: null, completed: false },
    ];
    expect(reservedCapacity(tasks)).toBe(35);
    expect(availableCapacity(100, tasks)).toBe(65);
    expect(completedFreedEnergy(tasks)).toBe(30);
  });

  test("withdrawal heavy when withdrawals exceed deposits", () => {
    expect(isWithdrawalHeavy({ depositTotal: 20, withdrawalTotal: 40 })).toBe(true);
    expect(isWithdrawalHeavy({ depositTotal: 40, withdrawalTotal: 20 })).toBe(false);
  });
});
