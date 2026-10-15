import type { OutputProfileId } from './output-profiles.ts';
import type { LimitationSlot,Waiver } from './genre/types.ts';
import type { PaperInput } from '../../omb-paper/src/index.ts';
import type { ApiCslRecord } from '../../omb-citations/src/bibliography.ts';

export type VenueId = 'preprint' | 'plos-one' | 'research-note';
export type StudyKind = 'out-of-sample' | 'diagnostic' | 'prognostic' | 'causal-genetic' | 'observational' | 'data-integrity' | 'reproduction' | 'synthesis';
export interface PolicyRule {
  id: string; kind: 'editorial' | 'generative-ai'; url: string; checkedAt: string;
  quote: string; verified: boolean; rule: string;
}
export interface VenueProfile {
  id: VenueId; name: string; version: string; csl: string;
  caps: { total: number; abstract: number; plainSummary: number; authorSummary: number; displays: number; references: number; caption: number; captions: number; sections: Record<string, number> };
  capBasis: string; abstractHeadings: string[]; summaryLayers: string[];
  sectionOrder?: string[]; abstractHeadingFamily?: string; untitled_introduction?: boolean;
  displayPlacement: 'after-first-citation' | 'after-references';
  defaultOutputProfile: OutputProfileId; doubleSpacing: boolean; lineNumbers: boolean; checklists: string[];
  policies: PolicyRule[]; feeNote: string;
}
export interface Author {
  actor: string; name: string; affiliations: string[]; corresponding: boolean;
  orcid?: string; email?: string; emailApprovedForSubmission?: boolean;
  contributions: { role: string; action: string }[];
}
export interface OwnerRecord {
  schema: 'omb/package-owner@1'; lineageId: string; ownerActor: string;
  authors: Author[]; competingInterests: string; funding: string; ethics: string;
}
export interface Signed<T> { record: T; signature: string }
export interface Endorsement {
  schema: 'omb/package-endorsement@1'; state: 'endorsed' | 'declined'; actor: string; at: string;
  paperInputHash: string; submissionHash: string; reviewHash: string;
}
export interface ReviewRecord {
  schema: 'omb/package-review@1'; paperInputHash: string; submissionHash: string;
  at: string; finalDiffReviewed: boolean; openMajorIssues: number;
}
export interface PolicyReceipt {
  schema: 'omb/package-policy@1'; profileHash: string; paperInputHash: string;
  checkedAt: string; results: { id: string; url: string; quote: string; sourceSha256: string; allowsUse: boolean }[];
}
export interface ModelProvenance {
  provider: string; system: string; modelId: string; version: string; stage: string;
  date: string; software: string; humanRole: string; trainingCutoff: string | null;
  originalPublicationDate: string | null; recallProbe: string; sourceHash: string;
}
export interface ChecklistItem { id: string; text: string; anchor: string; excerpt: string; status: 'software' | 'llm' | 'not-applicable' | 'not-available-in-source-data'; reason?: string }
export interface Checklist { name: string; attribution: string; items: ChecklistItem[] }
export interface Display {
  id: string; kind: 'figure' | 'table'; genreKind?: string; floatWidth?: 'column'|'page'; title: string; caption: string; placement: 'main' | 'supplement';
  /** Regenerated PW3 outputs; hash and semantic validation occur in the trusted display port. */
  svg?: string; markdown?: string; csv: string; dictionary: string;
}
export interface Manuscript {
  title: string; abstract: Record<string, string>; plainSummary: string; authorSummary?: string;
  sections: { id: string; heading: string; markdown: string }[];
  supplement: { id: string; heading: string; markdown: string; genreItem?: string }[];
  limitationsPartB?: LimitationSlot[];
  displays: Display[]; references: ApiCslRecord[]; checklists: Checklist[];
  claimIds: string[]; certificationIds: string[]; skeletonHash: string;
  /** Coverage includes ALL analytical numbers, including unverified supplement values. */
  numericInventory: Record<string, number>;
}
export interface StudyContext {
  kinds: StudyKind[]; humanHealth: boolean; targets: string[];
  datasetCount: number; entityPairCount: number; independentValidation: boolean;
  publicDataOnly: boolean; access: 'public' | 'controlled'; rung: number;
  literatureSearchPresent: boolean; perSampleIdentifiers: string[];
  reanalysisOfOthersData: boolean; differingNumbers: boolean; pipelineReuse: boolean;
  /** Every implicated publication/group must have an individual contact log entry. */
  contactNames: string[]; contactQuestions: string[];
  discrepancies: { source: string; published: string; recomputed: string; csvRow: string }[];
}
export interface BundleFile { path: string; bytes: Uint8Array; sha256: string }
export interface DataPointer { path: string; url: string | null; sha256: string; license: string; access: 'public' }
export interface ReproductionPlan {
  files: BundleFile[]; data: DataPointer[];
  /** Relative script in code/, run by the pinned python environment. Writes numbers.json. */
  entrypoint: string; expected: Record<string, number>; environmentLock: string;
  seeds: Record<string, number>; license: string;
  transcripts: { name: string; text: string }[];
}
export interface Submission {
  outputProfile?: OutputProfileId;
  structureWaivers?: Waiver[];
  input: PaperInput; venue: VenueId; owner: Signed<OwnerRecord>;
  manuscript: Manuscript; study: StudyContext; models: ModelProvenance[];
  reproduction: ReproductionPlan; framework: { version: string; commit: string; gauntletVersion: string; calibrationId: string };
}
export interface PackageRequest { submission: Submission; review: Signed<ReviewRecord>; endorsement: Signed<Endorsement>; policy: Signed<PolicyReceipt> }
export interface RenderedArtifact { name: string; bytes: Uint8Array; text?: string }
/** Host capabilities. None may be selected/configured by drafter JSON. Missing ports refuse. */
export interface UpstreamPorts {
  authenticateInput(input: PaperInput): Promise<void>;
  /** PW5 methods/checklist completeness, PW6 five answers, PW7 final review, PW8 source skeleton. */
  verifySource(submission: Submission): Promise<void>;
  verifyDisplays(displays: readonly Display[]): Promise<void>;
  /** Fresh PW4 L1–L3 and permanent L6 support verdicts. */
  verifyCitations(references: readonly ApiCslRecord[]): Promise<void>;
  /** PW8 closed-world/wording/privacy over extracted PDF text, HTML attributes, DOCX XML. */
  verifyRendered(submission: Submission, artifacts: readonly RenderedArtifact[]): Promise<void>;
}
export interface HostAuthority { verify<T>(value: Signed<T>): boolean }
export interface GateResult { id: string; outcome: 'passed'; evidenceHash: string }
