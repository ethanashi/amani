export type PlaneStatus = "joining" | "ready" | "busy" | "draining" | "offline";

export interface PlaneAddress {
  projectId: string;
  missionId: string;
  planeId: string;
  /** Root-to-self path. The final entry must equal planeId. */
  planePath: string[];
}

export interface PlaneCapability {
  kind: "runner" | "tool" | "skill" | "oracle" | "workspace" | "resource";
  name: string;
  version: string;
  attributes: Record<string, string | number | boolean>;
}

export interface PlaneDescriptor extends PlaneAddress {
  protocolVersion: 1;
  status: PlaneStatus;
  capabilities: PlaneCapability[];
  maxConcurrentBlocks: number;
}
