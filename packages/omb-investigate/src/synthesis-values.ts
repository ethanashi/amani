import type { ColumnView } from './tabular.ts';
import type { SynthesisColumn } from './synthesis-schema.ts';
import { StagerRefusal } from './pause.ts';

/** Generates from public bounds/type/precision only. It never receives a real measurement. */
export function syntheticNumber(c: ColumnView, d: SynthesisColumn | undefined, rand: () => number): string {
  const integer = d?.storage === 'integer' || (!d?.storage && c.type === 'integer');
  const lo = d?.min ?? c.min ?? (integer ? 0 : -2), hi = d?.max ?? c.max ?? (integer ? 99 : 2);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) throw new StagerRefusal('Invalid synthetic numeric domain');
  const precision = d?.precision;
  if (precision && precision !== 'exact' && 'significant' in precision && !integer) {
    for (let i=0;i<128;i++) {
      const value = Number((lo + rand()*(hi-lo)).toPrecision(precision.significant));
      if (Number.isFinite(value) && value >= lo && value <= hi) return value.toPrecision(precision.significant);
    }
    throw new StagerRefusal('No synthetic value satisfies declared significant precision and bounds');
  }
  // BigInt lattice avoids binary-float tails and unsafe scaled integer arithmetic.
  const decimals = integer ? 0 : precision && precision !== 'exact' && 'decimals' in precision ? precision.decimals : d?.resolution ? Math.max(0, -Math.floor(Math.log10(d.resolution))) + 4 : undefined;
  if (decimals === undefined) return String(lo + rand()*(hi-lo));
  const places = Math.min(15, decimals);
  if (Math.max(Math.abs(lo),Math.abs(hi)) >= 1e21) throw new StagerRefusal('Synthetic fixed precision exceeds supported decimal magnitude');
  const scaled = (n:number) => BigInt(n.toFixed(places).replace('.',''));
  let lower=scaled(lo), upper=scaled(hi);
  if(Number(render(lower,places))<lo)lower++;
  if(Number(render(upper,places))>hi)upper--;
  const step = d?.resolution && !integer ? scaled(d.resolution) : 1n;
  if(step<=0n)throw new StagerRefusal('Synthetic decimal resolution is too fine');
  const floor = (a:bigint,b:bigint) => a/b - (a<0n && a%b!==0n ? 1n : 0n);
  lower = -floor(-lower,step); upper = floor(upper,step);
  if(lower>upper)throw new StagerRefusal('No synthetic value satisfies declared precision and bounds');
  const bits=(BigInt(Math.floor(rand()*4294967296))<<32n)|BigInt(Math.floor(rand()*4294967296));
  return render((lower+bits%(upper-lower+1n))*step,places);
}
function render(v:bigint, places:number):string {
  const sign=v<0n?'-':'', digits=(v<0n?-v:v).toString().padStart(places+1,'0');
  return sign+(places?digits.slice(0,-places)+'.'+digits.slice(-places):digits);
}

/** Keep public marginal counts and all declared levels, but randomize their row assignments.
 * Only categorical columns allocate a row schedule; matrix measurements stream in constant space. */
export function categoricalSchedule(c:ColumnView, d:SynthesisColumn|undefined, rows:number, rand:()=>number):string[]|null {
  if ((d?.storage === 'number' || d?.storage === 'integer') && !d.levels) return null;
  const levels=d?.levels ?? Object.keys(c.levels??{});
  if(!levels.length)return null;
  const missing = Math.max(0,c.missing), counts=levels.map(l=>c.levels?.[l]??0);
  const exact = counts.reduce((a,b)=>a+b,0)+missing===rows;
  const values = exact ? levels.flatMap((l,j)=>Array<string>(counts[j]!).fill(l)) : Array.from({length:Math.max(0,rows-missing)},(_,i)=>levels[i%levels.length]!);
  // Missing slots are inserted by the caller using its declared token.
  for(let i=values.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[values[i],values[j]]=[values[j]!,values[i]!];}
  return values;
}
