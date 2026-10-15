import { defineConfig } from "vite";
import type { ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "engine-stdio-bridge",
      configureServer(server: ViteDevServer) {
        let child: ChildProcessWithoutNullStreams;
        let stopped = false;
        let retry: ReturnType<typeof setTimeout>;
        const start = () => {
          child = spawn(
            process.env.AMANI_NODE ?? "/opt/homebrew/opt/node@24/bin/node",
            [resolve(process.env.AMANI_ENGINE_ENTRY ?? "engine/bridge.mjs")],
            {
              env: {
                ...process.env,
                AMANI_STUDIO_STATE: resolve(".runtime/web-fixture.json"),
              },
              stdio: "pipe",
            },
          );
          createInterface({ input: child.stdout }).on("line", (line) => {
            try {
              server.ws.send("engine:message", JSON.parse(line));
            } catch {}
          });
          child.stderr.resume();
          child.on("exit", () => {
            server.ws.send("engine:state", { connected: false });
            if (!stopped)
              retry = setTimeout(() => {
                start();
                server.ws.send("engine:state", { connected: true });
              }, 600);
          });
        };
        start();
        server.ws.on("engine:request", (data: any) => {
          if (child.stdin.writable)
            child.stdin.write(JSON.stringify(data) + "\n");
        });
        server.httpServer?.on("close", () => {
          stopped = true;
          clearTimeout(retry);
          child.stdin.end();
        });
      },
    },
  ],
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
});
