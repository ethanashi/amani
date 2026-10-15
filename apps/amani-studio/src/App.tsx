import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import {
  LayoutGrid,
  Layers,
  Inbox,
  Library,
  Settings as SettingsIcon,
  Search,
  Plus,
  Folder,
  Lock,
  HardDrive,
  ShieldCheck,
  ArrowRight,
  Activity,
  Sun,
  Moon,
  Command,
  ChevronDown,
} from "lucide-react";
import { rpc, notifyDesktop } from "./rpc";
import {
  stages,
  type Investigation,
  type InboxItem,
  type Status,
  type Settings as SettingsType,
  type DataFile,
} from "./types";
import { VirtualList, Modal, Empty, Pill } from "./components";
import { Workspace } from "./Workspace";
import { SettingsPage } from "./Settings";
import { NewInvestigation } from "./NewInvestigation";
const screens = ["Board", "Investigations", "Needs you", "Library", "Settings"];
const icons = [LayoutGrid, Layers, Inbox, Library, SettingsIcon];
export function App() {
  const [screen, setScreen] = useState("Board");
  const [items, setItems] = useState<Investigation[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [status, setStatus] = useState<Status>();
  const [settings, setSettings] = useState<SettingsType>();
  const [selected, setSelected] = useState<string>();
  const [project, setProject] = useState("All projects");
  const [stage, setStage] = useState("All stages");
  const [filter, setFilter] = useState("All work");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("updated");
  const [connected, setConnected] = useState(true);
  const [startupFailure, setStartupFailure] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const [notificationNotice, setNotificationNotice] = useState<string | null>(
    null,
  );
  const [toast, setToast] = useState("");
  const [sheet, setSheet] = useState(false);
  const [palette, setPalette] = useState(false);
  const [command, setCommand] = useState("");
  const [library, setLibrary] = useState<DataFile[]>([]);
  const [inboxId, setInboxId] = useState<string>();
  const [revision, setRevision] = useState(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const report = useCallback(
    (e: unknown) => setError(String(e instanceof Error ? e.message : e)),
    [],
  );
  const load = useCallback(async () => {
    const [i, n, s, c, l] = await Promise.all([
      rpc.call<Investigation[]>("investigations.list"),
      rpc.call<InboxItem[]>("inbox.list"),
      rpc.call<Status>("system.status"),
      rpc.call<SettingsType>("settings.get"),
      rpc.call<DataFile[]>("library.list"),
    ]);
    if (isTauri())
      void invoke("startup_diagnostic", { phase: "snapshot-loaded" }).catch(
        () => {},
      );
    setItems(i);
    setInbox(n);
    setStatus(s);
    setSettings(c);
    setLibrary(l);
    setConnected(true);
    setStartupFailure("");
    setError("");
    setRevision((r) => r + 1);
  }, []);
  useEffect(() => {
    if (isTauri())
      void invoke("startup_diagnostic", { phase: "rendered" }).catch(() => {});
    load().catch((e) => {
      if (isTauri())
        void invoke("startup_diagnostic", { phase: "snapshot-failed" }).catch(
          () => {},
        );
      setStartupFailure(String(e instanceof Error ? e.message : e));
      setConnected(false);
      report(e);
    });
    return rpc.subscribe((e) => {
      if (e.method === "investigation.updated") {
        const x = e.params.investigation as Investigation;
        setItems((old) =>
          old.some((i) => i.id === x.id)
            ? old.map((i) => (i.id === x.id ? x : i))
            : [x, ...old],
        );
        setRevision((r) => r + 1);
        if (x.state === "done" && settingsRef.current?.notifications.done)
          void notifyDesktop("Investigation complete", x.name).then(
            setNotificationNotice,
          );
      }
      if (e.method === "engine.error") report(e.params.message);
      if (e.method === "provider.attempt" && e.params.outcome !== "ok")
        setToast(e.params.message);
      if (e.method === "inbox.changed") {
        rpc.call<InboxItem[]>("inbox.list").then(setInbox).catch(report);
        if (settingsRef.current?.notifications.needsYou)
          void notifyDesktop(
            "Amani needs you",
            "An investigation needs your review.",
          ).then(setNotificationNotice);
      }
      if (e.method === "system.changed")
        rpc.call<Status>("system.status").then(setStatus).catch(report);
      if (e.method === "connection.changed") {
        setConnected(e.params.connected);
        if (e.params.connected)
          load().catch((e) => {
            setStartupFailure(String(e));
            report(e);
          });
      }
    });
  }, [load, report]);
  useEffect(() => {
    if (status && !performance.getEntriesByName("studio-interactive").length) {
      performance.mark("studio-interactive");
      if (isTauri())
        void invoke("startup_ready", {
          cards: document.querySelectorAll(".task").length,
          visibility: document.visibilityState,
        }).catch(() => {});
    }
  }, [status]);
  const retryEngine = async () => {
    setRetrying(true);
    try {
      await rpc.retry();
      await load();
    } catch (e) {
      setStartupFailure(String(e instanceof Error ? e.message : e));
      report(e);
    } finally {
      setRetrying(false);
    }
  };
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        settings?.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : (settings?.theme ?? "light");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings?.theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  const go = useCallback((s: string, id?: string) => {
    setScreen(s);
    setSelected(id);
    setPalette(false);
    setCommand("");
  }, []);
  useEffect(() => {
    let prefix = 0;
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if ((e.target as HTMLElement).closest("input,textarea,select,dialog"))
        return;
      if (e.key === "g") {
        prefix = Date.now();
        return;
      }
      if (Date.now() - prefix < 1200) {
        const target = (
          {
            b: "Board",
            i: "Investigations",
            n: "Needs you",
            s: "Settings",
          } as Record<string, string>
        )[e.key];
        if (target) {
          go(target);
          prefix = 0;
          return;
        }
      }
      if (e.key === "n" && !e.metaKey) setSheet(true);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go]);
  const open = (id: string) => go("Investigations", id);
  const projects = [...new Set(items.map((i) => i.project))];
  const filtered = items.filter(
    (i) =>
      (project === "All projects" || i.project === project) &&
      (stage === "All stages" || i.stage === stage) &&
      (filter === "All work" ||
        (filter === "Running" && i.state === "running") ||
        (filter === "Needs you" && ["paused", "needs-you"].includes(i.state)) ||
        (filter === "Done" && i.state === "done")) &&
      `${i.name} ${i.id} ${i.question}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const sorted = [...filtered].sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name)
      : sort === "stage"
        ? stages.indexOf(a.stage) - stages.indexOf(b.stage)
        : b.updatedAt.localeCompare(a.updatedAt),
  );
  const task = (i: Investigation) => (
    <button className="task" onClick={() => open(i.id)}>
      <div className="task-top">
        <span title={i.id}>
          {i.id.length > 14 ? i.id.slice(0, 12) + "…" : i.id}
        </span>
        <span>{i.elapsed}</span>
      </div>
      <h3>{i.question}</h3>
      <span className="task-project">{i.project}</span>
      <div className="task-next">
        <ArrowRight size={11} />
        <span>{i.next}</span>
      </div>
      <div className="labels">
        {i.labels
          ? Object.entries(i.labels).map(([k, v]) => (
              <span key={k}>
                {k} {v}
              </span>
            ))
          : "No labels yet"}
      </div>
    </button>
  );
  const selectedInbox = inbox.find((i) => i.id === inboxId) ?? inbox[0];
  return (
    <div className="window">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="titlebar" data-tauri-drag-region>
        <span className="window-caption">
          <Command size={12} /> Amani Studio
        </span>
        <span>
          {status?.workspace ??
            (startupFailure
              ? "Workspace unavailable"
              : "Connecting to workspace")}
        </span>
        <span className="muted">
          {status?.fixture ? "Fixture / Local workspace" : "Local workspace"}
        </span>
      </div>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <svg viewBox="0 0 28 32" aria-hidden="true">
              <path fill="#a8f071" d="M14 1 27 25H19L14 14 8 25H1Z" />
              <path
                stroke="white"
                fill="none"
                strokeWidth="3"
                d="m9 25 5 5 8-10"
              />
            </svg>
            Amani <span>Studio</span>
          </div>
          <div className="lab-switch">
            <span className="lab-logo">A</span>Research workspace
            <ChevronDown size={12} />
          </div>
          <nav aria-label="Main navigation">
            {screens.map((s, i) => {
              const Icon = icons[i];
              return (
                <button
                  key={s}
                  className={screen === s ? "active" : ""}
                  onClick={() => go(s)}
                >
                  <Icon size={16} />
                  {s}
                  <small>
                    {s === "Investigations"
                      ? items.length
                      : s === "Needs you"
                        ? inbox.length
                        : ""}
                  </small>
                </button>
              );
            })}
          </nav>
          <div className="nav-label">
            Projects <span>{projects.length}</span>
          </div>
          <div className="project-links">
            {projects.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setProject(p);
                  go("Board");
                }}
              >
                <Folder size={13} />
                {p}
              </button>
            ))}
          </div>
          <div className="nav-label">Recent investigations</div>
          <div className="project-links">
            {items.slice(0, 3).map((i) => (
              <button key={i.id} onClick={() => open(i.id)}>
                <Layers size={13} />
                <span>{i.name}</span>
              </button>
            ))}
          </div>
          <div className="sidebar-bottom">
            <div className="local-sidebar">
              <Lock size={13} />
              Private data stays local
            </div>
            <div className="user">
              <span className="avatar">
                {settings?.author.name
                  ? settings.author.name.slice(0, 2).toUpperCase()
                  : "ME"}
              </span>
              <div>
                {settings?.author.name || "Local owner"}
                <small>Research workspace</small>
              </div>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="crumb">
              <Folder size={14} />
              {screen}
              {selected && (
                <>
                  <span>/</span>
                  <span>{items.find((i) => i.id === selected)?.name}</span>
                </>
              )}
            </div>
            <button className="search-trigger" onClick={() => setPalette(true)}>
              <Search size={14} />
              Search investigations, records…<kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button"
              aria-label="Toggle color theme"
              onClick={() => {
                if (settings)
                  rpc
                    .call<SettingsType>("settings.set", {
                      settings: {
                        ...settings,
                        theme:
                          document.documentElement.dataset.theme === "dark"
                            ? "light"
                            : "dark",
                      },
                    })
                    .then(setSettings)
                    .catch(report);
              }}
            >
              {settings?.theme === "dark" ? (
                <Sun size={15} />
              ) : (
                <Moon size={15} />
              )}
            </button>
          </header>
          {!connected && !startupFailure && (
            <div className="connection" role="status">
              Engine unavailable · reconnecting. A workspace engine may still be
              running. After an engine crash, review Activity and resume
              interrupted work explicitly.
            </div>
          )}
          {notificationNotice && (
            <div className="connection" role="status">
              {notificationNotice}
              <button
                className="button"
                onClick={() => {
                  go("Settings");
                  setNotificationNotice(null);
                }}
              >
                Review notification settings
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => setError("")}>Dismiss</button>
              <button disabled={retrying} onClick={() => void retryEngine()}>
                Reconnect engine
              </button>
            </div>
          )}
          <main
            id="main"
            tabIndex={-1}
            className="content"
            aria-busy={!status && !startupFailure}
          >
            {!!status?.configErrors?.length && (
              <div className="validation" role="status">
                Provider configuration needs repair:{" "}
                {status.configErrors.join("; ")}
                <button className="button" onClick={() => go("Settings")}>
                  Repair provider settings
                </button>
              </div>
            )}
            {!status ? (
              startupFailure ? (
                <div className="page" role="status">
                  <h1>
                    {screen === "Settings"
                      ? "Settings · Engine unavailable"
                      : "Engine unavailable"}
                  </h1>
                  <p>{startupFailure}</p>
                  <h2>Repair the local engine</h2>
                  <p>
                    The bundled Node engine or its transport could not start.
                    Reinstall a complete Amani Studio application with its
                    engine resources, then retry. Existing investigations remain
                    in your local workspace.
                  </p>
                  <button
                    className="button"
                    disabled={retrying}
                    onClick={() => void retryEngine()}
                  >
                    Retry engine
                  </button>
                </div>
              ) : (
                <Empty>Connecting to the local engine…</Empty>
              )
            ) : selected ? (
              <Workspace
                key={selected}
                id={selected}
                revision={revision}
                report={report}
                toast={setToast}
                openInbox={() => go("Needs you")}
              />
            ) : screen === "Settings" ? (
              <SettingsPage
                settings={settings!}
                setSettings={setSettings}
                status={status}
                refreshStatus={async () =>
                  setStatus(
                    await rpc.call<Status>("system.status", {
                      refreshLauncher: true,
                    }),
                  )
                }
                report={report}
                toast={setToast}
              />
            ) : screen === "Library" ? (
              <div className="page">
                <div className="page-head">
                  <h1>Data library</h1>
                  <button
                    className="button primary"
                    onClick={() => setSheet(true)}
                  >
                    New investigation
                  </button>
                </div>
                <div className="library-grid">
                  {library.map((f) => (
                    <article className="settings-card" key={f.id}>
                      <Library size={24} />
                      <h2>{f.name}</h2>
                      <p>{f.purpose}</p>
                      <p className="muted">
                        {f.rows === null ? "Not counted" : `${f.rows} rows`} ·{" "}
                        {f.contract}
                      </p>
                      <button className="button" onClick={() => setSheet(true)}>
                        Use in investigation
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            ) : screen === "Needs you" ? (
              <div className="page inbox-page">
                <div className="page-head">
                  <div>
                    <h1>
                      Needs you{" "}
                      <span className="count">{inbox.length} open items</span>
                    </h1>
                    <p className="head-sub">
                      Owner reviews, questions and decisions
                    </p>
                  </div>
                </div>
                <div className="inbox-layout">
                  <VirtualList
                    label="Inbox items"
                    items={inbox}
                    height="100%"
                    rowHeight={104}
                    render={(i) => (
                      <button
                        className={`inbox-item ${selectedInbox?.id === i.id ? "selected" : ""}`}
                        onClick={() => setInboxId(i.id)}
                      >
                        <span className="task-top">
                          {i.kind} <span>{i.investigationId}</span>
                        </span>
                        <h3>{i.title}</h3>
                      </button>
                    )}
                  />
                  {selectedInbox ? (
                    <InboxDetail
                      key={selectedInbox.id}
                      item={selectedInbox}
                      open={open}
                      report={report}
                      toast={setToast}
                    />
                  ) : (
                    <Empty>No items need your attention.</Empty>
                  )}
                </div>
              </div>
            ) : (
              <div className="page board-page">
                <div className="page-head">
                  <div>
                    <h1>
                      {screen}{" "}
                      <span className="count">
                        {items.length} investigations
                      </span>
                    </h1>
                    <p className="head-sub">
                      {status.workspace} /{" "}
                      {new Date().toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="button-group">
                    <button
                      className="button"
                      onClick={() => {
                        const i = items.find((i) => i.state === "running");
                        if (i) open(i.id);
                      }}
                    >
                      <Activity size={13} />
                      Activity
                    </button>
                    <button
                      className="button primary"
                      onClick={() => setSheet(true)}
                    >
                      <Plus size={14} />
                      New investigation <kbd>N</kbd>
                    </button>
                  </div>
                </div>
                <div className="toolbar">
                  <div className="view-tabs">
                    {["All work", "Running", "Needs you", "Done"].map((f) => (
                      <button
                        key={f}
                        className={filter === f ? "selected" : ""}
                        onClick={() => setFilter(f)}
                      >
                        {f}{" "}
                        <span>
                          {f === "All work"
                            ? items.length
                            : f === "Running"
                              ? status.active
                              : f === "Needs you"
                                ? items.filter((i) =>
                                    ["paused", "needs-you"].includes(i.state),
                                  ).length
                                : items.filter((i) => i.state === "done")
                                    .length}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="button-group">
                    <select
                      aria-label="Project filter"
                      value={project}
                      onChange={(e) => setProject(e.target.value)}
                    >
                      {["All projects", ...projects].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Stage filter"
                      value={stage}
                      onChange={(e) => setStage(e.target.value)}
                    >
                      {["All stages", ...stages].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="resource-strip">
                  <div
                    className="slots"
                    role="img"
                    aria-label={`${status.active} of ${status.limit} slots active`}
                  >
                    {Array.from(
                      { length: Math.min(status.limit, 16) },
                      (_, i) => (
                        <i key={i} className={i < status.active ? "on" : ""} />
                      ),
                    )}
                  </div>
                  <strong>
                    {status.active} of {status.limit} run slots
                  </strong>
                  <span>{status.queued} queued</span>
                  <span>
                    {status.fixture
                      ? `CPU ${status.cpu}%`
                      : `System load ${status.cpu}`}
                  </span>
                  <span>
                    Memory {status.memoryGB} / {status.memoryLimitGB} GB
                  </span>
                  <button className="text-link" onClick={() => go("Settings")}>
                    Manage compute →
                  </button>
                </div>
                {screen === "Board" ? (
                  <>
                    <div className="board-grid">
                      {stages.map((s, index) => {
                        const cards = filtered.filter(
                          (i) =>
                            i.stage === s &&
                            !["paused", "needs-you", "cancelled"].includes(
                              i.state,
                            ),
                        );
                        return (
                          <section className="stage" key={s} aria-label={s}>
                            <h2 className="stage-heading">
                              <span className="stage-symbol">
                                {["◫", "♙", "♧", "♙", "◇", "▤", "✓"][index]}
                              </span>
                              {s}
                              <span>{cards.length}</span>
                            </h2>
                            <VirtualList
                              label={`${s} investigations`}
                              items={cards}
                              height="calc(100vh - 465px)"
                              rowHeight={176}
                              render={task}
                            />
                          </section>
                        );
                      })}
                    </div>
                    <div className="board-bottom">
                      <div className="queue-head">
                        <h2>
                          Paused / Needs you{" "}
                          <span className="count">
                            {
                              filtered.filter((i) =>
                                ["paused", "needs-you"].includes(i.state),
                              ).length
                            }
                          </span>
                        </h2>
                        <button
                          className="text-link"
                          onClick={() => go("Needs you")}
                        >
                          Open inbox · {inbox.length} tasks →
                        </button>
                      </div>
                      <VirtualList
                        label="Paused investigations"
                        items={Array.from(
                          {
                            length: Math.ceil(
                              filtered.filter((i) =>
                                ["paused", "needs-you"].includes(i.state),
                              ).length / 3,
                            ),
                          },
                          (_, n) =>
                            filtered
                              .filter((i) =>
                                ["paused", "needs-you"].includes(i.state),
                              )
                              .slice(n * 3, n * 3 + 3),
                        )}
                        height={96}
                        rowHeight={88}
                        render={(group) => (
                          <div className="queue-cards">
                            {group.map((i) => (
                              <button
                                key={i.id}
                                className="queue-card"
                                onClick={() => open(i.id)}
                              >
                                <span>Ⅱ</span>
                                <div>
                                  <h3>
                                    {i.name} / {i.id}
                                  </h3>
                                  <p>{i.question}</p>
                                  <small>
                                    {i.project} · {i.next}
                                  </small>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="list-tools">
                      <label className="search-field">
                        <Search size={14} />
                        <input
                          aria-label="Search investigations"
                          placeholder="Search by question, name or ID"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <select
                        aria-label="Sort investigations"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="updated">Last updated</option>
                        <option value="name">Name</option>
                        <option value="stage">Stage</option>
                      </select>
                      <span className="muted">J / K to move</span>
                    </div>
                    <div className="investigation-row table-head">
                      <span>Investigation</span>
                      <span>Project</span>
                      <span>Stage</span>
                      <span>Status</span>
                    </div>
                    <VirtualList
                      label="Investigations list"
                      height="calc(100vh - 360px)"
                      items={sorted}
                      rowHeight={64}
                      render={(i) => (
                        <button
                          className="investigation-row"
                          onClick={() => open(i.id)}
                        >
                          <div>
                            <strong>{i.name}</strong>
                            <small>
                              {i.id} · {i.question}
                            </small>
                          </div>
                          <span>{i.project}</span>
                          <span>{i.stage}</span>
                          <Pill>{i.state}</Pill>
                        </button>
                      )}
                    />
                    {sorted.length === 0 && (
                      <Empty>No investigations match these filters.</Empty>
                    )}
                  </>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
      <footer className="statusbar" role="status">
        <span className="status-local">
          ✓ Models online · {status?.modelsOnline ?? "—"}
        </span>
        <span>
          <Activity size={12} />
          {status?.active ?? "—"} running · {status?.queued ?? "—"} queued
        </span>
        <span>
          <ShieldCheck size={12} />
          Launcher: {status?.launcher.state ?? "—"}
        </span>
        <span className="status-right">
          <HardDrive size={12} />
          {status?.freeDiskGB ?? "—"} GB free
        </span>
        <span>
          <Lock size={11} />
          {connected ? "Local" : startupFailure ? "Offline" : "Reconnecting"}
        </span>
        <span>
          {!connected || (!!startupFailure && !status)
            ? "Engine unavailable"
            : status?.fixture
              ? "Synthetic data"
              : status
                ? "Engine connected"
                : "Connecting"}
        </span>
      </footer>
      {sheet && (
        <NewInvestigation
          fixture={status?.fixture ?? false}
          library={library}
          projects={projects}
          onClose={() => setSheet(false)}
          created={(i) => {
            setSheet(false);
            open(i.id);
            setToast(
              i.state === "queued"
                ? "Investigation queued"
                : "Investigation created",
            );
          }}
          report={report}
        />
      )}
      {palette && (
        <Modal title="Command palette" onClose={() => setPalette(false)}>
          <div className="command-search">
            <Search size={16} />
            <input
              autoFocus
              aria-label="Search commands"
              placeholder="Search investigations or jump to a screen…"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </div>
          <div className="command-results">
            {[...screens, "New investigation"]
              .filter((s) => s.toLowerCase().includes(command.toLowerCase()))
              .map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    if (s === "New investigation") {
                      setPalette(false);
                      setSheet(true);
                    } else go(s);
                  }}
                >
                  {s}
                  <ArrowRight size={14} />
                </button>
              ))}
            <VirtualList
              label="Investigation commands"
              height={280}
              rowHeight={46}
              items={items.filter((i) =>
                `${i.id} ${i.name} ${i.question}`
                  .toLowerCase()
                  .includes(command.toLowerCase()),
              )}
              render={(i) => (
                <button onClick={() => open(i.id)}>
                  {i.name}
                  <small>{i.id}</small>
                </button>
              )}
            />
          </div>
          <div className="command-footer">
            G then B / I / N / S · Jump to a screen · Esc to close
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
function InboxDetail({
  item,
  open,
  report,
  toast,
}: {
  item: InboxItem;
  open: (id: string) => void;
  report: (e: unknown) => void;
  toast: (s: string) => void;
}) {
  const [note, setNote] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="inbox-detail">
      <div className="detail-meta">
        {item.kind} · {item.investigationId}
      </div>
      <h2>{item.title}</h2>
      <p>{item.reason}</p>
      <div className="review-record">
        <h3>Owner decision</h3>
        <p className="muted">
          Your response is recorded in the investigation ledger.
        </p>
        {item.kind === "model-chain-exhausted" && (
          <label className="field">
            Replacement model ID
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="provider/model"
            />
          </label>
        )}
        <label className="field">
          Review note
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add context for this decision"
          />
        </label>
      </div>
      <div className="button-group">
        {item.actions.map((a) => (
          <button
            className="button"
            key={a}
            disabled={busy}
            onClick={async () => {
              if (a === "open-paper") {
                open(item.investigationId);
                return;
              }
              setBusy(true);
              try {
                await rpc.call("inbox.act", {
                  id: item.id,
                  action: a,
                  note,
                  model,
                });
                toast("Decision recorded");
              } catch (e) {
                report(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {a.replaceAll("-", " ")}
          </button>
        ))}
      </div>
      <div className="ledger-note">
        <Lock size={14} />
        Owner actions pass through engine gates. Studio cannot assign or change
        claim labels.
      </div>
      <button className="text-link" onClick={() => open(item.investigationId)}>
        Open investigation →
      </button>
    </section>
  );
}
