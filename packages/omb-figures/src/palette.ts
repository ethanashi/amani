/** Machado matrices: copyright (C) 2015 Nathaniel Smith, MIT; see THIRD_PARTY_NOTICES.md. */
/**
 * Colour: Okabe-Ito for categories, a fixed neutral set for structure (section 5). The validator
 * simulates protanopia and deuteranopia (Machado, Oliveira and Fernandes 2009, severity 1.0,
 * applied in linear RGB) and measures CIELAB distance; it also refuses palettes containing a red-green pair,
 * which can stay apart in lightness under simulation yet still encode meaning only by hue.
 */
export const OKABE_ITO = {
  black: "#000000", orange: "#E69F00", skyBlue: "#56B4E9", bluishGreen: "#009E73",
  yellow: "#F0E442", blue: "#0072B2", vermillion: "#D55E00", reddishPurple: "#CC79A7",
} as const;

export const NEUTRAL = { white: "#FFFFFF", ink: "#222222", grey: "#8C8C8C", lightGrey: "#D9D9D9", rule: "#BFBFBF" } as const;

/** Series order for categorical marks; each also gets a distinct dash pattern or shape. */
export const SERIES_COLOURS = [OKABE_ITO.blue, OKABE_ITO.vermillion, OKABE_ITO.black, OKABE_ITO.reddishPurple] as const;
export const SERIES_DASHES = ["", "6 3", "2 2", "8 3 2 3"] as const;

/** Every colour the renderers may emit; the closed-world check refuses any other value. */
export const ALLOWED_COLOURS: ReadonlySet<string> = new Set(["none", ...Object.values(OKABE_ITO), ...Object.values(NEUTRAL)]);

/** Minimum CIELAB distance (CIE76) between categorical colours under simulated protanopia or deuteranopia. */
export const CVD_MIN_DELTA_E = 11;
/** Minimum lightness separation, in addition to mandatory dash/shape encodings. */
export const GREYSCALE_MIN_DELTA_E = 3;

export const MACHADO = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const;
export type Deficiency = keyof typeof MACHADO | "greyscale";

export function parseHex(colour: string): [number, number, number] | null {
  const m = /^#([0-9A-Fa-f]{6})$/u.exec(colour);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toLinear = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

function linearToLab([r, g, b]: readonly number[]): [number, number, number] {
  const x = (0.4124564 * r! + 0.3575761 * g! + 0.1804375 * b!) / 0.95047;
  const y = 0.2126729 * r! + 0.7151522 * g! + 0.072175 * b!;
  const z = (0.0193339 * r! + 0.119192 * g! + 0.9503041 * b!) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function labOf(colour: string, deficiency?: Deficiency): [number, number, number] {
  const rgb = parseHex(colour);
  if (!rgb) throw new Error(`not a hex colour: ${colour}`);
  const lin = rgb.map(toLinear);
  const luminance = 0.2126729 * lin[0]! + 0.7151522 * lin[1]! + 0.072175 * lin[2]!;
  const simulated = deficiency === "greyscale" ? [luminance, luminance, luminance] : deficiency
    ? MACHADO[deficiency].map((row) => Math.min(1, Math.max(0, row[0] * lin[0]! + row[1] * lin[1]! + row[2] * lin[2]!)))
    : lin;
  return linearToLab(simulated);
}

export function deltaE(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

/** HSV hue class of a chromatic colour: red, green, or other (achromatic colours return null). */
export function hueClass(colour: string): "red" | "green" | "other" | null {
  const rgb = parseHex(colour);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (max < 0.2 || delta / max < 0.25) return null;
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue >= 345 || hue <= 40) return "red";
  if (hue >= 75 && hue <= 165) return "green";
  return "other";
}

export interface PaletteIssue { readonly code: "palette-red-green" | "palette-cvd-collision" | "palette-unparseable"; readonly detail: string }

/** Validates a set of categorical colours (distinct values, as used on data marks). */
export function validatePalette(colours: readonly string[]): PaletteIssue[] {
  const distinct = [...new Set(colours.map((c) => c.toUpperCase()))].filter((c) => c !== "NONE");
  const issues: PaletteIssue[] = [];
  const bad = distinct.filter((c) => !parseHex(c));
  if (bad.length) return [{ code: "palette-unparseable", detail: `unparseable colours: ${bad.join(", ")}` }];
  const classes = distinct.map(hueClass).filter((c): c is "red" | "green" | "other" => c !== null);
  if (classes.length >= 2 && classes.includes("red") && classes.includes("green")) {
    issues.push({ code: "palette-red-green", detail: `palette contains both a red and a green category: ${distinct.join(", ")}` });
  }
  for (const deficiency of ["protanopia", "deuteranopia", "tritanopia", "greyscale"] as const) {
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        const d = deltaE(labOf(distinct[i]!, deficiency), labOf(distinct[j]!, deficiency));
        if (d < (deficiency === "greyscale" ? GREYSCALE_MIN_DELTA_E : CVD_MIN_DELTA_E)) issues.push({ code: "palette-cvd-collision", detail: `${distinct[i]} and ${distinct[j]} collide under simulated ${deficiency}` });
      }
    }
  }
  return issues;
}
