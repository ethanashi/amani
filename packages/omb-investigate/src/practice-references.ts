import {dictionaryColumns} from './measurement-dictionary.ts';
import type { Table } from './tabular.ts';
import { hasOutcomeRole, missingValue, type PracticeViolation, type StructureDeclaration } from './practice-structure.ts';

export function canonicalKey(value:string,d:StructureDeclaration|undefined,name:string):string {if(d?.formats?.[name]?.encoding!=='decimal'||missingValue(value,d.missing))return value;if(!/^\d+$/.test(value))throw new Error('Invalid decimal identifier');return BigInt(value).toString();}

export interface PracticeReference {
  file: string; column: number; target: string; targetColumn: number | null;
  /** Only indices whose own values are verified references; never neighboring metadata. */
  metadata: number[]; targetKey: boolean;
}
/** Infer exact inclusion dependencies, never fuzzy name matches or measurement overlaps.
 * A header dictionary names >=2 distinct headers of another table. Value references must
 * target a declared identifier or categorical vocabulary. Entity joins preserve keys only;
 * only cells that themselves match a target vocabulary are preserved. */
export function practiceReferences(tables: readonly Table[], declarations: Readonly<Record<string, StructureDeclaration | undefined>>): PracticeReference[] {
  const refs: PracticeReference[] = [];
  const domains = new Map<string, Set<string>>();
  for (const source of tables) for (let j = 0; j < source.header.length; j++) {
    const sd = declarations[source.file];
    if(sd?.measurementDictionary&&dictionaryColumns(sd).has(source.header[j]!)){if(source.header[j]===sd.measurementDictionary.fields.measurement)refs.push({file:source.file,column:j,target:sd.measurementDictionary.target,targetColumn:null,targetKey:false,metadata:[j]});continue;}
    if (sd && hasOutcomeRole(sd, source.header[j]!)) continue;
    const values = source.rows.map(r => canonicalKey(r[j] ?? '',sd,source.header[j]!)).filter(v => !missingValue(v, sd?.missing));
    const distinct = new Set(values);
    const numeric = values.length > 0 && values.every(v => v.trim() !== '' && Number.isFinite(Number(v)));
    const structuralRole = sd?.keys.includes(source.header[j]!) || ['id','categorical','category'].includes(sd?.roles?.[source.header[j]!] ?? '');
    if (numeric && !structuralRole) continue;
    if (!distinct.size) continue;
    for (const target of tables) {
      if (source === target) continue;
      const td = declarations[target.file];
      if ((!sd?.keyNamespaces?.[source.header[j]!]||!td?.matrixNamespace||sd.keyNamespaces[source.header[j]!]===td.matrixNamespace) && distinct.size >= 2 && values.length === distinct.size && values.every(v => target.header.includes(v))) {
        refs.push({ file: source.file, column: j, target: target.file, targetColumn: null, targetKey: !!sd?.keys.includes(source.header[j]!), metadata: [j] });
        break;
      }
      let matched = false;
      for (let k = 0; k < target.header.length; k++) {
        const name = target.header[k]!;
        if(td&&dictionaryColumns(td).has(name))continue;
        const aNamespace=sd?.keyNamespaces?.[source.header[j]!],bNamespace=td?.keyNamespaces?.[name];
        if(aNamespace&&bNamespace&&aNamespace!==bNamespace)continue;
        if (td && hasOutcomeRole(td, name)) continue;
        const key = td?.keys.includes(name), category = ['categorical', 'category'].includes(td?.roles?.[name] ?? '');
        if (!key && !category) continue;
        if (!key && (values.length !== distinct.size || distinct.size > 20)) continue;
        // Never reinterpret a declared measurement as an accidental key/code overlap.
        if (sd && hasOutcomeRole(sd, source.header[j]!)) continue;
        const domainId = JSON.stringify([target.file, k]);
        let targetValues = domains.get(domainId);
        if (!targetValues) { targetValues = new Set(target.rows.map(r => canonicalKey(r[k] ?? '',td,name)).filter(v => !missingValue(v, td?.missing))); domains.set(domainId, targetValues); }
        if (!values.every(v => targetValues.has(v))) continue;
        // Preservation covers only this verified inclusion dependency, never neighboring metadata.
        refs.push({ file: source.file, column: j, target: target.file, targetColumn: k, targetKey: !!key,
          metadata: [j] });
        matched = true; break;
      }
      if (matched) break;
    }
  }
  return refs;
}
export function referenceDeclarations(declarations: Readonly<Record<string, StructureDeclaration | undefined>>, refs: readonly PracticeReference[]): Record<string, StructureDeclaration> {
  const out: Record<string, StructureDeclaration> = {};
  for (const [file, d] of Object.entries(declarations)) if (d) out[file] = { ...d, structural: [...(d.structural ?? [])] };
  for (const r of refs) {
    const d = out[r.file]; if (d) {d.structural = [...new Set([...(d.structural ?? []), ...r.metadata])];if(r.targetColumn===null)d.headerReferences=[...new Set([...(d.headerReferences??[]),r.column])];}
  }
  return out;
}
/** Apply the target's actual generated key mapping; namespaces need not have been declared
 * on the foreign key. All associated dictionary metadata moves as a row, never independently. */
export function preserveReferences(real: readonly Table[], practice: readonly Table[], refs: readonly PracticeReference[]): void {
  for (const ref of refs) {
    const source = real.find(t => t.file === ref.file)!, out = practice.find(t => t.file === ref.file)!;
    const target = real.find(t => t.file === ref.target)!, generated = practice.find(t => t.file === ref.target)!;
    const mapping = ref.targetColumn === null ? new Map(target.header.map((h, j) => [h, generated.header[j]!]))
      : new Map(target.rows.map((r, i) => [r[ref.targetColumn!]!, generated.rows[i]![ref.targetColumn!]!]));
    source.rows.forEach((r, i) => {
      for (const j of ref.metadata) out.rows[i]![j] = r[j] ?? '';
      out.rows[i]![ref.column] = ref.targetKey ? mapping.get(r[ref.column]!) ?? r[ref.column] ?? '' : r[ref.column] ?? '';
    });
  }
}
export function checkPracticeReferences(real: readonly Table[], practice: (file: string) => Table | 'empty' | null, refs: readonly PracticeReference[]): PracticeViolation[] {
  const out: PracticeViolation[] = [];
  const sorted = (rows: string[][]) => JSON.stringify(rows.map(r => JSON.stringify(r)).sort());
  for (const ref of refs) {
    const source = real.find(t => t.file === ref.file)!, p = practice(ref.file), target = practice(ref.target);
    if (!p || p === 'empty' || !target || target === 'empty') continue; // shape checker reports missing tables
    const fail = (detail: string) => out.push({ file: ref.file, check: 'cross-file-reference', detail });
    const allowed = new Set(ref.targetColumn === null ? target.header : target.rows.map(r => r[ref.targetColumn!] ?? ''));
    if (p.rows.some(r => !allowed.has(r[ref.column] ?? '') && !missingValue(r[ref.column] ?? '', null))) fail(`${source.header[ref.column]} no longer references ${ref.target}`);
    // Header dictionaries retain their reference multiplicities. Membership alone
    // would accept repeating one valid header while omitting another.
    if (!ref.targetKey && (ref.targetColumn === null || ref.metadata.length > 1)) {
      if (sorted(source.rows.map(r => ref.metadata.map(j => r[j] ?? ''))) !== sorted(p.rows.map(r => ref.metadata.map(j => r[j] ?? '')))) fail(`row-aligned dictionary metadata for ${source.header[ref.column]} changed`);
    }
  }
  return out;
}
