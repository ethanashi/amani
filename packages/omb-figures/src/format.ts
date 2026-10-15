/**
 * Display formatter (internal design notes (not published) section 2.4): by kind, decision-preserving, and one
 * display per fact. Figures and tables share one instance per store, so a key that would print
 * two ways is refused instead of shown inconsistently. CSVs keep full precision elsewhere.
 */
import type { CertifiedClaim, CertifiedFact, FactKind } from "./port.ts";
import { refuse } from "./refusal.ts";

const MINUS = "−";
const MAX_DECIMALS = 10;

type Family = "ratio" | "difference" | "probability";
const RATIO_KINDS: readonly FactKind[] = ["or", "hr", "rr", "ratio"];
const PROBABILITY_KINDS: readonly FactKind[] = ["auc", "proportion", "probability", "net-benefit", "posterior"];
const DIFFERENCE_KINDS: readonly FactKind[] = ["effect", "difference", "beta", "slope", "intercept", "mean", "sd", "median", "quantile", "se"];

/**
 * Decimal half-up rounding of the shortest round-trip decimal of |value| (the digits a CSV cell
 * holds), so a printed number is always the plain rounding of its CSV cell. `toFixed` is not used:
 * it rounds the binary value, which prints 0.95 as "0.9".
 */
export function roundDecimal(value: number, decimals: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15 || !Number.isInteger(decimals) || decimals < 0 || decimals > 20) refuse("unformattable", `cannot round ${value}`);
  const shortest = String(Math.abs(value));
  let intPart: string, frac: string;
  if (shortest.includes("e")) {
    const [mantissa, exp] = shortest.split("e") as [string, string];
    const [mi, mf = ""] = mantissa.split(".") as [string, string | undefined];
    const digits = mi + mf, point = mi.length + Number(exp);
    if (point <= 0) { intPart = "0"; frac = "0".repeat(-point) + digits; }
    else if (point >= digits.length) { intPart = digits + "0".repeat(point - digits.length); frac = ""; }
    else { intPart = digits.slice(0, point); frac = digits.slice(point); }
  } else {
    [intPart, frac = ""] = shortest.split(".") as [string, string | undefined];
  }
  let digits = intPart + frac.slice(0, decimals).padEnd(decimals, "0");
  if (frac.length > decimals && frac[decimals]! >= "5") {
    const arr = digits.split("");
    let i = arr.length - 1;
    for (; i >= 0; i--) { if (arr[i] === "9") arr[i] = "0"; else { arr[i] = String(Number(arr[i]) + 1); break; } }
    digits = (i < 0 ? "1" : "") + arr.join("");
  }
  const ip = (digits.slice(0, digits.length - decimals) || "0").replace(/^0+(?=\d)/u, "");
  return decimals ? `${ip}.${digits.slice(digits.length - decimals)}` : ip;
}

/** Fixed, locale-free number text: decimal rounding, U+2212 minus, comma thousands. */
export function fixedText(value: number, decimals: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) refuse("unformattable", `cannot format ${value}`);
  let text = roundDecimal(value, decimals);
  const negative = value < 0 && Number(text) !== 0;
  const [int, frac] = text.split(".") as [string, string | undefined];
  const grouped = int.length > 3 ? int.replace(/\B(?=(\d{3})+(?!\d))/gu, ",") : int;
  text = frac === undefined ? grouped : `${grouped}.${frac}`;
  return negative ? MINUS + text : text;
}

/** Numeric value a reader sees in a display string (inverse of fixedText). */
export function readDisplayed(text: string): number {
  return Number(text.replaceAll(",", "").replace(MINUS, "-"));
}

function significantDecimals(value: number, digits: number): number {
  if (value === 0) return 0;
  return Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(value))));
}

function familyOf(kind: FactKind, claim: CertifiedClaim | null): Family | null {
  if (RATIO_KINDS.includes(kind)) return "ratio";
  if (PROBABILITY_KINDS.includes(kind)) return "probability";
  if (DIFFERENCE_KINDS.includes(kind)) return "difference";
  if (kind === "ci") return claim?.scale ?? "difference";
  return null;
}

function baseDecimals(family: Family, value: number): number {
  const a = Math.abs(value);
  if (family === "ratio") return a >= 100 ? 0 : a >= 10 ? 1 : a >= 0.1 ? 2 : significantDecimals(a, 2);
  if (family === "probability") return a === 0 || a >= 0.01 ? 2 : significantDecimals(a, 2);
  if (a === 0) return 2;
  return a >= 1000 ? 0 : Math.min(6, significantDecimals(a, 3));
}

const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

/** A printed value keeps every decision: same side of each threshold, and non-zero stays non-zero. */
function preserves(value: number, decimals: number, thresholds: readonly number[]): boolean {
  const shown = readDisplayed(fixedText(value, decimals));
  if (value !== 0 && shown === 0) return false;
  return thresholds.every((t) => sign(shown - t) === sign(value - t));
}

function widen(values: readonly number[], start: number, thresholds: readonly number[], what: string): number {
  for (let d = start; d <= MAX_DECIMALS; d++) if (values.every((v) => preserves(v, d, thresholds))) return d;
  return refuse("unformattable", `${what}: no rounding up to ${MAX_DECIMALS} decimals preserves the decision`);
}

const SUPERSCRIPT: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };

function scientific(value: number, mantissaDecimals: number): { text: string; shown: number } {
  let exponent = Math.floor(Math.log10(value));
  let mantissa = roundDecimal(Number((value / 10 ** exponent).toPrecision(15)), mantissaDecimals);
  if (Number(mantissa) >= 10) { exponent += 1; mantissa = roundDecimal(Number((value / 10 ** exponent).toPrecision(15)), mantissaDecimals); }
  const sup = String(exponent).split("").map((c) => SUPERSCRIPT[c] ?? c).join("");
  return { text: `${mantissa} × 10${sup}`, shown: Number(mantissa) * 10 ** exponent };
}

export class DisplayFormatter {
  readonly #claimOf: (id: string | null) => CertifiedClaim | null;
  readonly #memo = new Map<string, string>();
  constructor(claimOf: (id: string | null) => CertifiedClaim | null) {
    this.#claimOf = claimOf;
  }

  #remember(fact: CertifiedFact, text: string): string {
    const prior = this.#memo.get(fact.id);
    if (prior !== undefined && prior !== text) refuse("inconsistent-display", `fact ${fact.id} would display as both "${prior}" and "${text}"`);
    this.#memo.set(fact.id, text);
    return text;
  }

  /** Display of a fact that prints on its own (not a CI bound). */
  scalar(fact: CertifiedFact): string {
    if (fact.kind === "ci") refuse("invalid-spec", `CI bound ${fact.id} may print only with its estimate`);
    return this.#remember(fact, this.#scalarText(fact));
  }

  #scalarText(fact: CertifiedFact): string {
    const v = fact.value;
    const claim = this.#claimOf(fact.claimId);
    switch (fact.kind) {
      case "count": return fixedText(v, 0);
      case "percent": {
        const a = Math.abs(v);
        return `${fixedText(v, a >= 10 ? 0 : a >= 0.1 ? 1 : significantDecimals(a, 1))}%`;
      }
      case "p": return this.#pText(v, claim?.alpha ?? null, fact.id);
      case "threshold": {
        for (let d = 0; d <= 6; d++) if (Number(roundDecimal(v, d)) === Math.abs(v)) return fixedText(v, d);
        return fixedText(v, significantDecimals(v, 3));
      }
      default: {
        const family = familyOf(fact.kind, claim) ?? "difference";
        const relevant = claim && fact.claimId !== null && (family === claim.scale) ? claim.thresholds : [];
        return fixedText(v, widen([v], baseDecimals(family, v), relevant, fact.id));
      }
    }
  }

  #pText(v: number, alpha: number | null, id: string): string {
    const same = (shown: number) => alpha === null || sign(shown - alpha) === sign(v - alpha);
    if (v < 0.001) {
      if (alpha === null || alpha >= 0.001) return "< 0.001";
      for (let m = 0; m <= 6; m++) { const s = scientific(v, m); if (same(s.shown)) return s.text; }
      return refuse("unformattable", `${id}: p-value cannot be printed on its side of alpha`);
    }
    for (let d = v >= 0.01 ? 2 : 3; d <= MAX_DECIMALS; d++) {
      const text = roundDecimal(v, d), shown = Number(text);
      if (shown !== 0 && same(shown)) return text;
    }
    return refuse("unformattable", `${id}: p-value cannot be printed on its side of alpha`);
  }

  /** Estimate and CI share decimals; digits are added until no printed bound crosses a decision line. */
  interval(estimate: CertifiedFact, lower: CertifiedFact, upper: CertifiedFact): [string, string, string] {
    if (lower.kind !== "ci" || upper.kind !== "ci") refuse("kind-mismatch", `interval bounds ${lower.id}, ${upper.id} must be ci records`);
    if (estimate.kind === "ci" || estimate.kind === "p" || estimate.kind === "count") refuse("kind-mismatch", `${estimate.id} is not an estimate`);
    if (lower.ciLevel !== upper.ciLevel) refuse("inconsistent-data", `interval ${lower.id}/${upper.id} mixes CI levels`);
    if (!(lower.value <= estimate.value && estimate.value <= upper.value)) refuse("inconsistent-data", `interval ${lower.id} <= ${estimate.id} <= ${upper.id} does not hold`);
    if (estimate.claimId !== lower.claimId || estimate.claimId !== upper.claimId) refuse("inconsistent-data", `interval ${estimate.id} mixes claims`);
    const claim = this.#claimOf(estimate.claimId);
    const family = familyOf(estimate.kind, claim) ?? "difference";
    const thresholds = claim && family === claim.scale ? claim.thresholds : [];
    const d = widen([estimate.value, lower.value, upper.value], baseDecimals(family, estimate.value), thresholds, estimate.id);
    return [
      this.#remember(estimate, fixedText(estimate.value, d)),
      this.#remember(lower, fixedText(lower.value, d)),
      this.#remember(upper, fixedText(upper.value, d)),
    ];
  }

  /** "95%" from a record's ciLevel. */
  ciLevel(level: number): string {
    const pct = level * 100;
    for (let d = 0; d <= 2; d++) if (Math.abs(Number(pct.toFixed(d)) - pct) < 1e-9) return `${pct.toFixed(d)}%`;
    return `${pct.toFixed(2)}%`;
  }
}

/** Coordinates: two decimals, trailing zeros trimmed, never exponent notation, never "-0". */
export function coord(value: number): string {
  if (!Number.isFinite(value)) refuse("unformattable", "non-finite coordinate");
  const text = value.toFixed(2).replace(/\.?0+$/u, "");
  return text === "-0" || text === "" ? "0" : text;
}

/** Axis tick label: fewest decimals that represent the tick exactly (ticks are 1/2/2.5/5 multiples). */
export function tickText(value: number): string {
  for (let d = 0; d <= 8; d++) {
    if (Math.abs(Number(value.toFixed(d)) - value) <= 1e-9 * Math.max(1, Math.abs(value))) return fixedText(Number(value.toFixed(d)), d);
  }
  return fixedText(value, 8);
}
