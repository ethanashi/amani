/** I/O adapter only. The caller owns serialization, path authority and durability policy. */
export function persistCheckpoint(write: () => void): void {
  try {
    write();
  } catch (error) {
    if ((error as { code?: unknown } | null | undefined)?.code !== 'ENOSPC') throw error;
    write();
  }
}
