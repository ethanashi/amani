export interface KernelEvent<TType extends string = string, TPayload = unknown> {
  eventId: string;
  streamId: string;
  type: TType;
  schemaVersion: 1;
  occurredAt: string;
  producerPlaneId: string;
  payload: TPayload;
}

export interface StoredKernelEvent<TType extends string = string, TPayload = unknown>
  extends KernelEvent<TType, TPayload> {
  sequence: number;
  previousEventSha256: string | null;
  eventSha256: string;
}
