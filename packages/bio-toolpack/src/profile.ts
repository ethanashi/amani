// Tool pack profiles. `checks`: only the checks Omerta Bio's own software already runs on every
// investigation (inference, automatic validity gates and their primitives, re-execution). `full`:
// adds tools Omerta Bio's worker does not get yet (citation checking and the omb-sim simulators);
// it is enabled for arm B only once arm C's worker receives the identical pack.
export const PROFILES = ["checks", "full"] as const;
export type Profile = (typeof PROFILES)[number];

export function isProfile(value: unknown): value is Profile {
  return typeof value === "string" && (PROFILES as readonly string[]).includes(value);
}

/** omb-check commands that exist only in the `full` profile. */
export const FULL_ONLY_COMMANDS: readonly string[] = ["citations"];
