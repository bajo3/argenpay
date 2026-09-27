import { describe, expect, it } from "vitest";
import { bpsOf, computeOrderAmounts } from "../fees";
import { centsToInput, parseARSToCents } from "../money";

describe("bpsOf (redondeo mitad hacia arriba)", () => {
  it("calcula 10% exacto", () => {
    expect(bpsOf(100_000, 1000)).toBe(10_000);
  });
  it("redondea .5 hacia arriba", () => {
    expect(bpsOf(5, 1000)).toBe(1); // 0,5 centavo → 1
    expect(bpsOf(15, 1000)).toBe(2); // 1,5 → 2
  });
  it("redondea por debajo de .5 hacia abajo", () => {
    expect(bpsOf(14, 1000)).toBe(1); // 1,4 → 1
  });
  it("rechaza valores no enteros", () => {
    expect(() => bpsOf(10.5, 1000)).toThrow();
  });
});

describe("computeOrderAmounts", () => {
  it("plataforma absorbe el cargo: vendedor recibe 90%", () => {
    const a = computeOrderAmounts({
      unitPriceCents: 1_234_567,
      quantity: 1,
      commissionBps: 1000,
      processorFeeBps: 300,
      processorFeePolicy: "plataforma_absorbe",
    });
    expect(a.priceCents).toBe(1_234_567);
    expect(a.commissionCents).toBe(123_457); // 123456,7 → 123457
    expect(a.processorFeeCents).toBe(37_037); // 37037,01 → 37037
    expect(a.sellerNetCents).toBe(1_234_567 - 123_457);
    expect(a.platformNetCents).toBe(123_457 - 37_037);
  });

  it("vendedor absorbe el cargo", () => {
    const a = computeOrderAmounts({
      unitPriceCents: 10_000,
      quantity: 3,
      commissionBps: 1000,
      processorFeeBps: 300,
      processorFeePolicy: "vendedor_absorbe",
    });
    expect(a.priceCents).toBe(30_000);
    expect(a.commissionCents).toBe(3_000);
    expect(a.processorFeeCents).toBe(900);
    expect(a.sellerNetCents).toBe(26_100);
    expect(a.platformNetCents).toBe(3_000);
  });

  it("la suma cuadra siempre", () => {
    for (const price of [100, 101, 999, 12_345, 99_999_999]) {
      for (const policy of ["plataforma_absorbe", "vendedor_absorbe"] as const) {
        const a = computeOrderAmounts({
          unitPriceCents: price,
          quantity: 1,
          commissionBps: 1000,
          processorFeeBps: 399,
          processorFeePolicy: policy,
        });
        expect(a.sellerNetCents + a.platformNetCents + a.processorFeeCents).toBe(a.priceCents);
      }
    }
  });
});

describe("parseARSToCents", () => {
  it.each([
    ["1234", 123_400],
    ["1.234", 123_400],
    ["1.234,56", 123_456],
    ["1234,5", 123_450],
    ["1234.56", 123_456],
    ["$ 10", 1_000],
  ])("%s → %d", (input, expected) => {
    expect(parseARSToCents(input)).toBe(expected);
  });
  it.each(["", "abc", "1,234,5", "-5", "1.2345"])("rechaza %s", (input) => {
    expect(parseARSToCents(input)).toBeNull();
  });
  it("ida y vuelta", () => {
    expect(parseARSToCents(centsToInput(123_456))).toBe(123_456);
  });
});
