export interface Citation {
  doi: string | null; pmid: string | null; authors: string; year: number;
  title: string; journal: string; volume?: string | null; issue?: string | null; pages?: string | null;
}
export interface CitationInput { id: string; sentence: string; quote: string; citation: Citation }
export type Section = 'abstract' | 'introduction' | 'methods' | 'results' | 'discussion' | 'other';
export interface Passage { section: Section; text: string; citationRanges: Array<[number, number]> }
export interface Metadata {
  doi: string | null; pmid: string | null; title: string; authors: string[];
  year: number; journal: string; journalAbbrev: string | null; volume: string | null; pages: string | null;
}
export interface Receipt { url: string; retrievedAt: number; sha256: string; status: number }
export interface Work {
  metadata: Metadata; passages: Passage[]; fullText: boolean; retracted: boolean;
  flags: string[]; receipts: Receipt[]; retrievedAt: number; textSha256: string;
}
export type Resolution = { state: 'found'; work: Work } | { state: 'not-found' | 'unavailable'; reason: string; receipts: Receipt[]; flags?: string[] };
export type Resolver = (citation: Citation, options?: { fresh?: boolean }) => Promise<Resolution>;
export type Status = 'not-found' | 'metadata-mismatch' | 'retracted' | 'fulltext-verified' | 'abstract-supported' | 'misquoted' | 'source-contradicts' | 'secondary-citation' | 'author-proposal' | 'needs-owner' | 'unavailable' | 'not-indexed';
export type Verdict = 'pass' | 'block' | 'needs-owner';
export interface Evidence {
  section: Section; quote: string; anchorSentence: string; before: string; after: string; window: string;
  start: number; end: number; passage: number; citationMarker: boolean; quoteCitationMarker: boolean;
}
export interface Check { level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5a'; outcome: 'passed' | 'failed' | 'needs-owner' | 'unavailable'; reasons: string[] }
export interface AuditRow {
  id: string; input: CitationInput; verdict: Verdict; status: Status; flags: string[]; reasons: string[];
  checks: Check[]; evidence: Evidence[]; work: Work | null; indexId: string; rowHash: string;
}
