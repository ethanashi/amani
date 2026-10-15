import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export interface LiteratureContactConfig {
  contactEmail?: string;
  contactFile?: string;
}
/** Resolve only in the trusted host, after the search-off guard. Never persist the result
 * in investigation configuration, model prompts, receipts or logs. File precedence is
 * contactFile, OMB_LITERATURE_CONTACT_FILE, then ~/.omerta-bio/config/literature-contact.json. */
export function loadLiteratureContact(config: LiteratureContactConfig = {}): string {
  let value: unknown = config.contactEmail;
  if (value === undefined) {
    const file = config.contactFile ?? process.env.OMB_LITERATURE_CONTACT_FILE ?? path.join(homedir(), '.omerta-bio', 'config', 'literature-contact.json');
    try {
      value = (JSON.parse(readFileSync(file, 'utf8')) as { contactEmail?: unknown } | null)?.contactEmail;
    } catch {
      // JSON parse errors can quote the private file contents; discard the original error.
      throw new Error('literature contact file unavailable or invalid');
    }
  }
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('literature contactEmail required');
  return value;
}

/** Request errors can contain the query URL or headers. Mask both plain and URL-encoded
 * contacts, and do not attach the original error/cause to any error sent to a logger. */
export function maskLiteratureContact(message: string, contactEmail: string): string {
  const forms = [contactEmail, encodeURIComponent(contactEmail), new URLSearchParams({ email: contactEmail }).toString().slice('email='.length)];
  for (const form of forms) message = message.replace(new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[contact redacted]');
  return message;
}
