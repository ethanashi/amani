import type { Column } from '../../omb-contract/src/index.ts';
/** Raw visit keys include measurement tokens because the source has repeated visits
 * on the same subject/day. A key namespace is a lexical registry, not a biological
 * identifier declaration. Keep the source bytes and type their values correctly. */
export function iadMeasurement(column:Column,values:readonly string[]):Column{
  const units:Record<string,string>={day:'days',psa:'ug/L',testosterone:'nmol/L',cycle:'cycle',on_treatment:'indicator'};
  const unit=units[column.name];if(!unit)return column;
  const observed=values.filter(v=>!column.missingness_codes.includes(v));
  if(!observed.length||observed.some(v=>!/^[-]?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?(0|[1-9][0-9]*))?$/.test(v)))throw new Error('IAD measurement is not a decimal');
  const decimals=Math.max(0,...observed.map(v=>(v.split(/[eE]/)[0]!.split('.')[1]??'').length-Number(v.split(/[eE]/)[1]??0)));
  return {...column,structural_kind:column.name==='day'?'time':'measurement',storage:'decimal',decimal_resolution:'1e-'+decimals,
    measurement:{type:column.name==='on_treatment'?'binary':column.name==='cycle'?'count':'continuous',unit,bounds:null,categories:column.name==='on_treatment'?['0','1']:[]}};
}
