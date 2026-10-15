export type Citation = { readonly id: string; readonly quote: string } & (
  | { readonly doi: string; readonly pmid?: never }
  | { readonly pmid: string; readonly doi?: never }
);

export interface CitationClaim {
  readonly id: string;
  readonly text: string;
  readonly citationIds: readonly string[];
}

/** null explicitly represents unavailable knowledge, never a negative finding. */
export interface ResolvedCitation {
  readonly exists: boolean | null;
  readonly title: string | null;
  readonly retracted: boolean | null;
  readonly fullText?: string;
  readonly abstract?: string;
}

export interface CitationResolver {
  resolveDoi(doi: string): Promise<ResolvedCitation>;
  resolvePmid?(pmid: string): Promise<ResolvedCitation>;
}

export interface CitationCheckInput {
  readonly claims: readonly CitationClaim[];
  readonly citations: readonly Citation[];
  readonly resolver: CitationResolver;
}

export type CitationStatus = "verified" | "abstract-only" | "fabricated" |
  "retracted" | "quote-not-found" | "unverified";
export type CheckStatus = "verified" | "abstract-only" | "failed" | "refused" | "unverified";

export interface CitationFinding {
  readonly citationId: string;
  readonly status: CitationStatus;
  readonly reason: string;
  readonly source: "full-text" | "abstract" | null;
  readonly title: string | null;
}

export interface ClaimCitationResult {
  readonly claimId: string;
  readonly status: CheckStatus;
  /** True only for full-text verification of every cited item. */
  readonly passed: boolean;
  readonly reason: string;
  readonly citations: readonly CitationFinding[];
}

export interface CitationCheckResult {
  readonly status: CheckStatus;
  readonly passed: boolean;
  readonly reason: string;
  readonly claims: readonly ClaimCitationResult[];
}
