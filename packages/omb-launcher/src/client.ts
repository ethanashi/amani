import { CERTIFY_INPUT_CAP } from './certify.ts';
import { INSTALL, REQUEST_CAP, RESPONSE_CAP, WALL_MS, isSubcommand, type Subcommand } from './constants.ts';
import { boundedProcess, LauncherError, type Execute } from './process.ts';
export interface Reply { ok: true; command: Subcommand; result: unknown }
export function createClient(execute: Execute = boundedProcess()) {
  return async (command: Subcommand, request: unknown = {}): Promise<Reply> => {
    if (!isSubcommand(command)) throw new LauncherError('refused', 'unknown command');
    let input: Buffer;
    try { input = Buffer.from(JSON.stringify(request)); } catch { throw new LauncherError('refused', 'request must be JSON'); }
    if (input.length > (command === 'certify' ? CERTIFY_INPUT_CAP : REQUEST_CAP)) throw new LauncherError('request-limit', 'request exceeds cap');
    const bytes = await execute({ command: '/usr/bin/sudo', args: ['-n', '-u', '_ombcert', `${INSTALL}/bin/cert-launch`, command], input, outputCap: RESPONSE_CAP, timeoutMs: WALL_MS + 5_000 });
    if (bytes.length > RESPONSE_CAP) throw new LauncherError('response-limit', 'response exceeds cap');
    let value: unknown;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new LauncherError('invalid-response', 'invalid JSON response'); }
    if (!value || typeof value !== 'object' || (value as Reply).ok !== true || (value as Reply).command !== command || !Object.hasOwn(value, 'result')) throw new LauncherError('invalid-response', 'unverified response');
    return value as Reply;
  };
}
