import { roles, stages } from "./types";
type Check = (v: any) => boolean;
export const object = (v: any): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const string: Check = (v) => typeof v === "string";
const number: Check = (v) => typeof v === "number" && Number.isFinite(v);
const bool: Check = (v) => typeof v === "boolean";
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const optional =
  (check: Check): Check =>
  (v) =>
    v === undefined || check(v);
const array =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check);
const shape =
  (fields: Record<string, Check>): Check =>
  (v) =>
    object(v) && Object.entries(fields).every(([key, check]) => check(v[key]));
const strings = array(string);
const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    string(v) && values.includes(v);
const dictionary =
  (check: Check): Check =>
  (v) =>
    object(v) && Object.values(v).every(check);
const nonnegative: Check = (v) => number(v) && v >= 0;
const investigation = shape({
  id: string,
  name: string,
  question: string,
  project: string,
  elapsed: string,
  next: string,
  stage: oneOf(stages),
  state: oneOf([
    "pausing",
    "running",
    "queued",
    "paused",
    "needs-you",
    "done",
    "cancelled",
  ]),
  labels: nullable(dictionary(nonnegative)),
  updatedAt: string,
  createdAt: string,
});
const data = shape({
  id: string,
  name: string,
  path: optional(string),
  rows: nullable(nonnegative),
  purpose: string,
  contract: string,
});
const ledger = shape({
  id: string,
  investigationId: string,
  time: string,
  type: string,
  text: string,
  payload: optional(string),
  role: optional(string),
  provider: optional(string),
  model: optional(string),
  outcome: optional(string),
  decision: optional(string),
});
const detailFields = shape({
  resumeToken: optional(nullable(string)),
  providerNotice: optional(nullable(string)),
  data: array(data),
  plan: array(shape({ title: string, text: string })),
  results: array(
    shape({
      id: string,
      title: string,
      label: string,
      effect: string,
      interval: string,
      checks: strings,
    }),
  ),
  metrics: array(shape({ label: string, value: string })),
  certificate: nullable(
    shape({ id: string, scope: string, fingerprint: string }),
  ),
  paper: shape({
    title: string,
    report: optional(nullable(string)),
    abstract: string,
    pdf: nullable(string),
    downloads: array(shape({ label: string, kind: string, filename: string })),
    checklist: strings,
    endorsed: bool,
  }),
});
const settings = shape({
  concurrency: number,
  cpuCores: number,
  memoryGB: number,
  dataFolders: strings,
  notifications: shape({ needsYou: bool, done: bool }),
  author: shape({ name: string, orcid: string }),
  theme: oneOf(["light", "dark", "system"]),
});
const config = shape({
  version: (v) => v === 1,
  providers: dictionary(
    shape({
      kind: string,
      enabled: bool,
      keyRef: optional(string),
      baseUrl: optional(string),
      opencodeProvider: optional(string),
    }),
  ),
  roles: shape(
    Object.fromEntries(
      roles.map((r) => [
        r,
        shape({
          chain: array(
            shape({
              provider: string,
              model: string,
              effort: optional(string),
            }),
          ),
        }),
      ]),
    ),
  ),
  policy: shape({
    crossFamily: string,
    retry: shape({
      maxAttempts: number,
      baseDelayMs: number,
      maxDelayMs: number,
    }),
    circuitBreaker: shape({ failures: number, cooldownMinutes: number }),
    callTimeoutMinutes: number,
    stallMinutes: number,
    repairNudges: number,
    onAllFailed: string,
  }),
  warnings: optional(strings),
});
const metric: Check = (v) =>
  number(v) || (string(v) && /^\d+(\.\d+)?$/.test(v));
const status = shape({
  fixture: bool,
  engine: string,
  modelsOnline: nonnegative,
  active: nonnegative,
  queued: nonnegative,
  limit: nonnegative,
  cpu: metric,
  memoryGB: metric,
  memoryLimitGB: metric,
  freeDiskGB: metric,
  configErrors: optional(strings),
  launcher: shape({
    state: string,
    separation: string,
    analystAccess: string,
    lastCheck: string,
    reason: optional(string),
  }),
  workspace: string,
});
const inbox = shape({
  id: string,
  investigationId: string,
  title: string,
  kind: string,
  reason: string,
  actions: strings,
});
const answer = shape({
  investigationId: string,
  requestId: string,
  text: string,
  citations: array(shape({ entryId: string, label: string })),
  amendmentDraft: string,
});
export function validResult(method: string, v: any, params: any): boolean {
  switch (method) {
    case "investigations.list":
      return array(investigation)(v);
    case "investigations.get":
      return (
        investigation(v) && detailFields(v) && v.id === params.investigationId
      );
    case "investigations.create":
      return investigation(v);
    case "investigations.pause":
    case "investigations.resume":
    case "investigations.cancel":
      return investigation(v) && v.id === params.investigationId;
    case "ledger.tail":
      return (
        array(ledger)(v) &&
        v.every((e: any) => e.investigationId === params.investigationId)
      );
    case "inbox.list":
      return array(inbox)(v);
    case "inbox.act":
      return object(v); // engine acknowledgement; no fields rendered
    case "assistant.ask":
      return (
        answer(v) &&
        v.investigationId === params.investigationId &&
        v.requestId === params.requestId &&
        v.citations.every((c: any) =>
          c.entryId.startsWith(`${params.investigationId}-`),
        )
      );
    case "system.status":
      return status(v);
    case "settings.get":
    case "settings.set":
      return settings(v);
    case "providers.get":
    case "providers.defaults":
      return config(v);
    case "providers.set":
      return shape({
        ok: bool,
        errors: strings,
        warnings: optional(strings),
        config: optional(nullable(config)),
      })(v);
    case "providers.test":
      return shape({ outcome: string, message: string })(v);
    case "providers.models":
      return strings(v);
    case "library.list":
      return array(data)(v);
    case "data.check":
      return shape({
        ok: bool,
        token: optional(string),
        checks: array(shape({ name: string, status: string, detail: string })),
      })(v);
    case "paper.download":
      return shape({ filename: string, mime: string, base64: string })(v);
    default:
      return method.startsWith("fixture.") && v !== undefined;
  }
}
export function validNotification(method: string, p: any): boolean {
  if (!object(p)) return false;
  switch (method) {
    case "investigation.updated":
      return investigation(p.investigation);
    case "ledger.entry":
    case "model.attempt":
      return ledger(p.entry);
    case "provider.attempt":
      return shape({
        investigationId: optional(string),
        provider: string,
        model: string,
        outcome: string,
        message: string,
      })(p);
    case "engine.error":
      return string(p.message);
    case "connection.changed":
      return bool(p.connected);
    case "inbox.changed":
    case "system.changed":
      return optional(string)(p.investigationId);
    default:
      return false;
  }
}
