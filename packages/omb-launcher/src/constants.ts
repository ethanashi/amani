/** These are release constants, never environment overrides. */
export const AUTHORITY = '/var/db/omb-authority';
// Physical paths: Seatbelt matches resolved paths, so the /var -> private/var alias would be denied.
export const STAGE = '/private/var/db/omb-stage';
export const INSTALL = '/usr/local/libexec/omb';
export const CERT_UID = 401;
export const RUN_UID = 402;
export const REQUEST_CAP = 1024 * 1024;
export const RESPONSE_CAP = 8 * 1024 * 1024;
export const WALL_MS = 30_000;
export type Subcommand = 'attest' | 'confirm' | 'selftest' | 'certify';
export function isSubcommand(value: unknown): value is Subcommand {
  return value === 'attest' || value === 'confirm' || value === 'selftest' || value === 'certify';
}
