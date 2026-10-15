import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { FileText, FolderOpen, Lock } from "lucide-react";
import { Modal, Field } from "./components";
import { rpc, pickFiles } from "./rpc";
import type { DataFile, Investigation } from "./types";
export function NewInvestigation({
  library,
  fixture = false,
  projects,
  onClose,
  created,
  report,
}: {
  library: DataFile[];
  fixture?: boolean;
  projects: string[];
  onClose: () => void;
  created: (i: Investigation) => void;
  report: (e: unknown) => void;
}) {
  const [question, setQuestion] = useState("");
  const [project, setProject] = useState(projects[0] ?? "");
  const [files, setFiles] = useState<DataFile[]>([]);
  const [contract, setContract] = useState<{
    ok: boolean;
    token: string;
    checks: { name: string; status: string; detail: string }[];
  }>();
  const [busy, setBusy] = useState(false);
  const change = (f: DataFile[]) => {
    setFiles(f);
    setContract(undefined);
  };
  return (
    <Modal title="New investigation" onClose={onClose} sheet>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            created(
              await rpc.call("investigations.create", {
                question,
                project,
                files,
                contractToken: contract?.token,
              }),
            );
          } catch (e) {
            report(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="sheet-body">
          <Field label="Research question">
            <textarea
              autoFocus
              required
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What question should this investigation answer?"
            />
          </Field>
          <Field label="Project">
            <input
              required
              aria-label="Project"
              list="projects"
              value={project}
              onChange={(e) => setProject(e.target.value)}
            />
            <datalist id="projects">
              {projects.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </datalist>
          </Field>
          <div className="section-heading">
            <h2>Data files</h2>
            {isTauri() ? (
              <button
                type="button"
                className="button"
                onClick={async () => {
                  try {
                    const paths = await pickFiles();
                    change([
                      ...files,
                      ...paths.map((path, i) => ({
                        id: `disk-${Date.now()}-${i}`,
                        path,
                        name: path.split("/").pop()!,
                        rows: 0,
                        purpose: "To be checked",
                        contract: "Pending",
                      })),
                    ]);
                  } catch (e) {
                    report(e);
                  }
                }}
              >
                <FolderOpen size={13} />
                From disk
              </button>
            ) : fixture ? (
              <label className="button">
                From disk
                <input
                  className="sr-only"
                  type="file"
                  multiple
                  accept=".csv,.tsv,.parquet"
                  onChange={(e) =>
                    change([
                      ...files,
                      ...Array.from(e.target.files ?? []).map((f, i) => ({
                        id: `web-${i}`,
                        name: f.name,
                        rows: 0,
                        purpose: "Browser file metadata (fixture)",
                        contract: "Pending",
                      })),
                    ])
                  }
                />
              </label>
            ) : (
              <span className="muted">
                Use the desktop picker or a configured data folder.
              </span>
            )}
          </div>
          <p className="muted">Choose files from the library or disk.</p>
          {library.map((f) => (
            <label className="file-row" key={f.id}>
              <input
                type="checkbox"
                checked={files.some((x) => x.id === f.id)}
                onChange={(e) =>
                  change(
                    e.target.checked
                      ? [...files, f]
                      : files.filter((x) => x.id !== f.id),
                  )
                }
              />
              <FileText size={18} />
              <span>
                <strong>{f.name}</strong>
                <small>
                  {f.rows} rows · {f.purpose}
                </small>
              </span>
            </label>
          ))}
          {files
            .filter((f) => !library.some((l) => l.id === f.id))
            .map((f) => (
              <div className="file-row" key={f.id}>
                <FileText size={18} />
                {f.name}
                <button
                  type="button"
                  onClick={() => change(files.filter((x) => x.id !== f.id))}
                >
                  Remove
                </button>
              </div>
            ))}
          <div className="sheet-contract">
            <div className="sheet-contract-head">
              <h2>Data-contract check</h2>
              <button
                type="button"
                className="button"
                disabled={busy || !files.length}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setContract(await rpc.call("data.check", { files }));
                  } catch (e) {
                    report(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Check contract
              </button>
            </div>
            {contract ? (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.checks.map((c) => (
                      <tr key={c.name}>
                        <td>
                          {c.name}
                          <small className="block muted">{c.detail}</small>
                        </td>
                        <td>{c.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="contract-explanation">
                Select files and check the contract before creating an
                investigation.
              </p>
            )}
          </div>
        </div>
        <div className="sheet-footer">
          <p>
            <Lock size={12} />
            When run slots are full, the engine queues this investigation.
          </p>
          <div className="button-group">
            <button className="button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={
                busy || !question.trim() || !project.trim() || !contract?.ok
              }
            >
              Create investigation
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
