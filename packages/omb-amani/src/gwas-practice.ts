import type { Table, TableView } from '../../omb-investigate/src/tabular.ts';
import type { Task } from './task.ts';
import { random } from './practice.ts';

/** Identity-linked GWAS attributes come only from public domains and a keyed PRF.
 * No real allele, position, frequency, palindromic flag or measurement is copied.
 * Palindromic status and frequency are synthetic but internally harmonisable. */
export function consistentGwas(tables: Table[], task: Task, seed: string, views: TableView[]): void {
  const groups = new Map<string, { table: Table; id: number; namespace: string }[]>();
  for (const table of tables) {
    if (!['effect_allele', 'other_allele'].every(c => table.header.includes(c))) continue;
    const d = task.identity.find(d => d.file === table.file);
    const name = d?.identifiers.find(n => /^(variant(_id)?|snp|rsid)$/i.test(n)) ?? (d?.identifiers.length === 1 ? d.identifiers[0] : undefined);
    if (!name) throw new Error('GWAS practice requires an unambiguous variant identity');
    const namespace = d?.columns?.find(c => c.name === name)?.namespace ?? 'variant';
    const id = table.header.indexOf(name); if (id < 0) throw new Error('Missing GWAS identity column');
    const group = groups.get(namespace) ?? []; group.push({ table, id, namespace }); groups.set(namespace, group);
  }
  for (const [namespace, group] of groups) {
    const domain = (column: string): string[] | null => {
      const domains = group.flatMap(({ table }) => {
        const d = task.identity.find(d => d.file === table.file)?.columns?.find(c => c.name === column);
        const v = views.find(v => v.file === table.file)?.columns.find(c => c.name === column);
        const levels = d?.levels ?? (v?.levels ? Object.keys(v.levels) : undefined);
        return levels?.length ? [levels] : [];
      });
      return domains.length ? domains[0]!.filter(x => domains.every(ds => ds.includes(x))).sort() : null;
    };
    const effects = domain('effect_allele') ?? ['A', 'C', 'G', 'T'], others = domain('other_allele') ?? ['A', 'C', 'G', 'T'];
    const pairs = effects.flatMap(a => others.filter(b => a !== b).map(b => [a, b] as const));
    if (!pairs.length) throw new Error('Infeasible public GWAS allele domains');
    const bounds = (column: string, lo: number, hi: number) => {
      for (const { table } of group) {
        const c = task.identity.find(d => d.file === table.file)?.columns?.find(c => c.name === column);
        const observed = views.find(v => v.file === table.file)?.columns.find(c => c.name === column);
        if (observed?.min !== undefined) lo = Math.max(lo, observed.min);
        if (observed?.max !== undefined) hi = Math.min(hi, observed.max);
        if (c?.min !== undefined) lo = Math.max(lo, c.min); if (c?.max !== undefined) hi = Math.min(hi, c.max);
      }
      if (lo > hi) throw new Error('Infeasible public GWAS attribute domains');
      return [lo, hi] as const;
    };
    for (const { table, id } of group) for (const row of table.rows) {
      const rand = random(seed, JSON.stringify(['gwas', namespace, row[id]]));
      const pair = pairs[Math.floor(rand() * pairs.length)]!;
      const palindromic = ['AT', 'TA', 'CG', 'GC'].includes(pair.join(''));
      const frequency = rand();
      for (const [j, name] of table.header.entries()) {
        if (name === 'effect_allele') row[j] = pair[0];
        else if (name === 'other_allele') row[j] = pair[1];
        else if (['palindromic', 'is_palindromic'].includes(name)) {
          const levels = domain(name);
          row[j] = levels?.includes('true') || levels?.includes('false') ? String(palindromic) : levels?.includes('TRUE') || levels?.includes('FALSE') ? String(palindromic).toUpperCase() : palindromic ? '1' : '0';
        } else if (['eaf', 'effect_allele_frequency', 'other_allele_frequency', 'maf'].includes(name)) {
          // All tables use the same orientation. MAF is derived from the same EAF.
          const [lo, hi] = bounds('eaf', 0.01, 0.99), eaf = Math.max(lo, Math.min(hi, Number((lo + frequency * (hi - lo)).toFixed(6))));
          row[j] = String(name === 'maf' ? Math.min(eaf, 1 - eaf) : name === 'other_allele_frequency' ? 1 - eaf : eaf);
        } else if (['chromosome', 'chr', 'position', 'pos', 'gene_symbol'].includes(name)) {
          const r = random(seed, JSON.stringify(['gwas-attribute', namespace, row[id], name]))();
          const levels = domain(name);
          if (levels?.length) row[j] = levels[Math.floor(r * levels.length)]!;
          else if (name === 'gene_symbol') row[j] = `SYN_GENE_${Math.floor(r * 1e8)}`;
          else { const [lo, hi] = bounds(name, 1, ['chr', 'chromosome'].includes(name) ? 22 : 250_000_000); row[j] = String(Math.floor(Math.ceil(lo) + r * (Math.floor(hi) - Math.ceil(lo) + 1))); }
        }
      }
    }
  }
}
