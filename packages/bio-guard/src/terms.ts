import { exactKeys, nonempty, record, result, type GuardResult } from "./validation.ts";

/** Host-reviewed metadata, never a worker's assertion that a download is public. */
export interface DatasetTerms {
  access: "public" | "controlled" | "restricted";
  license: string;
}

export interface DatasetIdentity {
  source: string;
  accession: string;
  url: string;
  terms: DatasetTerms;
}

export const TERMS_POLICY_VERSION = "contract-block2-v1";

/** Fixed contract rules. Unknown sources and ambiguous tiers require host review. */
export function checkTerms(input: unknown): GuardResult {
  if (!record(input) || !nonempty(input.source) || !nonempty(input.accession) || !nonempty(input.url)) {
    return result(["dataset identity is missing or malformed"]);
  }
  const source = input.source.toLowerCase().replace(/[^a-z0-9]/g, "");
  let url: URL;
  try { url = new URL(input.url); } catch { return result(["dataset URL is invalid"]); }
  const host = url.hostname.toLowerCase();
  const restricted = source.includes("proact") || host === "ncri1.partners.org"
    ? "PRO-ACT prohibits consumer AI tools"
    : source.includes("answerals") || host === "answerals.org" || host.endsWith(".answerals.org")
      ? "Answer ALS requires an institutional data-use agreement"
      : source.includes("ampals") || source.includes("alsknowledgeportal") || source === "alskp"
        ? "AMP ALS Knowledge Portal controlled/unspecified tiers require institutional authorization"
        : source.includes("dbgap") || /\/dbgap(?:\/|$)/i.test(url.pathname) || /^phs\d/i.test(input.accession)
          ? "dbGaP controlled-access genomic data refused under NIH NOT-OD-25-081"
          : null;
  if (restricted) return result([restricted]);
  if (!record(input.terms) || !exactKeys(input.terms, ["access", "license"]) || !nonempty(input.terms.license)) {
    return result(["terms are missing or unrecognized"]);
  }
  if (input.terms.access !== "public") return result(["restricted, controlled or unknown access refused (NIH NOT-OD-25-081 for controlled genomic data)"]);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    return result(["dataset URL must be an uncredentialed HTTPS source URL"]);
  }
  const license = input.terms.license;
  const allowed =
    source === "geo" && /^GSE\d+$/.test(input.accession) && license === "GEO-public" &&
      ((host === "www.ncbi.nlm.nih.gov" && url.pathname.startsWith("/geo/")) || (host === "ftp.ncbi.nlm.nih.gov" && url.pathname.startsWith("/geo/"))) ||
    source === "cbioportal" && /^[a-zA-Z0-9_-]+$/.test(input.accession) && license === "cBioPortal-public" &&
      ["www.cbioportal.org", "cbioportal.org", "data.cbioportal.org"].includes(host) ||
    source === "gwascatalog" && /^GCST\d+$/.test(input.accession) && license === "GWAS-Catalog-summary-statistics" &&
      ((host === "www.ebi.ac.uk" && url.pathname.startsWith("/gwas/")) || (host === "ftp.ebi.ac.uk" && url.pathname.startsWith("/pub/databases/gwas/"))) ||
    source === "cellxgene" && license === "CC-BY-4.0" &&
      (host === "cellxgene.cziscience.com" || (host === "datasets.cellxgene.cziscience.com" && /\/[^/]+\.(?:h5ad|rds)$/.test(url.pathname)));
  return result(allowed ? [] : ["no allow rule matches the source, accession, URL and exact terms"]);
}

export function assertTerms(input: unknown): asserts input is DatasetIdentity {
  const checked = checkTerms(input);
  if (!checked.ok) throw new Error(`staging refused: ${checked.reasons.join("; ")}`);
}
