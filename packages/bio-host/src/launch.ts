import { postTurnSweepWarning } from "../../bio-runner/src/index.ts";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupEvidence, processRows, sweepUserProcesses, type BoundedCommandResult, type BoundedCommandSpec, type CommandRunner, type CleanupEvidence } from "../../bio-core/src/index.ts";
import { PosixProcessHost, type ProcessHost, type GroupRef } from "../../bio-supervisor/src/index.ts";
import { privateFile } from "./paths.ts";
import type { LaunchRecovery } from "../../bio-pipeline/src/index.ts";

interface Reservation { launchId: string; cwd: string; startedAt: number; group?: GroupRef }
interface Options {
  authority: string; now(): number;
  record(type: string, payload: unknown): void;
  history(): { type: string; payload: unknown }[];
  processes?: ProcessHost;
  /** Offline fixture runner; production always dispatches through the prepared gate. */
  runner?: CommandRunner;
  sweep?: (input: { cwd: string; startedAt: number }) => boolean;
}

/** Pipeline intent -> durable reservation -> prepared group -> durable group -> start.
 * The bridge retains core's output/resource/time bounds. Its detached children are
 * discoverable by the same supervisor launch marker and swept by cwd/time; this is observed, not proven.
 */
export class LaunchRegistry implements CommandRunner {
  private pending: Reservation | undefined;
  private active: Reservation | undefined;
  private host: ProcessHost;
  constructor(private options: Options) { this.host = options.processes ?? new PosixProcessHost(); }
  register(launchId: string, cwd: string): { launchId: string } {
    if (!/^[a-f0-9-]{36}$/.test(launchId) || this.pending || this.active) throw new Error("invalid or concurrent launch reservation");
    const reservation = { launchId, cwd, startedAt: this.options.now() };
    this.options.record("launch-reserved", reservation);
    this.pending = reservation;
    return { launchId };
  }
  private sweep(input: { cwd: string; startedAt: number }): boolean {
    return this.options.sweep ? this.options.sweep(input) : sweepUserProcesses({ ...input, observed: [], processGroupIds: [],
      preexisting: processRows().filter(row => row.pid === process.pid) });
  }
  async recover(input: LaunchRecovery): Promise<CleanupEvidence> {
    // An injected runner has no prepared-gate identity for this reaper to inspect.
    if (this.options.runner) return "unproven";
    if (!input.launchId || !/^[a-f0-9-]{36}$/.test(input.launchId)) return "unproven";
    const records = this.options.history().filter(e => e.type.startsWith("launch-") &&
      (e.payload as Reservation).launchId === input.launchId).map(e => e.payload as Reservation);
    // The pipeline journals intent before reserve; absence is safe only after the
    // supervisor positively checks that no gate with this ID exists.
    if (!await this.host.reapLaunch(input.launchId)) return "unproven";
    for (const record of records) if (record.group && !await this.host.reap(record.group)) return "unproven";
    // Stop the bridge first, then scan again: a target wrapper may have been
    // spawned after the first census but before the bridge was killed.
    if (!await this.host.reapLaunch(input.launchId)) return "unproven";
    const targetGroupFile = path.join(this.options.authority, `launch-${input.launchId}.json.group`);
    if (existsSync(targetGroupFile)) {
      privateFile(targetGroupFile);
      if (!await this.host.reap(JSON.parse(readFileSync(targetGroupFile, "utf8")) as GroupRef)) return "unproven";
    }
    const dispatch = records.at(-1);
    if (dispatch && !this.sweep(dispatch)) return "unproven";
    for (const suffix of [".json", ".json.result", ".json.group"]) rmSync(path.join(this.options.authority, `launch-${input.launchId}${suffix}`), { force: true });
    this.options.record("launch-recovered", dispatch ?? { launchId: input.launchId, cwd: input.cwd, startedAt: input.startedAt });
    return "observed-clean";
  }
  async run(spec: BoundedCommandSpec): Promise<BoundedCommandResult> {
    const reservation = this.pending;
    if (!reservation || reservation.cwd !== spec.cwd || spec.onSocketChannel) throw new Error("dispatch has no matching launch reservation");
    this.pending = undefined; this.active = reservation;
    const request = path.join(this.options.authority, `launch-${reservation.launchId}.json`);
    const response = `${request}.result`;
    let settled = false;
    try {
      if (this.options.runner) return await this.options.runner.run(spec);
      const { onStdoutChunk: _out, onStderrChunk: _err, ...serializable } = spec;
      writeFileSync(request, JSON.stringify(serializable), { mode: 0o600, flag: "wx" });
      const prepared = await this.host.prepare({ launchId: reservation.launchId, command: process.execPath,
        args: ["--experimental-transform-types", fileURLToPath(new URL("./launch-bridge.ts", import.meta.url)), request, response, reservation.launchId],
        cwd: spec.cwd, env: { PATH: process.env.PATH } });
      reservation.group = prepared.group;
      this.options.record("launch-prepared", reservation);
      prepared.start();
      const exit = await prepared.completion;
      if (exit.code !== 0 || exit.signal) throw new Error("bounded launch bridge failed");
      const result = JSON.parse(readFileSync(response, "utf8")) as BoundedCommandResult;
      const reaped = await this.host.reap(prepared.group);
      settled = reaped && (cleanupEvidence(result) !== "unproven" || !!postTurnSweepWarning(result));
      if (!reaped) { result.cleanupReason = "groups-alive"; result.observedGroupsReaped = false; result.cleanupStatus = "unproven"; result.processTreeReaped = false; }
      spec.onStdoutChunk?.(result.stdout); spec.onStderrChunk?.(result.stderr);
      return result;
    } finally {
      try {
        if (!this.options.runner && !settled) settled = await this.recover(reservation) !== "unproven";
        if (settled) { rmSync(request, { force: true }); rmSync(response, { force: true }); rmSync(`${request}.group`, { force: true }); }
      } finally { this.active = undefined; }
    }
  }
  async stopAll(): Promise<void> {
    await this.options.runner?.stopAll?.();
    if (this.active && !this.options.runner) await this.recover(this.active);
  }
}
