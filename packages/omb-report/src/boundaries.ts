import type { ReportContext, Region } from './context.ts';
import type { Sentence } from './grammar.ts';
import { lexicalKey, normalise } from './normalise.ts';
import { requireThat, record, strings } from './common.ts';
/** Ambiguous legacy summary regions are result regions. Callers must opt into
 * explicitly named narrative subregions; a heading in prose cannot change this. */
export const RESULT_REGIONS:readonly string[]=Object.freeze(['title','abstract','abstract-results','abstract-conclusions','results','key-points','conclusion','plain-summary','plain-summary-results']);
export const NARRATIVE_REGIONS:readonly string[]=Object.freeze(['background','introduction','methods','discussion','caption','alt','limitations','abstract-background','abstract-methods','plain-summary-context']);
export function planAliases(plan:Record<string,unknown>):string[] {
 const aliases:string[]=[];
 const visit=(value:unknown):void=>{if(typeof value==='string')aliases.push(normalise(value));else if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')Object.values(record(value)).forEach(visit);};
 for(const key of ['exposure','outcome','adjustment','covariates','entities','aliases','synonyms','abbreviations','symbols'])visit(plan[key]);
 for(const role of ['exposure','outcome'])for(const key of ['aliases','synonyms','abbreviations','symbols'])visit(plan[`${role}_${key}`]);
 return [...new Set(aliases)];
}
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
export function mentions(text:string,aliases:readonly string[]):boolean {const key=lexicalKey(text);return aliases.some(a=>new RegExp(`(?<![\\p{L}\\p{N}])${escape(lexicalKey(a))}(?![\\p{L}\\p{N}])`,'u').test(key));}
/** This is a generic limitation class, not an escape based on a hedge anywhere.
 * No study entities, metric slots, conjunctions, or trailing assertion clauses. */
export function genericLimitation(text:string):boolean {
 return /^(?:(?:unmeasured|residual) confound(?:ers|ing) (?:could|may|might) (?:bias|explain|affect|distort) (?:part of )?(?:the association|associations|interpretation)|findings from observational data cannot establish causation|residual confounding (?:may|could|might) remain|confounding cannot be excluded)[.!?]$/iu.test(text);
}
/** A whole open question, never a hedge that can bless a trailing assertion. */
export function openResearchQuestion(text:string):boolean {return /^(?:does|can) (?:a|the) (?:marker|exposure) predict (?:an?|the) outcome\?$/iu.test(text);}
/** Generic prospective design requirements, never observations. A modal is not
 * sufficient: constrain the subject/predicate and reject empirical side clauses. */
export function methodologicalRequirement(text:string):boolean {
 return /^(?:(?:relevant |the |the relevant )?evidence|the evidential requirements|a prospective evaluation|eligibility|the rationale|an assessment|assessment)\b/iu.test(text)
  && /\b(?:would|could) (?:therefore |consequently |instead )?(?:include|encompass|need|require|concern|be anchored)\b/iu.test(text)
  && !/\b(?:we|our|found|observed|show\w*|demonstrat\w*|prov\w*|cur\w*|caus\w*|improv\w*|reduc\w*|increas\w*|confirm\w*|validat\w*|establish\w*|significan\w*|effective|benefit\w*|harm\w*|is associated|was associated|were associated)\b/iu.test(text);
}
export function checkStructure(ctx:ReportContext,s:Sentence,region:Region,recordedAdjustment=false):void {
 requireThat([...RESULT_REGIONS,...NARRATIVE_REGIONS].includes(region),'unknown manuscript region');
 const claim=s.placeholders.some(p=>p.kind==='claim');
 if(RESULT_REGIONS.includes(region))requireThat(claim,'result-bearing region requires a generated claim sentence');
 if(claim)return; // The template grammar independently permits only a connective.
 const key=normalise(s.prose).toLowerCase();
 const own=/\b(?:we (?:found|observed|show\w*|demonstrat\w*|ruled out|already know)|our (?:study|cohort|results?|findings?|observations?|data|analysis|analyses|hypothes\w*)|ours|this (?:study|analysis) (?:show\w*|found|demonstrat\w*|establish\w*|reveal\w*))\b/iu;
 requireThat(!own.test(key),'study result framing requires a claim token');
 if(s.placeholders.some(p=>p.kind==='c'))return; // Approved literal external quote checked separately.
 if(s.placeholders.some(p=>p.kind==='proc'))return; // Complete, provenance-filled sentence checked separately.
 const aliases=ctx.claims.flatMap(c=>[...c.entities,...planAliases(c.plan)]);
 const named=mentions(key,aliases);
 if(region==='limitations'&&!named&&!s.placeholders.length&&genericLimitation(key))return;
 const neutralQuestion=/^this study looked at a blood marker and its link to a nerve disease[.]$/iu.test(key);
 if(neutralQuestion||openResearchQuestion(key))return;
 const resultFrame=/\b(?:(?:the|these|this|our) (?:association|effect|finding|result|prediction|hypothesis|conclusion|primary analysis)\w*|(?:the|this) (?:marker|biomarker|exposure|outcome|disease|condition)|(?:the|this) (?:study|data) (?:is|was|were|are|succeeded|could|show\w*|prove\w*)|residual doubt|bias is|they go|the answer|it tracks|nothing contradicts|no longer in doubt)\b/iu;
 const framingKey=methodologicalRequirement(key)?key.replace(/\bthe (?:outcome|disease|marker|prediction)\b/gu,'a target'):key;
 requireThat(!resultFrame.test(framingKey),'definite study-result reference requires a claim token');
 // Names and aliases can occur in neutral Methods/context, but no predicate or
 // exposure/outcome relationship may be asserted with those names in prose.
 if(named){
  const neutral=/^(?:[^.!?]+ (?:is|was) the (?:focus|topic|subject) of (?:the )?(?:recruitment|research|discussion|protocol)(?: materials| section| rationale)?|[^.!?]+ (?:is|was) (?:considered|discussed|mentioned)(?: in the (?:protocol|methods|introduction|recruitment materials))?|we discuss [^.!?]+|the protocol describes [^.!?]+)[.!?]$/iu.test(key);
  requireThat(neutral||recordedAdjustment,'claim entity or plan alias needs a claim token');
 }
 requireThat(!/\b(?:earlier|previous|prior|other|published) (?:work|reports?|studies|research)|\bconsistent with\b/iu.test(key),'literature statement requires a frozen citation');
}
