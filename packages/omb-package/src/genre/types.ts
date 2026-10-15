import type { Checklist } from '../types.ts';
export interface Range {min:number;typical:number;max:number}
export interface Entry {level:'required'|'typical'|'optional';basis:'frequency'|'guideline'|'both';frequency?:string;applies_when?:string;venue_governed?:boolean;notes?:string}
export interface Element extends Entry {id:string;description:string;detect:string[]}
export interface Section extends Entry {id:string;heading:string;aliases:string[];order:number;words:Range|null;subsections:(Entry&{heading:string;aliases:string[];aliases_regex:string[];words:Range|null})[];elements:Element[]}
export interface DisplayRule extends Entry {id:string;type:'figure'|'table'|'box';kind:string;count:Range;placement:'main'|'main-or-supplement'|'supplement';priority:number;detect:string[]}
export interface Profile {schema_version:'genre-profile/1';genre:string;genre_name:string;scope:string;built_on:string;word_count_convention:string;exemplars:Record<string,any>[];sections:Section[];section_order_variants:{name:string;order:string[];seen_in:string[]}[];main_text_words:Range&{counted:string[];methods_counted:boolean;notes:string};abstract:{format:'structured'|'unstructured'|'either';words:Range;heading_sets:{family:string;headings:string[];seen_in:string[]}[];elements:Element[];extra_summaries:unknown[];checklist:string|null};display_items:DisplayRule[];display_items_main_total:Range;required_statements:(Entry&{id:string;label:string;placement:string[];detect:string[]})[];checklists:(Entry&{name:string;kind:string;citation:string;doi:string|null;where:string})[];supplement:(Entry&{id:string;item:string;detect:string[]})[];references:Range;limitations:{placement:string;words:Range|null;conventions:string[];standard_items:(Entry&{id:string;text:string})[]};variation_notes:string;lint_notes:string[];notes:string[]}
export interface LoadedProfile {profile:Profile;sha256:string}
export interface AstNode {t:string;c?:any}
export interface Pandoc {blocks:AstNode[];meta:Record<string,any>; 'pandoc-api-version':number[]}
export interface GenreDeclaration {genre?:string;secondary_genres?:string[];design_flags?:Record<string,boolean>;claim_kinds:string[];study_variant?:string}
export interface SupplementItem {title:string;genre_item?:string;kind?:string;path:string;caption?:string}
export interface LimitationSlot {id:string;status:'addressed'|`not-applicable:${string}`;text:string}
export interface Waiver {rule:string;target:string;profile_sha256:string;reason:string;owner_action_receipt:string;date:string}
export interface OwnerWaiverAction {receipt:string;actor:string;action:'structure-waiver';at:string;waiver_hash:string}
export interface GenreVenue {id:string;shortFormat?:boolean;keptSections?:string[];sectionOrder?:string[];abstractFormat?:'structured'|'unstructured';abstractHeadingFamily?:string;summaryLayers:string[];displayCap:number;limitationsPlacement?:string}
export interface LintInput {ast:Pandoc;supplementAst?:Pandoc;declaration:GenreDeclaration;venue:GenreVenue;manifest:SupplementItem[];checklists:Record<string,Checklist>;checklistMapping:Record<string,string>;limitations:LimitationSlot[];waivers:Waiver[];ownerActions:OwnerWaiverAction[];ownerActor:string;asOf:string;expectedProfileHashes?:Record<string,string>}
export type Severity='FAIL'|'FAIL-W'|'WARN'|'INFO';
export interface Finding {ruleClass:'CONVENTION'|'AMANI-STANDARD';rule:string;severity:Severity;target:string;expected:string;observed:string;location:string|null;hint:string;waiver:Waiver|null;basis?:string;profile_sha256:string|null}
export interface Report {ruleClassPolicyHash:string;limitationsContent?:{headed:boolean;present:boolean};profile:{genre:string;schema_version:string;sha256:string}|null;secondary_profiles:{genre:string;sha256:string}[];venue:string;comparable_words:number;omerta_extension_words:number;summary:{fail:number;fail_w_unwaived:number;fail_w_waived:number;warn:number;info:number};findings:Finding[];promotions:string[]}
