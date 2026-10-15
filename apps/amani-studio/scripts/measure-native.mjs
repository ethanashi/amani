import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const executable = resolve(
  existsSync("release/Amani Studio.app")
    ? "release/Amani Studio.app/Contents/MacOS/amani-studio"
    : "src-tauri/target/release/bundle/macos/Amani Studio.app/Contents/MacOS/amani-studio",
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (name) => {
  try {
    return JSON.parse(readFileSync(".runtime/" + name, "utf8"));
  } catch {
    return null;
  }
};
const snapshot = () =>
  execFileSync("ps", ["-axo", "pid=,ppid=,%cpu=,rss=,comm="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((line) => {
      const [pid, ppid, cpu, rss, ...name] = line.trim().split(/\s+/);
      return {
        pid: +pid,
        ppid: +ppid,
        cpu: +cpu,
        rssKB: +rss,
        name: name.join(" "),
      };
    });
const runs = [];
const engineRoot = resolve(".runtime/native-real");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
for (let index = 0; index < 3; index++) {
  const before = new Set(snapshot().map((p) => p.pid));
  const start = performance.now();
  const app = spawn(executable, [], {
    stdio: "ignore",
    env: {
      ...process.env,
      AMANI_ENGINE_ROOT: engineRoot,
      AMANI_STUDIO_RUNTIME: resolve(".runtime"),
      AMANI_PROVIDERS_CONFIG: resolve(engineRoot, "providers.json"),
    },
  });
  let ownedPids = [];
  const pid = app.pid;
  try {
    let measurement;
    for (let i = 0; i < 200; i++) {
      measurement = read("startup.json");
      if (measurement?.app_pid === pid) break;
      if (app.exitCode !== null) throw Error("App exited before Board ready");
      await sleep(100);
    }
    if (measurement?.app_pid !== pid)
      throw Error("Native Board did not become interactive within 20 seconds");
    const observed = performance.now() - start;
    await sleep(5000);
    const helpers = snapshot()
      .filter(
        (p) =>
          !before.has(p.pid) &&
          /WebKit\.(WebContent|Networking|GPU)/.test(p.name),
      )
      .map((p) => p.pid);
    const owner = JSON.parse(
      readFileSync(resolve(engineRoot, "daemon.json"), "utf8"),
    );
    const ids = new Set([pid, measurement.engine_pid, owner.pid, ...helpers]);
    ownedPids = [measurement.engine_pid, owner.pid];
    const samples = [];
    for (let i = 0; i < 10; i++) {
      samples.push(snapshot().filter((p) => ids.has(p.pid)));
      await sleep(1000);
    }
    const result = {
      run: index + 1,
      ...measurement,
      owner_engine_pid: owner.pid,
      launch_to_ready_observed_ms: observed,
      helper_pids: helpers,
      idle_samples: samples,
      idle_mean_cpu:
        samples.reduce((a, s) => a + s.reduce((b, p) => b + p.cpu, 0), 0) /
        samples.length,
    };
    runs.push(result);
    console.log(JSON.stringify({ ...result, idle_samples: undefined }));
    if (index === 2) {
      process.kill(measurement.engine_pid, "SIGTERM");
      let restarted;
      for (let i = 0; i < 100; i++) {
        restarted = read("engine-process.json");
        if (restarted?.pid !== measurement.engine_pid && restarted?.pid) break;
        await sleep(100);
      }
      result.restarted_engine_pid = restarted?.pid;
      if (restarted?.pid) ownedPids.push(restarted.pid);
      result.same_engine_owner_after_bridge_restart =
        JSON.parse(readFileSync(resolve(engineRoot, "daemon.json"), "utf8"))
          .pid === owner.pid;
      result.sidecar_restart_survived =
        app.exitCode === null && restarted?.pid !== measurement.engine_pid;
    }
  } finally {
    app.kill("SIGTERM");
    await new Promise((resolve) => app.once("exit", resolve));
    for (let n = 0; n < 100 && ownedPids.some(alive); n++) await sleep(50);
    if (runs[index])
      runs[index].owned_processes_after_quit = ownedPids.filter(alive);
    if (ownedPids.some(alive))
      throw Error("Owned sidecar/idle engine survived quit");
  }
}
writeFileSync(
  "screenshots/native-performance.json",
  JSON.stringify(
    {
      method:
        "Fresh process launches; native main to React commit with engine snapshots and mounted virtual cards; 100ms external observation resolution. Idle CPU sums ps snapshots for app, stdio bridge, workspace engine and newly spawned WebKit helpers after 5 seconds idle. Helpers selected by new PIDs; other concurrent launches may confound helper attribution. Three runs, not OS disk-cache flushed.",
      runs,
    },
    null,
    2,
  ),
);
