import { createServer } from "node:net";
import {
  chmodSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StudioProtocol } from "./protocol.mjs";
/** One workspace owner. Private Unix socket, no TCP listener. Idle owners exit; active work survives UI detach. */
export async function serveEngine(root, socketPath, factory) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const clients = new Set();
  let service,
    protocol,
    idle,
    initializing = true,
    requests = 0;
  const check = () => {
    clearTimeout(idle);
    if (
      !initializing &&
      !clients.size &&
      !service.running.size &&
      requests === 0
    )
      idle = setTimeout(() => {
        if (!clients.size && !service.running.size && requests === 0)
          server.close(() => {
            try {
              unlinkSync(path.join(root, "daemon.json"));
            } catch {}
            process.exit(0);
          });
      }, 1500);
  };
  const server = createServer((socket) => {
    clients.add(socket);
    clearTimeout(idle);
    const ready = () => {
      const send = (v) => {
        if (!socket.destroyed)
          socket.write(JSON.stringify(v) + "\n", (error) => {
            if (error) socket.destroy();
          });
      };
      const notification = (n) => send(n);
      protocol.events.on("notification", notification);
      const lines = createInterface({ input: socket, crlfDelay: Infinity });
      lines.on("error", () => socket.destroy());
      lines.on("line", (line) => {
        if (Buffer.byteLength(line) > 1_000_000) {
          socket.destroy();
          return;
        }
        let request;
        try {
          request = JSON.parse(line);
        } catch {
          send({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Invalid JSON" },
          });
          return;
        }
        requests++;
        void protocol
          .handle(request)
          .then((r) => {
            if (r) send(r);
          })
          .finally(() => {
            requests--;
            check();
          });
      });
      socket.on("close", () => {
        lines.close();
        protocol.events.off("notification", notification);
        clients.delete(socket);
        check();
      });
      socket.on("error", () => socket.destroy());
    };
    if (protocol) ready();
    else server.once("engine-ready", ready);
  });
  // Bind before opening the journals: only one process can ever own this workspace.
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  chmodSync(socketPath, 0o600);
  service = await factory(root);
  protocol = new StudioProtocol(service);
  initializing = false;
  writeFileSync(
    path.join(root, "daemon.json"),
    JSON.stringify({
      pid: process.pid,
      socket: socketPath,
      startedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  service.events.on("notification", () => setImmediate(check));
  server.emit("engine-ready");
  check();
  return { service, protocol, server };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packaged = new URL(
    "./repo/packages/omb-investigate/src/engine-sidecar.ts",
    import.meta.url,
  );
  const { createEngine } = await import(
    existsSync(packaged)
      ? packaged.href
      : new URL(
          "../../../packages/omb-investigate/src/engine-sidecar.ts",
          import.meta.url,
        ).href
  );
  await serveEngine(process.argv[2], process.argv[3], (root) =>
    createEngine(root, process.env.AMANI_PROVIDERS_CONFIG),
  );
}
