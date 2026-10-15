import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { rpc, storeKey, pickFiles, enableNotifications } from "./rpc";
import {
  roles,
  type ProviderConfig,
  type Settings,
  type Status,
  type ChainEntry,
} from "./types";
import { Empty, Field, Modal } from "./components";
const providerNames: Record<string, string> = {
  codex: "Codex CLI",
  claude: "Claude Code CLI",
  openrouter: "OpenRouter",
  opencode: "OpenCode",
  anthropic: "Anthropic API",
  openai: "OpenAI API",
};
export function SettingsPage({
  settings,
  setSettings,
  status,
  report,
  toast,
  refreshStatus,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
  status: Status;
  refreshStatus: () => Promise<void>;
  report: (e: unknown) => void;
  toast: (s: string) => void;
}) {
  const [launcherHelp, setLauncherHelp] = useState(false);
  const [refreshingLauncher, setRefreshingLauncher] = useState(false);
  const [tab, setTab] = useState("Models");
  const [configError, setConfigError] = useState("");
  const [config, setConfig] = useState<ProviderConfig>();
  const [draft, setDraft] = useState(settings);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [validating, setValidating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [role, setRole] = useState<(typeof roles)[number]>("worker");
  const [busy, setBusy] = useState(false);
  const [licences, setLicences] = useState<string>();
  const drag = useRef<number | undefined>(undefined);
  const version = useRef(0);
  useEffect(() => {
    rpc
      .call<ProviderConfig & { warnings?: string[] }>("providers.get")
      .then((c) => {
        const { warnings, ...editable } = c;
        setWarnings(warnings ?? []);
        setConfig({
          ...editable,
          providers: {
            openrouter: {
              kind: "openrouter",
              enabled: false,
              keyRef: "keychain:amani/openrouter",
            },
            anthropic: {
              kind: "anthropic-api",
              enabled: false,
              keyRef: "keychain:amani/anthropic",
            },
            openai: {
              kind: "openai-api",
              enabled: false,
              keyRef: "keychain:amani/openai",
            },
            opencode: {
              kind: "opencode",
              enabled: false,
              opencodeProvider: "openrouter",
              keyRef: "keychain:amani/opencode-openrouter",
            },
            ...editable.providers,
          },
        });
        for (const id of Object.keys(c.providers))
          rpc
            .call<string[]>("providers.models", { providerId: id })
            .then((m) => setModels((old) => ({ ...old, [id]: m })))
            .catch(report);
      })
      .catch((e) => {
        setConfigError(String(e.message ?? e));
        report(e);
      });
  }, [report]);
  useEffect(() => {
    if (!config || !dirty) return;
    const v = ++version.current;
    setValidating(true);
    const t = setTimeout(() => {
      rpc
        .call<{ ok: boolean; errors: string[]; warnings?: string[] }>(
          "providers.set",
          {
            config,
            validateOnly: true,
          },
        )
        .then((r) => {
          if (v === version.current) {
            setErrors(r.errors);
            setWarnings(r.warnings ?? []);
            setValidating(false);
          }
        })
        .catch((e) => {
          if (v === version.current) {
            report(e);
            setValidating(false);
          }
        });
    }, 250);
    return () => clearTimeout(t);
  }, [config, dirty, report]);
  const edit = (fn: (c: ProviderConfig) => void) => {
    if (!config) return;
    const c = structuredClone(config);
    fn(c);
    setDirty(true);
    setConfig(c);
  };
  const chainEdit = (index: number, key: keyof ChainEntry, value: string) =>
    edit((c) => {
      c.roles[role].chain[index][key] = value;
    });
  const reorder = (from: number, to: number) =>
    edit((c) => {
      const chain = c.roles[role].chain;
      if (to < 0 || to >= chain.length) return;
      chain.splice(to, 0, chain.splice(from, 1)[0]);
    });
  return (
    <div className="page settings-page">
      {licences !== undefined && (
        <Modal
          title="Dependency licences"
          onClose={() => setLicences(undefined)}
        >
          <pre className="licence-text">{licences}</pre>
        </Modal>
      )}
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="head-sub">Local workspace · This machine</p>
        </div>
        <button
          className="button primary"
          disabled={
            busy || validating || (tab === "Models" && errors.length > 0)
          }
          onClick={async () => {
            setBusy(true);
            try {
              if (tab === "Models") {
                const r = await rpc.call<{
                  ok: boolean;
                  errors: string[];
                  warnings?: string[];
                }>("providers.set", { config });
                setErrors(r.errors);
                setWarnings(r.warnings ?? []);
                if (!r.ok) return;
                setDirty(false);
              } else {
                const s = await rpc.call<Settings>("settings.set", {
                  settings: draft,
                });
                setSettings(s);
              }
              toast("Settings saved");
            } catch (e) {
              report(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save changes
        </button>
      </div>
      <div className="settings-tabs">
        {["Models", "Workspace", "About"].map((t) => (
          <button
            className={tab === t ? "selected" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Models" ? (
        config ? (
          <>
            <div className="settings-grid models-grid">
              <section className="settings-card">
                <h2>
                  <KeyRound size={15} />
                  Providers
                </h2>
                <p className="settings-note">
                  Subscription CLIs use their existing sign-in. API keys stay in
                  macOS Keychain.
                </p>
                {Object.entries(config.providers).map(([id, p]) => (
                  <div className="provider-row" key={id}>
                    <div className="settings-row">
                      <label className="check-label">
                        <input
                          aria-label={`Enable ${providerNames[id] ?? id}`}
                          type="checkbox"
                          checked={p.enabled}
                          onChange={(e) =>
                            edit((c) => {
                              c.providers[id].enabled = e.target.checked;
                            })
                          }
                        />
                        <strong>{providerNames[id] ?? id}</strong>
                      </label>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const r = await rpc.call<{
                              outcome: string;
                              message: string;
                            }>("providers.test", {
                              providerId: id,
                              model:
                                Object.values(config.roles)
                                  .flatMap((r) => r.chain)
                                  .find((c) => c.provider === id)?.model ??
                                models[id]?.[0],
                            });
                            setTests((old) => ({
                              ...old,
                              [id]: `${r.outcome} · ${r.message}`,
                            }));
                          } catch (e) {
                            report(e);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Test {providerNames[id] ?? id}
                      </button>
                    </div>
                    {["codex", "claude"].includes(id) ? (
                      <small className="muted">
                        Subscription · status checked by engine
                      </small>
                    ) : (
                      <>
                        <KeyEntry
                          account={
                            p.keyRef?.replace("keychain:amani/", "") ?? id
                          }
                          name={providerNames[id] ?? id}
                          report={report}
                          toast={toast}
                        />
                        {id === "opencode" && (
                          <label className="inline-field">
                            OpenCode provider
                            <select
                              value={p.opencodeProvider}
                              onChange={(e) =>
                                edit((c) => {
                                  c.providers[id].opencodeProvider =
                                    e.target.value;
                                  c.providers[id].keyRef =
                                    `keychain:amani/opencode-${e.target.value}`;
                                })
                              }
                            >
                              {[
                                "openrouter",
                                "anthropic",
                                "openai",
                                "google",
                                "local",
                              ].map((p) => (
                                <option key={p}>{p}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        {id !== "opencode" && (
                          <label className="inline-field">
                            Base URL
                            <input
                              aria-label={`${providerNames[id] ?? id} base URL`}
                              value={p.baseUrl ?? ""}
                              placeholder="Provider default"
                              onChange={(e) =>
                                edit((c) => {
                                  c.providers[id].baseUrl = e.target.value;
                                })
                              }
                            />
                          </label>
                        )}
                      </>
                    )}
                    {tests[id] && (
                      <p className="test-outcome" role="status">
                        {tests[id]}
                      </p>
                    )}
                  </div>
                ))}
              </section>
              <div>
                <section className="settings-card">
                  <h2>Role model chains</h2>
                  <p className="settings-note">
                    First model is primary. Drag or use arrows to reorder
                    fallbacks. Any model ID is accepted.
                  </p>
                  <div className="role-tabs">
                    {roles.map((r) => (
                      <button
                        key={r}
                        className={role === r ? "selected" : ""}
                        onClick={() => setRole(r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {config.roles[role].chain.map((c, i) => (
                    <div
                      className="chain-entry"
                      draggable
                      key={`${role}-${i}`}
                      onDragStart={() => {
                        drag.current = i;
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (drag.current !== undefined)
                          reorder(drag.current, i);
                        drag.current = undefined;
                      }}
                    >
                      <div className="chain-heading">
                        <GripVertical size={13} />
                        <strong>
                          {i === 0 ? "Primary model" : `Fallback ${i}`}
                        </strong>
                        <div className="button-group">
                          <button
                            aria-label={`Move model ${i + 1} up`}
                            disabled={i === 0}
                            onClick={() => reorder(i, i - 1)}
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            aria-label={`Move model ${i + 1} down`}
                            disabled={i === config.roles[role].chain.length - 1}
                            onClick={() => reorder(i, i + 1)}
                          >
                            <ArrowDown size={12} />
                          </button>
                          <button
                            aria-label={`Remove model ${i + 1}`}
                            onClick={() =>
                              edit((d) => {
                                d.roles[role].chain.splice(i, 1);
                              })
                            }
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="chain-fields">
                        <Field label="Provider">
                          <select
                            aria-label={`${role} provider ${i + 1}`}
                            value={c.provider}
                            onChange={(e) =>
                              chainEdit(i, "provider", e.target.value)
                            }
                          >
                            {Object.keys(config.providers).map((p) => (
                              <option value={p} key={p}>
                                {providerNames[p] ?? p}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Model ID">
                          <input
                            aria-label={`${role} model ${i + 1}`}
                            list={`models-${c.provider}`}
                            value={c.model}
                            onChange={(e) =>
                              chainEdit(i, "model", e.target.value)
                            }
                          />
                        </Field>
                        <Field label="Effort">
                          <select
                            aria-label={`${role} effort ${i + 1}`}
                            value={c.effort ?? ""}
                            onChange={(e) =>
                              e.target.value
                                ? chainEdit(i, "effort", e.target.value)
                                : edit((c) => {
                                    delete c.roles[role].chain[i].effort;
                                  })
                            }
                          >
                            {["", "low", "medium", "high", "xhigh", "max"].map(
                              (e) => (
                                <option key={e} value={e}>
                                  {e || "Default"}
                                </option>
                              ),
                            )}
                          </select>
                        </Field>
                      </div>
                    </div>
                  ))}
                  <button
                    className="button"
                    onClick={() =>
                      edit((c) => {
                        const provider =
                          c.roles[role].chain[0]?.provider ??
                          Object.keys(c.providers).find(
                            (id) => c.providers[id].enabled,
                          ) ??
                          Object.keys(c.providers)[0];
                        c.roles[role].chain.push({
                          provider,
                          model: models[provider]?.[0] ?? "",
                        });
                      })
                    }
                  >
                    <Plus size={12} />
                    Add fallback
                  </button>
                  {Object.entries(models).map(([id, list]) => (
                    <datalist key={id} id={`models-${id}`}>
                      {list.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </datalist>
                  ))}
                  <div
                    className={`validation ${errors.length ? "invalid" : ""}`}
                    role="status"
                  >
                    {validating
                      ? "Validating with engine…"
                      : errors.length
                        ? errors.map((e) => <p key={e}>{e}</p>)
                        : "Provider configuration valid"}
                  </div>
                </section>
                {warnings.length > 0 && (
                  <div className="validation" role="status">
                    {warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </div>
                )}
                <section className="settings-card">
                  <h2>Failure policy</h2>
                  <div className="settings-row">
                    <label htmlFor="cross">Cross-family rule</label>
                    <select
                      id="cross"
                      value={config.policy.crossFamily}
                      onChange={(e) =>
                        edit((c) => {
                          c.policy.crossFamily = e.target.value;
                        })
                      }
                    >
                      <option value="require">Require</option>
                      <option value="prefer">Prefer</option>
                      <option value="off">Off</option>
                    </select>
                  </div>
                  {(
                    [
                      "retry",
                      "stallMinutes",
                      "repairNudges",
                      "callTimeoutMinutes",
                    ] as const
                  ).map((k) => (
                    <div className="settings-row" key={k}>
                      <label htmlFor={k}>
                        {
                          {
                            retry: "Maximum attempts",
                            stallMinutes: "Stall threshold · minutes",
                            repairNudges: "Repair nudges",
                            callTimeoutMinutes: "Call timeout · minutes",
                          }[k]
                        }
                      </label>
                      <input
                        id={k}
                        type="number"
                        min={k === "repairNudges" ? 0 : 1}
                        max={k === "retry" ? 10 : 240}
                        value={
                          k === "retry"
                            ? config.policy.retry.maxAttempts
                            : config.policy[k]
                        }
                        onChange={(e) =>
                          edit((c) => {
                            if (k === "retry")
                              c.policy.retry.maxAttempts = Number(
                                e.target.value,
                              );
                            else c.policy[k] = Number(e.target.value);
                          })
                        }
                      />
                    </div>
                  ))}
                  <div className="settings-row">
                    <label htmlFor="all-failed">When all models fail</label>
                    <select
                      id="all-failed"
                      value={config.policy.onAllFailed}
                      onChange={(e) =>
                        edit((c) => {
                          c.policy.onAllFailed = e.target.value;
                        })
                      }
                    >
                      <option value="needs-you">Pause in Needs you</option>
                    </select>
                  </div>
                  <p className="settings-note">
                    Refusals are recorded verbatim. Studio never rewrites
                    requests to bypass a refusal.
                  </p>
                </section>
              </div>
            </div>
          </>
        ) : (
          <Empty>
            {configError ? (
              <>
                <p role="alert">{configError}</p>
                <button
                  className="button"
                  onClick={() =>
                    rpc
                      .call<ProviderConfig>("providers.defaults")
                      .then((c) => {
                        setConfig(c);
                        setDirty(true);
                        setConfigError("");
                      })
                      .catch(report)
                  }
                >
                  Load defaults for repair
                </button>
                <p>
                  Review the defaults, then Save changes to replace the invalid
                  configuration.
                </p>
              </>
            ) : (
              "Loading provider configuration…"
            )}
          </Empty>
        )
      ) : tab === "Workspace" ? (
        <div className="settings-grid">
          <div>
            <section className="settings-card">
              <h2>Concurrency and compute</h2>
              {(["concurrency", "cpuCores", "memoryGB"] as const).map((k) => (
                <div className="settings-row" key={k}>
                  <label htmlFor={k}>
                    {
                      {
                        concurrency: "Concurrent run limit",
                        cpuCores: "CPU cores",
                        memoryGB: "Memory limit · GB",
                      }[k]
                    }
                  </label>
                  <input
                    id={k}
                    type="number"
                    min="0"
                    disabled={!status.fixture}
                    value={draft[k]}
                    onChange={(e) =>
                      setDraft({ ...draft, [k]: Number(e.target.value) })
                    }
                  />
                </div>
              ))}
              <p className="settings-note">
                {status.active} active · {status.queued} queued. Engine
                scheduling controls resource admission. Zero means automatic;
                compute limits are read-only for this engine.
              </p>
            </section>
            <section className="settings-card">
              <h2>Data folders</h2>
              {draft.dataFolders.map((p) => (
                <div className="settings-row" key={p}>
                  <span className="folder-path">{p}</span>
                  <button
                    onClick={() =>
                      setDraft({
                        ...draft,
                        dataFolders: draft.dataFolders.filter((f) => f !== p),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <Field label="Add folder path">
                <input
                  placeholder="/path/to/research/data"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.currentTarget.value.trim()) {
                      e.preventDefault();
                      setDraft({
                        ...draft,
                        dataFolders: [
                          ...draft.dataFolders,
                          e.currentTarget.value.trim(),
                        ],
                      });
                      e.currentTarget.value = "";
                    }
                  }}
                />
              </Field>
              <button
                className="button"
                onClick={async () => {
                  try {
                    const paths = await pickFiles(true);
                    setDraft({
                      ...draft,
                      dataFolders: [
                        ...new Set([...draft.dataFolders, ...paths]),
                      ],
                    });
                  } catch (e) {
                    report(e);
                  }
                }}
              >
                Choose folder
              </button>
              <p className="settings-note">
                Press Enter to add a typed path. Save changes to apply.
              </p>
            </section>
            <section className="settings-card">
              <h2>Appearance</h2>
              <Field label="Color theme">
                <select
                  value={draft.theme}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      theme: e.target.value as Settings["theme"],
                    })
                  }
                >
                  {["light", "dark", "system"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
            </section>
          </div>
          <div>
            <section className="settings-card">
              <h2>Notifications</h2>
              {(["needsYou", "done"] as const).map((k) => (
                <label className="settings-row" key={k}>
                  {k === "needsYou"
                    ? "A run needs attention"
                    : "A run is complete"}
                  <input
                    type="checkbox"
                    checked={draft.notifications[k]}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        notifications: {
                          ...draft.notifications,
                          [k]: e.target.checked,
                        },
                      });
                      if (e.target.checked) enableNotifications().catch(report);
                    }}
                  />
                </label>
              ))}
              <button
                className="button"
                onClick={() =>
                  enableNotifications()
                    .then(() => toast("Notification permission checked"))
                    .catch(report)
                }
              >
                Enable macOS notifications
              </button>
            </section>
            <section className="settings-card">
              <h2>Author identity</h2>
              <Field label="Name">
                <input
                  value={draft.author.name}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      author: { ...draft.author, name: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="ORCID">
                <input
                  placeholder="0000-0000-0000-0000"
                  value={draft.author.orcid}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      author: { ...draft.author, orcid: e.target.value },
                    })
                  }
                />
              </Field>
            </section>
            <section className="settings-card">
              <h2>
                <ShieldCheck size={14} />
                Certification launcher
              </h2>
              {Object.entries(status.launcher)
                .filter(([k]) => k !== "reason")
                .map(([k, v]) => (
                  <div className="settings-row" key={k}>
                    <span>
                      {
                        (
                          {
                            state: "Status",
                            separation: "Account separation",
                            analystAccess: "Analyst access",
                            lastCheck: "Last check",
                          } as Record<string, string>
                        )[k]
                      }
                    </span>
                    <span>
                      {k === "lastCheck" ? new Date(v).toLocaleString() : v}
                    </span>
                  </div>
                ))}
              <p className="settings-note">
                Read-only status from the engine. Studio cannot award labels.
              </p>
              <p>{status.launcher.reason}</p>
              <button className="button" onClick={() => setLauncherHelp(true)}>
                Install or repair launcher
              </button>
              <button
                className="button"
                disabled={refreshingLauncher}
                onClick={async () => {
                  setRefreshingLauncher(true);
                  try {
                    await refreshStatus();
                  } catch (e) {
                    report(e);
                  } finally {
                    setRefreshingLauncher(false);
                  }
                }}
              >
                Refresh launcher status
              </button>
              {launcherHelp && (
                <Modal
                  title="Install or repair certification launcher"
                  onClose={() => setLauncherHelp(false)}
                >
                  <p>
                    Studio never runs installation commands. The owner installs
                    the verified release from a separate administrator account,
                    following packages/omb-launcher/BUILD-NOTES.md (owner
                    installation procedure).
                  </p>
                  <p>
                    After verifying the release manifest and installer hashes
                    and staging the installers in a root-owned directory, the
                    documented install command is:
                  </p>
                  <pre className="engine-report">
                    /usr/bin/sudo /bin/sh
                    &lt;root-owned-temp&gt;/install-launcher.sh
                    &lt;absolute-staging-dir&gt;
                    &lt;root-owned-temp&gt;/MANIFEST &lt;manifest-sha256&gt;
                  </pre>
                  <p>
                    Use the paths and current hashes from the verified release.
                    The installer creates _ombcert, cert-launch and
                    /etc/sudoers.d/omb-launcher. Then choose Refresh launcher
                    status. An incomplete installation remains Not installed; a
                    refused attestation remains degraded.
                  </p>
                </Modal>
              )}
            </section>
          </div>
        </div>
      ) : (
        <div className="settings-card about">
          <h2>Amani Studio 0.1.0</h2>
          <p>Desktop research workspace · Tauri 2 · React · Node 24</p>
          <p>{status.engine}</p>
          <h3>Licence</h3>
          <p>
            Studio source: MIT. Runtime dependencies use permissive licences.
            The full dependency inventory and notices are bundled in
            THIRD-PARTY-LICENSES.txt.
          </p>
          <button
            className="text-link"
            onClick={() =>
              fetch("/THIRD-PARTY-LICENSES.txt")
                .then((r) => r.text())
                .then(setLicences)
                .catch(report)
            }
          >
            View dependency licences
          </button>
          <h3>Engine connection</h3>
          <p>
            {status.fixture
              ? "Synthetic fixture engine. No research, provider authentication or certification is performed."
              : "Production engine connected."}
          </p>
          <p>Keys are stored in the macOS Keychain under service “amani”.</p>
          <h3>Keyboard shortcuts</h3>
          <p>
            ⌘K · commands / N · new investigation / J and K · move in lists / G
            then B, I, N, S · navigation
          </p>
        </div>
      )}
    </div>
  );
}
function KeyEntry({
  account,
  name,
  report,
  toast,
}: {
  account: string;
  name: string;
  report: (e: unknown) => void;
  toast: (s: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="key-group">
      <input
        key={account}
        ref={input}
        type="password"
        aria-label={`${name} API key`}
        placeholder="API key → Keychain"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          const value = input.current?.value ?? "";
          if (!value) return;
          setBusy(true);
          try {
            await storeKey(account, value);
            toast(`${name} key saved in Keychain`);
          } catch (e) {
            report(e);
          } finally {
            if (input.current) input.current.value = "";
            setBusy(false);
          }
        }}
      >
        Save key
      </button>
    </div>
  );
}
