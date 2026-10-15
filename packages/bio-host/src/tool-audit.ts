import { createHash } from "node:crypto";
import type { ToolReceipt } from "./tool-hook.ts";
import path from "node:path";

const baseCapabilities = new Set(["Read", "Write", "Edit", "StructuredOutput"]);
type ToolCall = { id: string; tool: string; file?: string; command?: { sha256: string; preview: string } };
export const nativeReadDenial = "<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>";
type NativePermissions = { cwd: string; deny: string[]; bash?: boolean };

// Deliberately support only our literal absolute rules and explicit env rules.
// Unrecognized glob semantics are not guessed and cannot establish a denial.
function deniedReadRule(file: string, policy: NativePermissions): string | undefined {
  const resolved = path.resolve(policy.cwd, file);
  return policy.deny.find(rule => {
    if (rule === "Read(**/.env)") return path.basename(resolved) === ".env";
    if (rule === "Read(**/.env.*)") return path.basename(resolved).startsWith(".env.");
    if (!rule.startsWith("Read(//") || !rule.endsWith(")")) return false;
    const pattern = rule.slice(6, -1), tree = pattern.endsWith("/**");
    const root = tree ? pattern.slice(0, -3) : pattern;
    if (/[\*?\[\]{}]/.test(root)) return false;
    return tree ? resolved.startsWith(root + path.sep) : resolved === root;
  });
}

/** Reconcile the CLI stream with host-owned decisions by ID, never by order.
 * A failed tool result alone is not evidence that the boundary hook ran. */
export function auditToolReceipts(stdout: string, journal: string, nonce: string, permissions?: NativePermissions) {
  const capabilities = new Set([...baseCapabilities, ...(permissions?.bash ? ["Bash"] : [])]);
  const calls = new Map<string, ToolCall>();
  const results = new Map<string, boolean>();
  const nativeDenials = new Set<string>();
  const violations: string[] = [];
  let initCount = 0;
  for (const line of stdout.split("\n").filter(line => line.trim())) {
    const event = JSON.parse(line);
    if (!event || typeof event !== "object") throw new Error("invalid worker stream event");
    if (event.type === "system" && event.subtype === "init") {
      initCount++;
      if (!Array.isArray(event.tools) || event.tools.length === 0 ||
        !event.tools.every((tool: unknown) => typeof tool === "string" && capabilities.has(tool))) violations.push("init tool inventory invalid");
      for (const field of ["plugins", "mcp_servers", "skills", "slash_commands"]) {
        if (!Array.isArray(event[field]) || event[field].length !== 0) violations.push(`init ${field} inventory invalid`);
      }
    }
    if (event.type !== "assistant" && event.type !== "user") continue;
    if (!Array.isArray(event.message?.content)) throw new Error("invalid worker message content");
    for (const item of event.message.content) {
      if (event.type === "assistant" && item?.type === "tool_use") {
        if (typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name) throw new Error("invalid worker tool identity");
        if (calls.has(item.id)) violations.push(`duplicate tool call: ${item.id}`);
        calls.set(item.id, { id: item.id, tool: item.name,
          ...(item.name === "Bash" && typeof item.input?.command === "string" ? { command: { sha256: createHash("sha256").update(item.input.command).digest("hex"), preview: item.input.command.slice(0, 1024) } } : {}),
          ...(typeof item.input?.file_path === "string" ? { file: item.input.file_path } : {}) });
      } else if (event.type === "user" && item?.type === "tool_result") {
        if (typeof item.tool_use_id !== "string" || !item.tool_use_id) throw new Error("invalid worker tool result identity");
        if (results.has(item.tool_use_id)) violations.push(`duplicate tool result: ${item.tool_use_id}`);
        results.set(item.tool_use_id, item.is_error === true);
        if (item.is_error === true && item.content === nativeReadDenial) nativeDenials.add(item.tool_use_id);
      }
    }
  }
  if (initCount !== 1) violations.push("exactly one worker init required");
  const receipts: ToolReceipt[] = journal.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
  const byId = new Map<string, ToolReceipt>();
  let promptAllowed = false;
  for (const receipt of receipts) {
    if (!receipt || receipt.nonce !== nonce || !["allow", "deny"].includes(receipt.decision) ||
      !(receipt.reason === null || typeof receipt.reason === "string") ||
      (receipt.decision === "deny" && !receipt.reason)) throw new Error("invalid native tool receipt");
    if (receipt.event === "UserPromptSubmit" && receipt.tool === null && receipt.id === null && receipt.decision === "allow") {
      promptAllowed = true;
      continue;
    }
    if (receipt.event !== "PreToolUse" || typeof receipt.id !== "string" || !receipt.id ||
      typeof receipt.tool !== "string" || !receipt.tool) throw new Error("invalid native tool receipt identity");
    if (byId.has(receipt.id)) violations.push(`duplicate receipt: ${receipt.id}`);
    byId.set(receipt.id, receipt);
    const call = calls.get(receipt.id);
    if (!call || call.tool !== receipt.tool) violations.push(`receipt/tool mismatch: ${receipt.id}`);
    if (receipt.tool === "Bash" && receipt.decision === "allow" && (!call?.command || !receipt.command ||
      call.command.sha256 !== receipt.command.sha256 || call.command.preview !== receipt.command.preview ||
      !/^[a-f0-9]{64}$/.test(receipt.command.updatedSha256 ?? ""))) violations.push(`Bash command receipt mismatch: ${receipt.id}`);
    if (receipt.decision === "allow" && !capabilities.has(receipt.tool)) violations.push(`unavailable capability allowed: ${receipt.id}`);
    if (receipt.decision === "deny" && results.get(receipt.id) !== true) violations.push(`denial not observed: ${receipt.id}`);
  }
  if (!promptAllowed) violations.push("prompt enforcement receipt missing");
  // Native Read permission rules can block before PreToolUse. Keep those rules
  // (they also protect @ attachments), and receipt only this exact CLI refusal
  // when the requested path demonstrably matches a rule sent to this process.
  const disabled = [...calls.values()].flatMap(call => {
    if (byId.has(call.id) || call.tool !== "Read" || !call.file || call.file.includes("\0") || !permissions || !nativeDenials.has(call.id)) return [];
    const rule = deniedReadRule(call.file, permissions);
    return rule ? [{ nonce, id: call.id, tool: call.tool, decision: "deny" as const, basis: "native-read-deny" as const, rule }] : [];
  });
  const missing = [...calls.keys()].filter(id => !byId.has(id) && !disabled.some(r => r.id === id));
  for (const id of missing) violations.push(`tool enforcement receipt missing: ${id}`);
  for (const id of results.keys()) if (!calls.has(id)) violations.push(`result without tool call: ${id}`);
  return { calls: [...calls.values()], receipts, disabled, missing, violations };
}
