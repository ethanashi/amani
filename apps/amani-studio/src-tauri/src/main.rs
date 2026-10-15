#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use base64::Engine;
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
struct EngineState {
    stdin: Mutex<Option<ChildStdin>>,
    started: AtomicBool,
    pid: AtomicU32,
    startup: Instant,
    fixture: AtomicBool,
}
fn runtime_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("AMANI_STUDIO_RUNTIME") {
        return PathBuf::from(dir);
    }
    let root = std::env::var_os("AMANI_ENGINE_ROOT").map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").expect("HOME is required"))
            .join(".omerta-bio/studio"));
    root.join("desktop")
}
fn trace_protocol(direction: &str, value: &Value) {
    if std::env::var_os("AMANI_STUDIO_DIAGNOSTICS").is_none() {
        return;
    }
    // Protocol metadata only: never payloads, model text, keys or errors.
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(runtime_dir().join("protocol-metadata.jsonl"))
    {
        let _ = writeln!(
            file,
            "{}",
            json!({"direction":direction,"id":value.get("id"),"method":value.get("method"),"error":value.get("error").is_some()})
        );
    }
}
#[tauri::command]
fn startup_diagnostic(phase: String) {
    if [
        "rendered",
        "snapshot-loaded",
        "snapshot-failed",
        "frame-ready",
        "js-error",
        "promise-error",
    ]
    .contains(&phase.as_str())
    {
        trace_protocol("frontend", &json!({"method":phase}));
    }
}
fn launch(app: &tauri::AppHandle) -> Result<std::process::Child, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|_| "Resource directory unavailable")?;
    let local = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let node = if resources.join("resources/node").is_file() {
        resources.join("resources/node")
    } else {
        local.join("resources/node")
    };
    let override_entry = std::env::var_os("AMANI_ENGINE_ENTRY").map(PathBuf::from);
    if override_entry.as_ref().is_some_and(|p| !p.is_absolute()) {
        return Err("AMANI_ENGINE_ENTRY must be an absolute service path".into());
    }
    let fixture = false;
    let entry = override_entry.unwrap_or_else(|| {
        if resources.join("resources/engine/bridge.mjs").is_file() {
            resources.join("resources/engine/bridge.mjs")
        } else {
            local.join("../engine/bridge.mjs")
        }
    });
    let state = app.state::<EngineState>();
    state.fixture.store(fixture, Ordering::SeqCst);
    fs::create_dir_all(runtime_dir()).map_err(|_| "Cannot create workspace state directory")?;
    let mut cmd = Command::new(node);
    cmd.arg("--experimental-transform-types").arg("--no-warnings").arg(entry)
        .env("AMANI_LAUNCHER", "desktop")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if fixture {
        cmd.env(
            "AMANI_STUDIO_STATE",
            runtime_dir().join("desktop-fixture.json"),
        );
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Unable to launch engine: {e}"))?;
    state.pid.store(child.id(), Ordering::SeqCst);
    let _ = fs::write(
        runtime_dir().join("engine-process.json"),
        json!({"pid":child.id(),"fixture":fixture}).to_string(),
    );
    *state.stdin.lock().map_err(|_| "Engine lock failed")? = child.stdin.take();
    Ok(child)
}
#[tauri::command]
fn engine_start(app: tauri::AppHandle, state: State<EngineState>) -> Result<(), String> {
    if state.started.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let first = match launch(&app) {
        Ok(c) => c,
        Err(e) => {
            state.started.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };
    std::thread::spawn(move || {
        let mut child = first;
        loop {
            let stdout = child.stdout.take().unwrap();
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(text) => {
                        if let Ok(message) = serde_json::from_str::<Value>(&text) {
                            trace_protocol("received", &message);
                            let _ = app.emit("engine-message", message);
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = child.wait();
            *app.state::<EngineState>().stdin.lock().unwrap() = None;
            let _ = app.emit("engine-state", json!({"connected":false}));
            let mut delay = 500;
            loop {
                std::thread::sleep(Duration::from_millis(delay));
                match launch(&app) {
                    Ok(next) => {
                        child = next;
                        let _ = app.emit("engine-state", json!({"connected":true}));
                        break;
                    }
                    Err(_) => {
                        delay = (delay * 2).min(10000);
                    }
                }
            }
        }
    });
    Ok(())
}
#[tauri::command]
fn engine_send(request: Value, state: State<EngineState>) -> Result<(), String> {
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .ok_or("Missing RPC method")?;
    if method.starts_with("fixture.") && !state.fixture.load(Ordering::SeqCst) {
        return Err("Fixture controls are disabled for production engines".into());
    }
    trace_protocol("sent", &request);
    let serialized = serde_json::to_string(&request).map_err(|_| "Invalid RPC request")?;
    if serialized.len() > 2 * 1024 * 1024 {
        return Err("RPC request too large".into());
    }
    let mut lock = state.stdin.lock().map_err(|_| "Engine lock failed")?;
    let input = lock.as_mut().ok_or("Engine is reconnecting")?;
    writeln!(input, "{}", serialized)
        .map_err(|_| "Engine disconnected; action outcome may be unknown".to_owned())
}
#[tauri::command]
fn keychain_set(account: String, mut secret: String) -> Result<(), String> {
    if ![
        "openrouter",
        "anthropic",
        "openai",
        "opencode-openrouter",
        "opencode-anthropic",
        "opencode-openai",
        "opencode-google",
        "opencode-local",
    ]
    .contains(&account.as_str())
        || secret.is_empty()
        || secret.len() > 16384
    {
        return Err("Invalid Keychain entry".into());
    }
    let result =
        security_framework::passwords::set_generic_password("amani", &account, secret.as_bytes())
            .map_err(|_| "macOS Keychain declined the update".to_owned());
    // Clear the owned IPC string after Keychain has copied it. Never serialize or log it.
    unsafe { secret.as_bytes_mut().fill(0) };
    result
}
#[tauri::command]
async fn save_artifact(
    app: tauri::AppHandle,
    filename: String,
    base64: String,
) -> Result<(), String> {
    if filename.contains('/')
        || filename.contains('\\')
        || filename.starts_with('.')
        || base64.len() > 100 * 1024 * 1024
    {
        return Err("Invalid artifact".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(base64)
            .map_err(|_| "Invalid artifact encoding")?;
        if let Some(path) = app
            .dialog()
            .file()
            .set_file_name(filename)
            .blocking_save_file()
        {
            let path = path.into_path().map_err(|_| "Invalid destination")?;
            fs::write(path, bytes).map_err(|_| "Unable to save artifact")?;
        }
        Ok(())
    })
    .await
    .map_err(|_| "Save task failed".to_owned())?
}
#[tauri::command]
fn startup_ready(state: State<EngineState>, cards: usize, visibility: String) {
    let measurement = json!({"cards":cards,"visibility":visibility,"native_to_interactive_ms":state.startup.elapsed().as_secs_f64()*1000.0,"app_pid":std::process::id(),"engine_pid":state.pid.load(Ordering::SeqCst)});
    let _ = fs::write(runtime_dir().join("startup.json"), measurement.to_string());
}
fn restore_window(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(bytes) = fs::read(runtime_dir().join("window.json")) else {
        return;
    };
    let Ok(v) = serde_json::from_slice::<Value>(&bytes) else {
        return;
    };
    if let (Some(w), Some(h)) = (v["width"].as_f64(), v["height"].as_f64()) {
        let _ = window.set_size(tauri::LogicalSize::new(
            w.clamp(1024.0, 3840.0),
            h.clamp(700.0, 2160.0),
        ));
    }
    if let (Some(x), Some(y), Ok(monitors)) = (
        v["x"].as_i64(),
        v["y"].as_i64(),
        window.available_monitors(),
    ) {
        if monitors.iter().any(|m| {
            let p = m.position();
            let s = m.size();
            x >= p.x as i64
                && y >= p.y as i64
                && x < (p.x as i64 + s.width as i64 - 80)
                && y < (p.y as i64 + s.height as i64 - 80)
        }) {
            let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
        }
    }
    if v["maximized"].as_bool() == Some(true) {
        let _ = window.maximize();
    }
}
fn main() {
    let startup = Instant::now();
    tauri::Builder::default()
        .manage(EngineState { stdin:Mutex::new(None), started:AtomicBool::new(false), pid:AtomicU32::new(0), startup, fixture:AtomicBool::new(true) })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| { restore_window(app); app.set_activation_policy(tauri::ActivationPolicy::Regular); app.show()?; if let Some(window)=app.get_webview_window("main"){window.show()?;window.set_focus()?;} Ok(()) })
        .on_window_event(|window,event| {
            if matches!(event,tauri::WindowEvent::CloseRequested{..}) {
                if let (Ok(size),Ok(scale),Ok(pos))=(window.inner_size(),window.scale_factor(),window.outer_position()) {
                    let logical=size.to_logical::<f64>(scale);
                    let v=json!({"width":logical.width,"height":logical.height,"x":pos.x,"y":pos.y,"maximized":window.is_maximized().unwrap_or(false)});
                    let _=fs::create_dir_all(runtime_dir());
                    let _=fs::write(runtime_dir().join("window.json"),v.to_string());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![engine_start,engine_send,keychain_set,save_artifact,startup_ready,startup_diagnostic])
        .run(tauri::generate_context!())
        .expect("Studio could not start");
}
