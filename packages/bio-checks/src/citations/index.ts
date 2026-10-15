export { checkCitations } from "./checker.ts";
export { createCitationResolver, CITATION_USER_AGENT } from "./resolver.ts";
export type {
  Citation, CitationClaim, CitationResolver, ResolvedCitation, CitationCheckInput,
  CitationFinding, ClaimCitationResult, CitationCheckResult, CitationStatus, CheckStatus,
} from "./types.ts";
