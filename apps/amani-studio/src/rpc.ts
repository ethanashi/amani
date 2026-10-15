import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { object, validResult, validNotification } from "./validation";
import type { RpcEvent } from "./types";
type Listener = (e: RpcEvent) => void;
export class RpcClient {
  private serial = 0;
  private pending = new Map<
    number,
    {
      method: string;
      params: object;
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Set<Listener>();
  private ready: Promise<void>;
  private bound = false;
  startupError: Error | null = null;
  connected = true;
  constructor(
    private transport?: {
      send: (r: any) => void;
      subscribe: (fn: (v: any) => void) => void;
    },
  ) {
    this.ready = this.start();
  }
  private start() {
    this.startupError = null;
    const ready = this.init()
      .then(() => {
        this.connected = true;
      })
      .catch((e) => {
        this.connected = false;
        this.startupError = e instanceof Error ? e : Error(String(e));
        throw this.startupError;
      });
    // Startup can fail before React subscribes or sends its first request.
    void ready.catch(() => {});
    return ready;
  }
  async retry() {
    this.connection(false);
    this.ready = this.start();
    await this.ready;
  }
  private async init() {
    if (!this.bound) {
      if (this.transport) this.transport.subscribe((v) => this.receive(v));
      else if (isTauri()) {
        const stopMessages = await listen("engine-message", (e) =>
          this.receive(e.payload),
        );
        try {
          await listen<{ connected: boolean }>("engine-state", (e) => {
            if (object(e.payload) && typeof e.payload.connected === "boolean")
              this.connection(e.payload.connected);
            else this.protocolError();
          });
        } catch (error) {
          // Retry must not retain a subscription from a partially bound transport.
          stopMessages();
          throw error;
        }
      } else if (import.meta.hot) {
        import.meta.hot.on("engine:message", (v) => this.receive(v));
        import.meta.hot.on("engine:state", (v) => {
          if (object(v) && typeof v.connected === "boolean")
            this.connection(v.connected);
          else this.protocolError();
        });
      } else if (import.meta.env.MODE !== "test")
        throw Error("Engine transport is unavailable");
      this.bound = true;
    }
    if (!this.transport && isTauri()) await invoke("engine_start");
  }
  private protocolError() {
    const event: RpcEvent = {
      jsonrpc: "2.0",
      method: "engine.error",
      params: {
        message:
          "Invalid engine message. Last valid records retained. Reconnect engine to recover.",
      },
    };
    this.listeners.forEach((fn) => fn(event));
  }
  private connection(connected: boolean) {
    this.connected = connected;
    if (!connected) {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(
          Error(
            "Engine disconnected. Action outcome may be unknown; reconnecting.",
          ),
        );
      }
      this.pending.clear();
    }
    this.receive({
      jsonrpc: "2.0",
      method: "connection.changed",
      params: { connected },
    });
  }
  private receive(value: unknown) {
    if (!object(value)) {
      this.protocolError();
      return;
    }
    const p =
      typeof value.id === "number" ? this.pending.get(value.id) : undefined;
    if (
      value.jsonrpc !== "2.0" ||
      (value.id !== undefined &&
        (!Number.isSafeInteger(value.id) || value.method !== undefined))
    ) {
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(value.id);
        p.reject(Error("Invalid engine response"));
      }
      this.protocolError();
      return;
    }
    if (value.id !== undefined) {
      const error =
        object(value.error) &&
        Number.isInteger(value.error.code) &&
        typeof value.error.message === "string";
      const errorResponse = error && !Object.hasOwn(value, "result");
      const resultResponse =
        !Object.hasOwn(value, "error") && Object.hasOwn(value, "result");
      if (!errorResponse && !resultResponse) {
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(value.id);
          p.reject(Error("Invalid engine response"));
        }
        this.protocolError();
        return;
      }
      if (!p) return; // valid late completion for a disconnected/timed-out request
      clearTimeout(p.timer);
      this.pending.delete(value.id);
      if (errorResponse) p.reject(Error(value.error.message));
      else if (
        !Object.hasOwn(value, "error") &&
        Object.hasOwn(value, "result") &&
        validResult(p.method, value.result, p.params)
      )
        p.resolve(value.result);
      else {
        p.reject(
          Error(
            `Invalid engine response for ${p.method}. Last valid records retained.`,
          ),
        );
        this.protocolError();
      }
    } else if (
      !Object.hasOwn(value, "result") &&
      !Object.hasOwn(value, "error") &&
      typeof value.method === "string" &&
      validNotification(value.method, value.params)
    ) {
      this.listeners.forEach((fn) => fn(value as RpcEvent));
    } else this.protocolError();
  }
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  async call<T = any>(method: string, params: object = {}): Promise<T> {
    await this.ready;
    if (!this.connected) throw Error("Engine is reconnecting");
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          Error("Engine request timed out; action outcome may be unknown"),
        );
      }, 30000);
      this.pending.set(id, { method, params, resolve, reject, timer });
      const request = { jsonrpc: "2.0", id, method, params };
      if (this.transport) this.transport.send(request);
      else if (isTauri())
        invoke("engine_send", { request }).catch((e) => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(Error(String(e)));
        });
      else import.meta.hot!.send("engine:request", request);
    });
  }
}
export const rpc = new RpcClient();
export async function storeKey(account: string, secret: string) {
  if (!isTauri()) throw Error("Keychain is available in the desktop app only");
  await invoke("keychain_set", { account, secret });
}
export async function pickFiles(directory = false): Promise<string[]> {
  if (!isTauri()) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selection = await open({ multiple: !directory, directory });
  return selection ? (Array.isArray(selection) ? selection : [selection]) : [];
}
export async function downloadArtifact(investigationId: string, kind: string) {
  const file = await rpc.call<{
    filename: string;
    mime: string;
    base64: string;
  }>("paper.download", { investigationId, kind });
  if (isTauri()) {
    await invoke("save_artifact", {
      filename: file.filename,
      base64: file.base64,
    });
    return;
  }
  const url = URL.createObjectURL(
    new Blob([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], {
      type: file.mime,
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function notifyDesktop(
  title: string,
  body: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const n = await import("@tauri-apps/plugin-notification");
    if (!(await n.isPermissionGranted()))
      return "Desktop notifications are unavailable. Review Settings → Workspace notifications and macOS notification permissions.";
    await n.sendNotification({ title, body });
    return null;
  } catch {
    return "Desktop notification failed. Review Settings → Workspace notifications and macOS notification permissions.";
  }
}
export async function enableNotifications() {
  if (!isTauri()) return;
  const n = await import("@tauri-apps/plugin-notification");
  if (!(await n.isPermissionGranted())) await n.requestPermission();
}
