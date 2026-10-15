import { constants, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { noLinks } from "./paths.ts";

/** Open once without following the worker-controlled leaf; inspect and read that
 * descriptor, never reopen the pathname after checking it. O_NONBLOCK makes FIFOs
 * refuse immediately. Darwin also rejects symlinks in every path component.
 * Other platforms require host-owned parent paths (worker exports are flat). */
export function regularBytes(file: string, maxBytes = 4 * 1024 * 1024): Buffer {
  noLinks(file);
  // Darwin sys/fcntl.h O_NOFOLLOW_ANY; Node does not expose this constant.
  // It subsumes O_NOFOLLOW; the kernel rejects combining the two flags.
  const noSymlinks = process.platform === "darwin" ? 0x20000000 : constants.O_NOFOLLOW;
  const fd = openSync(file, constants.O_RDONLY | noSymlinks | constants.O_NONBLOCK);
  try {
    const valid = () => {
      const st = fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.size > maxBytes || st.uid !== process.getuid?.()) throw new Error("worker file is not bounded regular owned data");
      return st;
    };
    const before = valid();
    // Bound the read even if a surviving process grows the opened inode.
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const n = readSync(fd, bytes, size, bytes.length - size, null);
      if (!n) break;
      size += n;
    }
    const after = valid();
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("worker file changed while reading");
    return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}
