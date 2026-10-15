import type { PlaneAddress } from "./plane.ts";

export type BudgetMode = "subscription" | "metered";

export interface TokenUsage {
  /** Uncached input tokens after adapter normalization. */
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  /** Informational subset of outputTokens; never added twice to totalTokens. */
  reasoningTokens: number;
}

export type BudgetScope =
  | { kind: "project"; projectId: string }
  | { kind: "mission"; projectId: string; missionId: string }
  | { kind: "plane"; projectId: string; planeId: string; includeDescendants: boolean }
  | { kind: "block"; projectId: string; blockId: string }
  | { kind: "run"; projectId: string; runId: string };

export interface BudgetLimits {
  maxTotalTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxEstimatedUsd?: number;
}

export interface BudgetPolicy {
  protocolVersion: 1;
  policyId: string;
  revision: number;
  mode: BudgetMode;
  scope: BudgetScope;
  limits: BudgetLimits;
  configuredAt: string;
}

export interface UsageAttribution extends PlaneAddress {
  blockId: string;
  runId: string;
}

export type UsageSource = "turn" | "result" | "tool" | "imported";

export interface UsageObservation {
  protocolVersion: 1;
  observationId: string;
  attribution: UsageAttribution;
  runnerId: string;
  provider: string;
  model: string;
  /** Explicitly distinguishes attribution requested by the caller from runtime observation. */
  modelSource?: "reported" | "requested" | "unknown";
  requestedModel?: string;
  source: UsageSource;
  tokens: TokenUsage;
  estimatedUsd: number;
  occurredAt: string;
}

export interface BudgetSnapshot extends TokenUsage {
  totalTokens: number;
  estimatedUsd: number;
  observationCount: number;
}

export type BudgetLimitName = keyof BudgetLimits;

export interface BudgetDecision {
  allowed: boolean;
  mode: BudgetMode;
  enforcement: "observe" | "hard";
  exceeded: BudgetLimitName[];
  current: BudgetSnapshot;
  projected: BudgetSnapshot;
}
