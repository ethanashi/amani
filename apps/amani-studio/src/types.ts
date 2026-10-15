export const stages = [
  "Literature",
  "Plan locked",
  "Practice",
  "Real-data look",
  "Certifying",
  "Paper",
  "Done",
] as const;
export const roles = [
  "worker",
  "reviewer",
  "drafter",
  "referee",
  "assistant",
] as const;
export type Stage = (typeof stages)[number];
export type Investigation = {
  id: string;
  name: string;
  question: string;
  project: string;
  elapsed: string;
  next: string;
  stage: Stage;
  state:
    | "pausing"
    | "running"
    | "queued"
    | "paused"
    | "needs-you"
    | "done"
    | "cancelled";
  labels: Record<string, number> | null;
  updatedAt: string;
  createdAt: string;
};
export type LedgerEntry = {
  id: string;
  investigationId: string;
  time: string;
  payload?: string;
  type: string;
  text: string;
  role?: string;
  provider?: string;
  model?: string;
  outcome?: string;
  decision?: string;
};
export type DataFile = {
  id: string;
  name: string;
  path?: string;
  rows: number | null;
  purpose: string;
  contract: string;
};
export type Detail = Investigation & {
  resumeToken?: string | null;
  providerNotice?: string | null;
  data: DataFile[];
  plan: { title: string; text: string }[];
  results: {
    id: string;
    title: string;
    label: string;
    effect: string;
    interval: string;
    checks: string[];
  }[];
  metrics: { label: string; value: string }[];
  certificate: { id: string; scope: string; fingerprint: string } | null;
  paper: {
    title: string;
    report?: string | null;
    abstract: string;
    pdf: string | null;
    downloads: { label: string; kind: string; filename: string }[];
    checklist: string[];
    endorsed: boolean;
  };
};
export type InboxItem = {
  id: string;
  investigationId: string;
  title: string;
  kind: string;
  reason: string;
  actions: string[];
};
export type ChainEntry = { provider: string; model: string; effort?: string };
export type Provider = {
  kind: string;
  enabled: boolean;
  keyRef?: string;
  baseUrl?: string;
  opencodeProvider?: string;
};
export type ProviderConfig = {
  version: 1;
  providers: Record<string, Provider>;
  roles: Record<(typeof roles)[number], { chain: ChainEntry[] }>;
  policy: {
    crossFamily: string;
    retry: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };
    circuitBreaker: { failures: number; cooldownMinutes: number };
    callTimeoutMinutes: number;
    stallMinutes: number;
    repairNudges: number;
    onAllFailed: string;
  };
};
export type Settings = {
  concurrency: number;
  cpuCores: number;
  memoryGB: number;
  dataFolders: string[];
  notifications: { needsYou: boolean; done: boolean };
  author: { name: string; orcid: string };
  theme: "light" | "dark" | "system";
};
export type Status = {
  configErrors?: string[];
  fixture: boolean;
  engine: string;
  modelsOnline: number;
  active: number;
  queued: number;
  limit: number;
  cpu: number;
  memoryGB: number;
  memoryLimitGB: number;
  freeDiskGB: number;
  launcher: {
    state: string;
    separation: string;
    analystAccess: string;
    lastCheck: string;
    reason?: string;
  };
  workspace: string;
};
export type Answer = {
  investigationId: string;
  requestId: string;
  text: string;
  citations: { entryId: string; label: string }[];
  amendmentDraft: string;
};
export type RpcEvent = { jsonrpc: "2.0"; method: string; params: any };
