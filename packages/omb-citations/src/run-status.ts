import type { AuditRow } from './types.ts';
/** Count the unprojected status: suite projection must not erase infrastructure failures. */
export function infrastructureSummary(rows: Pick<AuditRow, 'status'>[]) {
  const unavailable = rows.filter(row => row.status === 'unavailable').length;
  return { infrastructureStatus: unavailable ? 'infrastructure-incomplete' as const : 'complete' as const,
    infrastructureIncomplete: unavailable > 0, unavailable };
}
