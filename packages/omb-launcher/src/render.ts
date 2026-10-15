import { AUTHORITY, CERT_UID, REQUEST_CAP, RUN_UID } from './constants.ts';
export function renderTemplate(template: string, owner: string): string {
  if (!/^[a-z_][a-z0-9_]{0,31}$/.test(owner) || owner.startsWith('_omb')) throw Error('invalid owner');
  const values: Record<string, string> = { OWNER: owner, CERT_UID: String(CERT_UID), RUN_UID: String(RUN_UID), AUTHORITY, REQUEST_CAP: String(REQUEST_CAP) };
  const result = template.replace(/@([A-Z_]+)@/g, (_, key: string) => { if (!(key in values)) throw Error('unknown template token'); return values[key]!; });
  if (/@[A-Z_]+@/.test(result)) throw Error('unrendered token');
  return result;
}
