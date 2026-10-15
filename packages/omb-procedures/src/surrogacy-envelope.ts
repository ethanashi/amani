import {SURROGACY_RELEASE} from './surrogacy-release.ts';
import type {SurrogateTrial} from './surrogacy.ts';
/** Interior counts require both endpoints; an isolated passing endpoint cannot bridge a failed one. */
export function surrogateCountBracket(n:number,grid:readonly number[]=SURROGACY_RELEASE.counts,passed:readonly number[]=SURROGACY_RELEASE.passedCounts):number[] {
 if(!Number.isSafeInteger(n)||n<grid[0]!||n>grid.at(-1)!)return [];
 const bracket=grid.includes(n)?[n]:[Math.max(...grid.filter(k=>k<n)),Math.min(...grid.filter(k=>k>n))];
 return bracket.every(k=>passed.includes(k))?bracket:[];
}
export function surrogatePrecision(ts:SurrogateTrial[]){const ratios=(key:'seOutcome'|'seSurrogate')=>Math.max(...ts.map(t=>t[key]))/Math.min(...ts.map(t=>t[key]));return {outcome:ratios('seOutcome'),surrogate:ratios('seSurrogate')};}
export function surrogateTailThreshold(ts:SurrogateTrial[]):number|null {
 const bracket=surrogateCountBracket(ts.length),ratio=surrogatePrecision(ts).outcome;
 if(!bracket.length||!Number.isFinite(ratio)||ratio>5)return null;
 const band=Math.max(1,Math.ceil(ratio-1e-12));
 return Math.max(...bracket.map(n=>SURROGACY_RELEASE.thresholds.find(t=>t.n===n&&t.ratio===band)!.threshold));
}
