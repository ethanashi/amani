// @omerta-bio/toolpack: the arm-B tool pack. `omb-check` (bundled from this package) exposes the
// exact bio-checks / bio-pipeline validity checks; `omb-sim` (profile `full`) adds seeded design and
// simulation tools. The arm runner is packages/bio-baseline/arms/run-codex-tools-arm.sh.
export { main, COMMANDS, commandsFor } from "./main.ts";
export { FULL_ONLY_COMMANDS } from "./profile.ts";
export { TOOL_VERSION, type ExitCode, type Io, type ToolResult } from "./io.ts";
export {
  buildBundle, bundleDigest, digestDiff, hashTree, importClosure, isProfile, makeLock, readLock, writeBundle,
  LOCK_FILE, LOCK_SCHEMA, NODE_BIN, PROFILES, type Bundle, type Lock, type Profile,
} from "./bundle.ts";
