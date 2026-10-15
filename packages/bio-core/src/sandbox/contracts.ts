import type { BoundedCommandSpec } from "../process-contracts.ts";

export type SandboxClass = "seatbelt" | "bwrap" | "refuse";
export type SandboxProfile = "build" | "proof";

export interface SandboxRequest {
  profile: SandboxProfile;
  command: string;
  args: string[];
  cwd: string;
  readableRoots: string[];
  /** Host-declared runtime/package dependencies, never inferred from candidate output. */
  toolchainReadRoots?: string[];
  writableRoots: string[];
  artifactRoot: string;
  toolPath: string;
  /** Allow local IPC over loopback while keeping non-loopback networking disabled. */
  allowLoopback?: boolean;
  /** Headless Chromium inside the proof boundary: its Mach rendezvous service and the temp-dir helper. Requires allowLoopback. */
  allowBrowser?: boolean;
  /** Optional exact port restriction. Refuse on backends that cannot enforce it. */
  loopbackPorts?: number[];
  timeoutMs: number;
  maxOutputBytes?: number;
}

export interface SandboxInvocation {
  sandboxClass: SandboxClass;
  environmentManifest: Record<string, string>;
  spec: BoundedCommandSpec | null;
  refusalReason: string | null;
}

export interface SandboxAdapter {
  prepare(request: SandboxRequest): SandboxInvocation;
}
