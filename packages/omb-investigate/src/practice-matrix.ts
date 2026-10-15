import type { Table } from './tabular.ts';
import type { SynthesisTable } from './synthesis-schema.ts';
import { independentRandom as random } from './practice-independent.ts';

/** Detect a correlation matrix by labeled axes and numeric invariants, never its filename.
 * Row order and header order may differ. Rectangular expression/genotype matrices do not match. */
export function correlationAxis(t: Table, d: SynthesisTable): number[] | null {
  if (!d.matrix || d.identifiers.length !== 1) return null;
  const key = t.header.indexOf(d.identifiers[0]!);
  const cols = t.header.flatMap((h, j) => d.fixedHeaders.includes(h) ? [] : [j]);
  if (key < 0 || cols.length !== t.rows.length || cols.length < 2) return null;
  const ids = t.rows.map(r => r[key]!);
  if (new Set(ids).size !== ids.length || !cols.every(j => ids.includes(t.header[j]!))) return null;
  const axis = ids.map(id => t.header.indexOf(id));
  for (let i = 0; i < ids.length; i++) for (let k = 0; k <= i; k++) {
    const a = Number(t.rows[i]![axis[k]!]!), b = Number(t.rows[k]![axis[i]!]!);
    if (!Number.isFinite(a) || Math.abs(a) > 1 || Math.abs(a - b) > 1e-9 || i === k && Math.abs(a - 1) > 1e-9) return null;
  }
  return axis;
}
/** I + uu' normalized to unit diagonal is positive definite for every draw.
 * Nothing from the real numeric cells enters this generator. Keep axis identities/order. */
export function blindCorrelation(real: Table, out: Table, d: SynthesisTable, seed: string): boolean {
  const axis = correlationAxis(real, d); if (!axis) return false;
  const rand = random(seed, `correlation:${real.file}`), u = real.rows.map(() => (rand() - 0.5));
  for (let i = 0; i < u.length; i++) for (let k = 0; k < u.length; k++) out.rows[i]![axis[k]!] = String(i === k ? 1 : u[i]! * u[k]! / Math.sqrt((1 + u[i]! ** 2) * (1 + u[k]! ** 2)));
  return true;
}
/** Check generated matrices in label order, including PSD by a tolerant LDL factorization. */
export function checkCorrelation(real: Table, practice: Table, d: SynthesisTable): string | null {
  if (!correlationAxis(real, d)) return null;
  // Synthetic headers are pseudonyms: fixed annotation names are unchanged.
  if (practice.rows.length !== real.rows.length || practice.header.length !== real.header.length) return 'correlation matrix shape changed';
  const axis = correlationAxis(practice, d);
  if (!axis) return 'correlation axes, symmetry, bounds or unit diagonal changed';
  const originalAxis=correlationAxis(real,d)!;
  const inventory=(t:Table,cols:number[])=>JSON.stringify(t.rows.flatMap(r=>cols.map(j=>Number(r[j]))).sort((a,b)=>a-b));
  if(inventory(real,originalAxis)===inventory(practice,axis))return 'correlation numeric cells are unchanged from real data';
  const n = axis.length, a = practice.rows.map(r => axis.map(j => Number(r[j])));
  for (let k = 0; k < n; k++) {
    const pivot = a[k]![k]!;
    if (pivot < -1e-9) return 'correlation matrix is not positive semi-definite';
    if (pivot <= 1e-12) { if (a.slice(k + 1).some(r => Math.abs(r[k]!) > 1e-8)) return 'correlation matrix is not positive semi-definite'; continue; }
    for (let i = k + 1; i < n; i++) for (let j = i; j < n; j++) { a[j]![i]! -= a[i]![k]! * a[j]![k]! / pivot; a[i]![j] = a[j]![i]!; }
  }
  return null;
}
