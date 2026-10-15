import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  FileText,
  Lock,
  Pause,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Download,
} from "lucide-react";
import { rpc, downloadArtifact } from "./rpc";
import type { Answer, Detail, LedgerEntry } from "./types";
import { Empty, Modal, VirtualList } from "./components";
import { PdfPreview } from "./PdfPreview";
const tabs = ["Overview", "Data", "Plan", "Results", "Paper", "Activity"];
export function Workspace({
  id,
  revision,
  report: onError,
  toast: onToast,
  openInbox: onOpenInbox,
}: {
  id: string;
  revision: number;
  report: (e: unknown) => void;
  toast: (s: string) => void;
  openInbox: () => void;
}) {
  const scope = useRef({ id, alive: true, request: 0 });
  scope.current.id = id;
  useEffect(() => {
    scope.current.alive = true;
    return () => {
      scope.current.alive = false;
      scope.current.request++;
    };
  }, [id]);
  const report = useCallback(
    (e: unknown) => {
      if (scope.current.alive && scope.current.id === id) onError(e);
    },
    [id, onError],
  );
  const toast = (s: string) => {
    if (scope.current.alive && scope.current.id === id) onToast(s);
  };
  const openInbox = () => {
    if (scope.current.alive && scope.current.id === id) onOpenInbox();
  };
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [detail, setDetail] = useState<Detail>();
  const [tab, setTab] = useState("Overview");
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState<Answer>();
  const [busy, setBusy] = useState(false);
  const [repairReason, setRepairReason] = useState("");
  const [record, setRecord] = useState<LedgerEntry>();
  const [attempt, setAttempt] = useState("");
  const [cite, setCite] = useState("");
  const [amend, setAmend] = useState<string>();
  const [cancel, setCancel] = useState(false);
  const [checks, setChecks] = useState<boolean[]>([false, false, false]);
  useEffect(() => {
    setTab("Overview");
    setAnswer(undefined);
    setAttempt("");
    setQuestion("");
    setAsked("");
    setCite("");
    setChecks([false, false, false]);
    setDetail(undefined);
  }, [id]);
  useEffect(() => {
    let active = true;
    rpc
      .call<Detail>("investigations.get", { investigationId: id })
      .then((d) => {
        if (active && d.id === id) setDetail(d);
      })
      .catch((e) => {
        if (active) report(e);
      });
    return () => {
      active = false;
    };
  }, [id, revision, report]);
  useEffect(() => {
    let active = true;
    rpc
      .call<LedgerEntry[]>("ledger.tail", { investigationId: id })
      .then((l) => {
        if (active) setLedger(l.filter((e) => e.investigationId === id));
      })
      .catch((e) => {
        if (active) report(e);
      });
    const off = rpc.subscribe((e) => {
      if (
        e.method === "provider.attempt" &&
        e.params.investigationId === id &&
        e.params.outcome !== "ok"
      )
        setAttempt(e.params.message);
      if (
        ["ledger.entry", "model.attempt"].includes(e.method) &&
        e.params.entry?.investigationId === id
      )
        setLedger((old) =>
          old.some((x) => x.id === e.params.entry.id)
            ? old
            : [...old, e.params.entry],
        );
    });
    return () => {
      active = false;
      off();
      rpc
        .call("ledger.tail", { investigationId: id, unsubscribe: true })
        .catch(() => {});
    };
  }, [id, revision, report]);

  const action = async (a: string) => {
    setBusy(true);
    try {
      await rpc.call("investigations." + a, {
        investigationId: id,
        ...(a === "resume" && detail?.resumeToken
          ? { reason: repairReason, resumeToken: detail.resumeToken }
          : {}),
      });
      toast(
        `Investigation ${a === "pause" ? "pause requested; waiting for a safe boundary" : a === "resume" ? "resumed" : "cancellation requested"}`,
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
      setCancel(false);
    }
  };
  if (!detail || detail.id !== id) return <Empty>Loading investigation…</Empty>;
  const d = detail;
  const activity = [...ledger].sort((a, b) =>
    a.id === cite ? -1 : b.id === cite ? 1 : 0,
  );
  return (
    <div className="investigation-page">
      {record && (
        <Modal
          title={`Journal record ${record.id}`}
          onClose={() => setRecord(undefined)}
        >
          <pre tabIndex={0} className="engine-report">
            {record.payload ?? record.text}
          </pre>
        </Modal>
      )}
      {(attempt || d.providerNotice) && (
        <div className="validation" role="status">
          {d.providerNotice || attempt}
        </div>
      )}
      <header className="investigation-head">
        {d.resumeToken && (
          <label className="field">
            System repair reason
            <input
              value={repairReason}
              onChange={(e) => setRepairReason(e.target.value)}
              placeholder="Describe the concrete fix before resuming"
            />
          </label>
        )}
        <div className="page-head">
          <div>
            <div className="investigation-title">
              <h1>{d.name}</h1>
              <span className="record-id">{d.id}</span>
            </div>
            <p className="head-sub">{d.question}</p>
          </div>
          <div className="button-group">
            <span className="state-text">
              {d.stage} · {d.state}
            </span>
            <button
              className="button"
              disabled={
                busy || ["done", "cancelled", "pausing"].includes(d.state)
              }
              onClick={() =>
                void action(
                  ["paused", "needs-you", "queued"].includes(d.state)
                    ? "resume"
                    : "pause",
                )
              }
            >
              {["paused", "needs-you", "queued"].includes(d.state) ? (
                <Play size={13} />
              ) : (
                <Pause size={13} />
              )}{" "}
              {["paused", "needs-you", "queued"].includes(d.state)
                ? "Resume"
                : "Pause"}
            </button>
            <button
              className="button"
              disabled={
                busy || ["done", "cancelled", "pausing"].includes(d.state)
              }
              onClick={() => setCancel(true)}
            >
              Cancel
            </button>
          </div>
        </div>
      </header>
      <div
        className="tabbar"
        role="tablist"
        aria-label="Investigation sections"
      >
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            aria-controls={`panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            onKeyDown={(e) => {
              const index = tabs.indexOf(t);
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? tabs.length - 1
                    : e.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : e.key === "ArrowLeft"
                        ? (index + tabs.length - 1) % tabs.length
                        : -1;
              if (next < 0) return;
              e.preventDefault();
              setTab(tabs[next]);
              document.getElementById(`tab-${tabs[next]}`)?.focus();
            }}
            aria-selected={tab === t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <span className="tab-right">
          <Lock size={13} />
          Engine-owned records
        </span>
      </div>
      {tabs
        .filter((t) => t !== tab)
        .map((t) => (
          <section
            key={t}
            id={`panel-${t}`}
            role="tabpanel"
            aria-labelledby={`tab-${t}`}
            hidden
          />
        ))}
      <div
        className={`investigation-layout ${tab === "Paper" ? "paper-open" : ""}`}
      >
        <section
          className="investigation-main"
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
        >
          {tab === "Overview" && (
            <>
              <div className="metrics">
                {d.metrics.map((m) => (
                  <div className="metric" key={m.label}>
                    <strong>{m.value}</strong>
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>
              <div className="overview-grid">
                <div>
                  <div className="section-heading">
                    <h2>Run overview</h2>
                    <span>Recorded stages</span>
                  </div>
                  <ol className="timeline">
                    {d.plan.map((p, i) => (
                      <li key={p.title}>
                        <span className="step-icon">
                          <Check size={12} />
                        </span>
                        <div>
                          <h3>{p.title}</h3>
                          <p tabIndex={0}>{p.text}</p>
                          {i === 1 && (
                            <div className="boundary">
                              <Lock size={10} />
                              Sealed confirmation boundary
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                    <li>
                      <span className="step-icon">
                        <FileText size={12} />
                      </span>
                      <div>
                        <h3>{d.stage}</h3>
                        <p>{d.next}</p>
                      </div>
                    </li>
                  </ol>
                </div>
                <div>
                  {d.certificate ? (
                    <div className="record-card">
                      <div className="record-top">
                        Evidence certificate <ShieldCheck size={24} />
                      </div>
                      <h3>{d.certificate.id}</h3>
                      <p>{d.certificate.scope}</p>
                      <div className="record-row">
                        <span>Plan fingerprint</span>
                        {d.certificate.fingerprint}
                      </div>
                      {d.results.map((r) => (
                        <div className="record-row" key={r.id}>
                          <span>{r.id}</span>
                          {r.label}
                        </div>
                      ))}
                      <button
                        className="text-link"
                        onClick={() => setTab("Results")}
                      >
                        Inspect claims & checks →
                      </button>
                    </div>
                  ) : (
                    <div className="settings-card">
                      <h3>Certification pending</h3>
                      <p>
                        Labels appear when the engine commits the certification
                        record.
                      </p>
                    </div>
                  )}
                  <div className="review-callout">
                    <h3>Author review</h3>
                    <p>
                      Review evidence limits, sources and model use before
                      endorsing a draft.
                    </p>
                    <button
                      className="text-link"
                      onClick={() => setTab("Paper")}
                    >
                      Review paper →
                    </button>
                  </div>
                </div>
              </div>
              <div className="recent">
                <div className="section-heading">
                  <h2>Recent activity</h2>
                  <button
                    className="text-link"
                    onClick={() => setTab("Activity")}
                  >
                    View ledger →
                  </button>
                </div>
                {ledger
                  .slice(-3)
                  .reverse()
                  .map((e) => (
                    <div className="activity-mini" key={e.id}>
                      <time>
                        {new Date(e.time).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <span>{e.text}</span>
                      <button
                        className="text-link"
                        onClick={() => {
                          setCite(e.id);
                          setTab("Activity");
                        }}
                      >
                        {e.id.split("-").pop()} ↗
                      </button>
                    </div>
                  ))}
              </div>
            </>
          )}
          {tab === "Data" && (
            <>
              <div className="section-heading">
                <h2>Data contract</h2>
                <span>{d.data.length} files</span>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Rows</th>
                    <th>Purpose</th>
                    <th>Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {d.data.map((f) => (
                    <tr key={f.id}>
                      <td>{f.name}</td>
                      <td>{f.rows ?? "Not counted"}</td>
                      <td>{f.purpose}</td>
                      <td>{f.contract}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ledger-note">
                <Lock size={14} />
                Confirmation data access is controlled by the engine and
                certification launcher.
              </div>
            </>
          )}
          {tab === "Plan" && (
            <>
              <h2>Locked plan</h2>
              {d.plan.map((p) => (
                <article className="plan-block" key={p.title}>
                  <h3>{p.title}</h3>
                  <p tabIndex={0}>{p.text}</p>
                </article>
              ))}
              <div className="ledger-note">
                <Lock size={14} />
                Changing the question requires an amendment review. Existing
                results remain unchanged.
              </div>
              <button className="button" onClick={() => setAmend("")}>
                Draft amendment request
              </button>
            </>
          )}
          {tab === "Results" && (
            <>
              <div className="section-heading">
                <h2>Claim records</h2>
                <span>Labels assigned by the referee</span>
              </div>
              {d.results.map((r) => (
                <article className="claim-detail" key={r.id}>
                  <div className="section-heading">
                    <span>{r.id}</span>
                    <strong
                      className={r.label === "Confirmed" ? "green" : "amber"}
                    >
                      {r.label}
                    </strong>
                  </div>
                  <h3>{r.title}</h3>
                  <div className="effect">
                    <strong>{r.effect}</strong>
                  </div>
                  <p className="muted">{r.interval}</p>
                  {r.checks.map((c) => (
                    <div className="check-row" key={c}>
                      <span>{c}</span>
                      <Check size={12} />
                    </div>
                  ))}
                </article>
              ))}
            </>
          )}
          {tab === "Activity" && (
            <>
              <div className="section-heading">
                <h2>Activity ledger</h2>
                <span>{ledger.length} entries · live</span>
              </div>
              {cite && (
                <div className="citation-note">
                  Showing cited entry first: {cite}
                  <button className="text-link" onClick={() => setCite("")}>
                    Clear
                  </button>
                </div>
              )}
              <VirtualList
                label="Ledger entries"
                height="calc(100vh - 300px)"
                rowHeight={115}
                items={activity}
                render={(e) => (
                  <article
                    id={e.id}
                    className={`ledger-entry ${cite === e.id ? "cited" : ""}`}
                  >
                    <time>
                      {new Date(e.time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <div>
                      <h3>{e.text}</h3>
                      <p>
                        {e.type}
                        {e.role &&
                          ` · ${e.role} · ${e.provider} · ${e.outcome} · ${e.decision}`}
                      </p>
                      <small>{e.id}</small>{" "}
                      {e.payload && (
                        <button
                          className="text-link"
                          onClick={() => setRecord(e)}
                        >
                          Inspect record
                        </button>
                      )}
                    </div>
                  </article>
                )}
              />
            </>
          )}
          {tab === "Paper" && (
            <div className="paper-layout">
              <div className="paper-stage">
                <div className="paper-toolbar">
                  <span>
                    {d.paper.pdf ? "Rendered manuscript" : "Engine report"}
                  </span>
                  <span>
                    {d.paper.pdf
                      ? d.paper.endorsed
                        ? "Endorsed"
                        : "Author review pending"
                      : d.paper.report
                        ? "Report available"
                        : "Not yet published"}
                  </span>
                </div>
                {d.paper.pdf ? (
                  <PdfPreview base64={d.paper.pdf} />
                ) : d.paper.report ? (
                  <pre tabIndex={0} className="engine-report">
                    {d.paper.report}
                  </pre>
                ) : (
                  <Empty>
                    Rendered PDF not yet available.
                    <p>The engine will publish it when the draft is ready.</p>
                  </Empty>
                )}
                <p className="paper-note">
                  The preview is read from the engine’s verified output.
                </p>
              </div>
              <div className="review-panel">
                <h2>
                  {d.paper.pdf
                    ? "Author-review checklist"
                    : "Manuscript availability"}
                </h2>
                {d.paper.checklist.map((text, i) => (
                  <label className="review-flag" key={text}>
                    <input
                      type="checkbox"
                      checked={checks[i] ?? false}
                      onChange={(e) =>
                        setChecks((old) =>
                          old.map((v, n) => (n === i ? e.target.checked : v)),
                        )
                      }
                    />
                    <span>{text}</span>
                  </label>
                ))}
                <div className="disclosure">
                  <h3>Evidence & model use</h3>
                  <p>{d.paper.abstract}</p>
                </div>
                <h3>Downloads</h3>
                <div className="download-grid">
                  {d.paper.downloads.map((a) => (
                    <button
                      className="download"
                      key={a.kind}
                      disabled={false}
                      onClick={() => downloadArtifact(id, a.kind).catch(report)}
                    >
                      <Download size={13} />
                      {a.label}
                    </button>
                  ))}
                </div>
                <div className="signoff">
                  <button
                    className="button primary"
                    disabled={
                      !d.paper.pdf ||
                      d.paper.endorsed ||
                      !checks.every(Boolean) ||
                      busy
                    }
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await rpc.call("inbox.act", {
                          action: "endorse",
                          investigationId: id,
                          checklist: checks,
                        });
                        toast("Engine accepted the author endorsement");
                        setDetail(
                          await rpc.call("investigations.get", {
                            investigationId: id,
                          }),
                        );
                      } catch (e) {
                        report(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {d.paper.endorsed ? "Endorsed" : "Endorse draft"}
                  </button>
                  <p>
                    Only the engine’s owner gate can accept an endorsement.
                    Studio never endorses automatically.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
        {tab !== "Paper" && (
          <aside className="assistant">
            <div className="assistant-head">
              <Sparkles size={15} />
              <h2>Assistant</h2>
              <span>This investigation only</span>
            </div>
            <div className="assistant-content">
              <h3 className="assistant-title">Ask about this investigation</h3>
              <p className="assistant-context">
                {d.id} · {ledger.length} ledger entries
              </p>
              {asked && <div className="chat-question">{asked}</div>}
              {answer && answer.investigationId === id ? (
                <div className="assistant-answer">
                  <div className="chat-author">
                    <Sparkles size={13} />
                    Amani
                  </div>
                  <p>{answer.text}</p>
                  <div className="citations">
                    {answer.citations.map((c) => (
                      <button
                        className="cite"
                        key={c.entryId}
                        onClick={() => {
                          if (
                            !ledger.some(
                              (e) =>
                                e.id === c.entryId && e.investigationId === id,
                            )
                          )
                            return;
                          setCite(c.entryId);
                          setTab("Activity");
                        }}
                      >
                        <ArrowUpRight size={11} />
                        {c.label} · {c.entryId}
                      </button>
                    ))}
                  </div>
                  <button
                    className="button"
                    onClick={() => setAmend(answer.amendmentDraft)}
                  >
                    Draft amendment request
                  </button>
                </div>
              ) : (
                <p className="muted">
                  Ask about a claim, check, model attempt or recorded decision.
                  Answers link back to the ledger.
                </p>
              )}
              <div className="record-access">
                <Lock size={12} />
                Read-only access. The assistant cannot change results or labels.
              </div>
            </div>
            <form
              className="assistant-input"
              onSubmit={async (e) => {
                e.preventDefault();
                const requestId = `${id}:${++scope.current.request}`;
                const generation = scope.current.request;
                const current = () =>
                  scope.current.alive &&
                  scope.current.id === id &&
                  scope.current.request === generation;
                const submitted = question;
                setAssistantBusy(true);
                try {
                  const reply = await rpc.call<Answer>("assistant.ask", {
                    investigationId: id,
                    requestId,
                    question: submitted,
                  });
                  if (!current()) return;
                  if (
                    reply.investigationId !== id ||
                    reply.requestId !== requestId
                  )
                    throw Error(
                      "Assistant reply does not match this investigation/request. Try again.",
                    );
                  setAnswer(reply);
                  setAsked(submitted);
                  setQuestion("");
                } catch (e) {
                  if (current()) report(e);
                } finally {
                  if (current()) setAssistantBusy(false);
                }
              }}
            >
              <label className="sr-only" htmlFor="ask">
                Ask this investigation
              </label>
              <div className="ask-box">
                <textarea
                  id="ask"
                  placeholder="Ask about a claim, check or decision…"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
                <div className="ask-bottom">
                  <span>Answers link to recorded evidence</span>
                  <button
                    aria-label="Send question"
                    disabled={assistantBusy || !question.trim()}
                  >
                    <Send size={13} />
                  </button>
                </div>
              </div>
            </form>
          </aside>
        )}
      </div>
      {amend !== undefined && (
        <Modal
          title="Draft amendment request"
          onClose={() => setAmend(undefined)}
        >
          <div className="amend-content">
            <p>
              This sends a request to Needs you. It cannot change the current
              results or labels.
            </p>
            <label className="field">
              Requested amendment
              <textarea
                autoFocus
                value={amend}
                onChange={(e) => setAmend(e.target.value)}
              />
            </label>
            <button
              className="button primary"
              disabled={!amend.trim() || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await rpc.call("inbox.act", {
                    action: "draft-amendment",
                    investigationId: id,
                    note: amend,
                  });
                  setAmend(undefined);
                  openInbox();
                  toast("Amendment request sent to the inbox");
                } catch (e) {
                  report(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send to inbox
            </button>
          </div>
        </Modal>
      )}
      {cancel && (
        <Modal title="Cancel investigation" onClose={() => setCancel(false)}>
          <div className="amend-content">
            <p>
              Cancel {d.id}? This requests cancellation through the engine and
              retains its recorded history.
            </p>
            <div className="button-group">
              <button className="button" onClick={() => setCancel(false)}>
                Keep investigation
              </button>
              <button
                className="button danger"
                onClick={() => void action("cancel")}
              >
                Confirm cancellation
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
