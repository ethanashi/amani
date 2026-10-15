import type {
  BudgetPolicy,
  PlaneAddress,
  TokenUsage,
  UsageObservation,
} from "./protocol/index.ts";

export function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must not be blank`);
  }
}

export function assertIsoDate(label: string, value: string): void {
  assertNonBlank(label, value);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date`);
}

function assertNonNegativeFinite(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
}

function assertNonNegativeInteger(label: string, value: number): void {
  assertNonNegativeFinite(label, value);
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
}

export function assertPlaneAddress(address: PlaneAddress): void {
  assertNonBlank("project id", address.projectId);
  assertNonBlank("mission id", address.missionId);
  assertNonBlank("plane id", address.planeId);
  if (!Array.isArray(address.planePath) || address.planePath.length === 0) {
    throw new Error("plane path must contain root through self");
  }
  for (const entry of address.planePath) assertNonBlank("plane path entry", entry);
  if (new Set(address.planePath).size !== address.planePath.length) {
    throw new Error("plane path cannot contain a cycle");
  }
  if (address.planePath.at(-1) !== address.planeId) {
    throw new Error("plane path must end with plane id");
  }
}

export function assertTokenUsage(usage: TokenUsage): void {
  assertNonNegativeInteger("input tokens", usage.inputTokens);
  assertNonNegativeInteger("output tokens", usage.outputTokens);
  assertNonNegativeInteger("cache-read input tokens", usage.cacheReadInputTokens);
  assertNonNegativeInteger("cache-write input tokens", usage.cacheWriteInputTokens);
  assertNonNegativeInteger("reasoning tokens", usage.reasoningTokens);
  if (usage.reasoningTokens > usage.outputTokens) {
    throw new Error("reasoning tokens must be a subset of output tokens");
  }
}

export function assertUsageObservation(observation: UsageObservation): void {
  if (observation.protocolVersion !== 1) throw new Error("unsupported usage protocol version");
  assertNonBlank("observation id", observation.observationId);
  assertPlaneAddress(observation.attribution);
  assertNonBlank("block id", observation.attribution.blockId);
  assertNonBlank("run id", observation.attribution.runId);
  assertNonBlank("runner id", observation.runnerId);
  assertNonBlank("provider", observation.provider);
  assertNonBlank("model", observation.model);
  assertIsoDate("usage occurrence", observation.occurredAt);
  assertTokenUsage(observation.tokens);
  assertNonNegativeFinite("estimated USD", observation.estimatedUsd);
}

export function assertBudgetPolicy(policy: BudgetPolicy): void {
  if (policy.protocolVersion !== 1) throw new Error("unsupported budget protocol version");
  assertNonBlank("policy id", policy.policyId);
  if (!Number.isSafeInteger(policy.revision) || policy.revision < 1) {
    throw new Error("policy revision must be a positive safe integer");
  }
  assertIsoDate("policy configuration time", policy.configuredAt);
  assertNonBlank("scope project id", policy.scope.projectId);
  if (policy.scope.kind === "mission") assertNonBlank("scope mission id", policy.scope.missionId);
  if (policy.scope.kind === "plane") assertNonBlank("scope plane id", policy.scope.planeId);
  if (policy.scope.kind === "block") assertNonBlank("scope block id", policy.scope.blockId);
  if (policy.scope.kind === "run") assertNonBlank("scope run id", policy.scope.runId);

  const entries = Object.entries(policy.limits);
  if (entries.length === 0) throw new Error("budget policy requires at least one visibility limit");
  for (const [name, value] of entries) {
    if (value === undefined) continue;
    assertNonNegativeFinite(name, value);
    if (name !== "maxEstimatedUsd" && !Number.isSafeInteger(value)) {
      throw new Error(`${name} must be a safe integer`);
    }
  }
}
