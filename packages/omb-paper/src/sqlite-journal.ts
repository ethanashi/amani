import { openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalSha256 } from '../../bio-core/src/index.ts';

/** Read the actual V7 SqliteJournal format. Open once with NOFOLLOW, and keep the descriptor
 * alive for SQLite's read transaction. The journal must be checkpointed by its owner first. */
export function readInvestigationJournal(file: string, lineageId: string): Record<string, unknown>[] {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let db: DatabaseSync | undefined;
  try {
    const stat=fstatSync(fd);
    if (!stat.isFile() || stat.size > 32_000_000) throw new Error('journal must be a capped regular file');
    // immutable SQLite deliberately ignores WAL. Refuse a live, uncheckpointed database instead
    // of silently reading an older prefix of the investigation.
    let wal:number|undefined;
    try {wal=openSync(file+'-wal',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);if(fstatSync(wal).size>0)throw new Error('journal must be checkpointed before paper collection');}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}finally{if(wal!==undefined)closeSync(wal);}
    const digest=()=>{const bytes=Buffer.alloc(stat.size);if(readSync(fd,bytes,0,bytes.length,0)!==bytes.length)throw new Error('journal changed while reading');return createHash('sha256').update(bytes).digest('hex');};
    const before=digest();
    db = new DatabaseSync(`file:/dev/fd/${fd}?immutable=1`, { readOnly: true });
    db.exec('BEGIN');
    const rows = db.prepare('SELECT * FROM kernel_events WHERE stream_id = ? ORDER BY sequence').all(`inv:${lineageId}`);
    let prior: string | null = null;
    const events = rows.map((row, i) => {
      const payload = JSON.parse(String(row.payload_json)) as { at: number; data: unknown };
      const event = { eventId: row.event_id, streamId: row.stream_id, type: row.event_type, schemaVersion: row.schema_version,
        occurredAt: row.occurred_at, producerPlaneId: row.producer_plane_id, payload };
      if (row.event_id !== `inv:${lineageId}#${i + 1}` || row.previous_event_sha256 !== prior) throw new Error('V7 lineage journal chain is incomplete');
      if (canonicalSha256({ event, previousEventSha256: prior }) !== row.event_sha256) throw new Error('V7 lineage journal hash is invalid');
      prior = String(row.event_sha256);
      return { stream: row.stream_id, seq: i + 1, at: payload.at, type: row.event_type, payload: payload.data, prevHash: row.previous_event_sha256, hash: prior };
    });
    if (fstatSync(fd).size !== stat.size || digest() !== before) throw new Error('journal changed while reading');
    return events;
  } finally { db?.close(); closeSync(fd); }
}
