// A desktop launch can never inherit development repair authorization.
process.env.AMANI_LAUNCHER = 'desktop';
import { connect } from "node:net";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  unlinkSync,
  lstatSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  process.env.AMANI_ENGINE_ROOT ??
    path.join(homedir(), ".omerta-bio", "studio"),
);
const dir = path.join(
  tmpdir(),
  `amani-${process.getuid()}-${createHash("sha256").update(root).digest("hex").slice(0, 16)}`,
);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const st = lstatSync(dir);
if (
  !st.isDirectory() ||
  st.isSymbolicLink() ||
  st.uid !== process.getuid() ||
  st.mode & 0o077
)
  throw Error("Unsafe engine socket directory");
const socketPath = path.join(dir, "engine.sock");
const open = () =>
  new Promise((resolve, reject) => {
    const s = connect(socketPath);
    s.once("connect", () => {
      s.removeListener("error", reject);
      resolve(s);
    });
    s.once("error", (e) => {
      s.destroy();
      reject(e);
    });
  });
let socket;
try {
  socket = await open();
} catch (e) {
  if (!["ENOENT", "ECONNREFUSED"].includes(e.code)) throw e;
  // Serialize stale-socket replacement and owner launch across simultaneous windows.
  // This lock is never used to kill a process. Dead launchers can be recovered.
  const lock = path.join(dir, "launch.lock");
  let held = false;
  for (let n = 0; n < 200 && !socket; n++) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      held = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = Number(readFileSync(lock, "utf8"));
        if (owner > 0) {
          try {
            process.kill(owner, 0);
          } catch (error) {
            if (error.code === "ESRCH") unlinkSync(lock);
          }
        } else if (Date.now() - lstatSync(lock).mtimeMs > 10000)
          unlinkSync(lock);
      } catch {}
    }
    if (held) {
      try {
        try {
          socket = await open();
        } catch (error) {
          if (!["ENOENT", "ECONNREFUSED"].includes(error.code)) throw error;
          if (error.code === "ECONNREFUSED")
            try {
              unlinkSync(socketPath);
            } catch {}
          const entry =
            process.env.AMANI_DAEMON_ENTRY ??
            fileURLToPath(new URL("./daemon.mjs", import.meta.url));
          const child = spawn(
            process.execPath,
            [
              "--experimental-transform-types",
              "--no-warnings",
              entry,
              root,
              socketPath,
            ],
            { detached: true, stdio: "ignore", env: { ...process.env, AMANI_LAUNCHER: "desktop" } },
          );
          child.unref();
          for (let attempt = 0; attempt < 200; attempt++) {
            await new Promise((r) => setTimeout(r, 25));
            try {
              socket = await open();
              break;
            } catch {}
          }
        }
      } finally {
        unlinkSync(lock);
        held = false;
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 25));
    try {
      socket = await open();
    } catch {}
  }
  if (!socket)
    throw Error("Engine unavailable: could not start workspace owner");
}
process.stdin.pipe(socket);
socket.pipe(process.stdout);
socket.on("error", () => process.exit(1));
socket.on("close", () => process.exit(1));
process.stdin.on("end", () => {
  socket.end();
  process.exit(0);
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    socket.destroy();
    process.exit(0);
  });
