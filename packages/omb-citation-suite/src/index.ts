export * from "./types.ts";
export { CLASS_RULES, COMPATIBLE_STATUSES, expectedFor, triggersFrom } from "./expectations.ts";
export { binomialPmf, clopperPearson, lowerTail, upperTail } from "./binomial.ts";
export { decodeEscapes, foldText, normalizeDoi, normalizeId, stripRetractionMarks, tokens, wordCount, workKeys } from "./normalize.ts";
export { ATTRIBUTION_VERBS, flagsFrom, ID_PATTERN, MAX_EVIDENCE_WORDS, MIN_ANCHOR_WORDS, rowWorkKeys, validateRow, validateSuite } from "./schema.ts";
export { clusterOf } from "./clusters.ts";
export {
  formatReport,
  group,
  parseResults,
  rate,
  resultProblem,
  scoreRow,
  scoreSuite,
  type Admission,
  type GroupScore,
  type Rate,
  type RowOutcome,
  type RowScore,
  type ScoreOptions,
  type ScoreReport,
} from "./scorer.ts";
export { defaultSealEnv, initKey, keyAvailable, openSealed, sealTo, SEAL_PY, type SealEnv } from "./seal.ts";
export { insideRealRoot, recordLook, writePrivateFile, type LookEntry, type LookInfo } from "./private-io.ts";
export {
  buildFingerprints,
  historyText,
  repoFiles,
  repoScanSet,
  scanFingerprints,
  scanPlaintext,
  shingleFingerprints,
  SHINGLE,
  type FingerprintFile,
  type LeakHit,
  type ScanFile,
} from "./leak.ts";
export {
  FINGERPRINT_FILE,
  loadPrivateRows,
  loadPublicRows,
  MANIFEST_FILE,
  parseJsonl,
  PRIVATE_ENC,
  PUBLIC_FILE,
  readFingerprints,
  readManifest,
  sha256,
  toJsonl,
  verifierInputs,
  type Manifest,
} from "./suite.ts";
export { buildSuite, canonical, countClusters, planSplit, rowId, type AuthoringRow, type BuildOptions, type BuildResult } from "./build.ts";
