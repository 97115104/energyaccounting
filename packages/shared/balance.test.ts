import { describe, expect, test } from "bun:test";
import {
  attwoodTotals,
  closingBalance,
  openingBalance,
  clampCost,
  reservedCapacity,
  availableCapacity,
  isWithdrawalHeavy,
} from "./src/balance";

describe("energy balance math", () => {
  test("opening is 100 on first day", () => {
    expect(openingBalance(null)).toBe(100);
  });

  test("opening carries prior closing plus 100", () => {
    expect(openingBalance(-20)).toBe(80);
    expect(openingBalance(40)).toBe(140);
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

  test("reserved and available capacity free on complete", () => {
    const tasks = [
      { side: "withdrawal" as const, planned: 20, actual: null, completed: false },
      { side: "deposit" as const, planned: 30, actual: null, completed: true },
      { side: "withdrawal" as const, planned: 15, actual: null, completed: false },
    ];
    expect(reservedCapacity(tasks)).toBe(35);
    expect(availableCapacity(100, tasks)).toBe(65);
  });

  test("withdrawal heavy when withdrawals exceed deposits", () => {
    expect(isWithdrawalHeavy({ depositTotal: 20, withdrawalTotal: 40 })).toBe(true);
    expect(isWithdrawalHeavy({ depositTotal: 40, withdrawalTotal: 20 })).toBe(false);
  });
});
