// Copied from Amani L/packages/harness/src/runner-environment.ts (4fb5d05a), unchanged. See PROVENANCE.md.
/** Transport prerequisites only. Provider/vault secrets and injection variables are not inherited. */
export const RUNNER_ENVIRONMENT_NAMES = [
  "HOME", "PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP",
  "SystemRoot", "WINDIR", "USERPROFILE", "CODEX_HOME",
] as const;

export function runnerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of RUNNER_ENVIRONMENT_NAMES) {
    const value = source[name];
    if (typeof value === "string" && !value.includes("\0")) result[name] = value;
  }
  return result;
}
