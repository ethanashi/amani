import { describe, expect, it } from "vitest";
import { binomialPmf, clopperPearson, lowerTail, upperTail } from "../src/binomial.ts";
import { rate } from "../src/scorer.ts";

describe("Clopper-Pearson intervals", () => {
  it("match closed forms at k = 0, k = 1 and k = n", () => {
    for (const n of [10, 37, 100, 102]) {
      const [lo0, hi0] = clopperPearson(0, n);
      expect(lo0).toBe(0);
      expect(hi0).toBeCloseTo(1 - 0.025 ** (1 / n), 12);
      const [loN, hiN] = clopperPearson(n, n);
      expect(hiN).toBe(1);
      expect(loN).toBeCloseTo(0.025 ** (1 / n), 12);
      // k = 1: lower bound solves 1 - (1 - p)^n = 0.025.
      expect(clopperPearson(1, n)[0]).toBeCloseTo(1 - 0.975 ** (1 / n), 12);
    }
  });

  it("match published limits (scipy beta.ppf / R binom.test)", () => {
    const [lo, hi] = clopperPearson(10, 200); // scipy beta.ppf(.025, 10, 191), beta.ppf(.975, 11, 190)
    expect(lo).toBeCloseTo(0.02423416547, 9);
    expect(hi).toBeCloseTo(0.0900275377, 9);
    const [lo5, hi5] = clopperPearson(5, 20); // R: binom.test(5, 20)$conf.int
    expect(lo5).toBeCloseTo(0.08657147, 7);
    expect(hi5).toBeCloseTo(0.49104587, 7);
  });

  it("bounds are exactly the alpha/2 tail points of the binomial", () => {
    for (const [k, n] of [[3, 50], [7, 96], [1, 40], [12, 37]] as const) {
      const [lo, hi] = clopperPearson(k, n);
      expect(upperTail(n, k, lo)).toBeCloseTo(0.025, 9);
      expect(lowerTail(n, k, hi)).toBeCloseTo(0.025, 9);
      expect(lo).toBeLessThan(k / n);
      expect(hi).toBeGreaterThan(k / n);
    }
    const [l90, h90] = clopperPearson(3, 50, 0.9);
    const [l95, h95] = clopperPearson(3, 50, 0.95);
    expect(l90).toBeGreaterThan(l95);
    expect(h90).toBeLessThan(h95);
  });

  it("pmf sums to one and arguments are checked", () => {
    let s = 0;
    for (let k = 0; k <= 30; k++) s += binomialPmf(30, k, 0.17);
    expect(s).toBeCloseTo(1, 12);
    expect(() => clopperPearson(5, 4)).toThrow();
    expect(() => clopperPearson(0, 0)).toThrow();
    expect(() => clopperPearson(1, 10, 1)).toThrow();
  });

  it("rate() reports n = 0 as unknown with the vacuous interval", () => {
    expect(rate(0, 0)).toEqual({ k: 0, n: 0, rate: null, lower: 0, upper: 1, level: 0.95 });
    const r = rate(2, 100);
    expect(r.rate).toBe(0.02);
    expect(r.upper).toBeGreaterThan(0.05); // 2/100 does not meet a 5% upper-bound target
    expect(rate(0, 100).upper).toBeLessThan(0.05); // 0/100 does
  });
});
