import { devPath } from "./triage-stage1.ts";
// Code bundles: what software executes. A bundle holds exactly the explicit code inventory
// (code/, run_all.sh, run_primary.sh, as omb-certify's freezeCode) plus the software-owned locked
// plan.json. Everything else in the worker's directory is discarded, in particular outputs/ and
// results.json computed on scrambled data: they never reach the look, the certifier or a report.

import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { assertSourcePolicy, CodePolicyError, type RefusalRecord } from "../../omb-certify/src/source-policy.ts";
import { validateSource } from "../../omb-certify/src/execution.ts";
import { sha256Canonical } from "../../bio-core/src/index.ts";

const CODE_ENTRIES = ["code", "run_all.sh", "run_primary.sh"] as const;
const MAX_FILES = 128, MAX_BYTES = 1_000_000;

export const fileSha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

/** name -> sha256 for every regular file under dir (symlinks refused). */
export function treeHashes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    const abs = path.join(dir, rel);
    for (const name of readdirSync(abs).sort()) {
      const r = rel ? `${rel}/${name}` : name, file = path.join(dir, r), st = lstatSync(file);
      if (st.isSymbolicLink()) throw new Error(`linked file refused in bundle: ${r}`);
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) out[r] = fileSha256(file);
    }
  };
  walk("");
  return out;
}

export const treeHash = (dir: string): string => sha256Canonical(treeHashes(dir));

export interface Bundle {
  dir: string;
  hash: string;
  /** Relative paths dropped from the worker directory, including nested dev-only files. */
  discarded: string[];
  /** The worker's plan.json differed from the locked plan (the locked plan is used). */
  planRestored: boolean;
  missing: string[];
}

/** Copy the explicit code inventory plus the locked plan into a fresh host directory. */
export function snapshotBundle(workdir: string, dest: string, lockedPlan: string, samePlan?: (workerText: string | null, lockedText: string) => boolean, options: { keepDevFiles?: boolean } = {}): Bundle {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const missing: string[] = [], dropped: string[] = [];
  for (const entry of CODE_ENTRIES) {
    const source = path.join(workdir, entry);
    let st;
    try { st = lstatSync(source); } catch { missing.push(entry); continue; }
    if (st.isSymbolicLink()) throw new CodePolicyError(entry,"linked code refused");
    cpSync(source, path.join(dest, entry), { recursive: true, dereference: false, filter(file) {
      const rel = path.relative(workdir, file).split(path.sep).join("/"), name = path.basename(file);
      if (!options.keepDevFiles && devPath(rel)) {
        dropped.push(rel); return false;
      }
      const info = lstatSync(file);
      if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) throw new CodePolicyError(rel, "linked or non-regular source refused");
      return true;
    } });
  }
  const files = treeHashes(dest);
  let total = 0;
  for (const name of Object.keys(files)) total += lstatSync(path.join(dest, name)).size;
  if (Object.keys(files).length > MAX_FILES || total > MAX_BYTES) throw new CodePolicyError("code/", "code inventory size cap exceeded");
  const failures:CodePolicyError[]=[];
  // Triage copies are quarantined candidates: executor freeze revalidates after exact dev-file removal.
  for(const name of options.keepDevFiles?[]:Object.keys(files))try{const file=path.join(dest,name);validateSource(file,name);assertSourcePolicy(name,readFileSync(file,'utf8'));}catch(e){if(e instanceof CodePolicyError && e.refusal.decision==='denied')failures.push(e);else throw e;}
  if(failures.length)throw new CodePolicyError(failures[0]!.refusal.location.path??'code/',failures.map(e=>e.message).join('\n'),failures[0]!.refusal.location.line??undefined);
  copyFileSync(lockedPlan, path.join(dest, "plan.json"));
  const workerPlan = path.join(workdir, "plan.json");
  const planRestored = samePlan
    ? !samePlan(existsSync(workerPlan) ? readFileSync(workerPlan, "utf8") : null, readFileSync(lockedPlan, "utf8"))
    : !existsSync(workerPlan) || fileSha256(workerPlan) !== fileSha256(lockedPlan);
  let entries: string[] = [];
  try { entries = readdirSync(workdir).sort(); } catch { entries = []; }
  const discarded = [...dropped, ...entries.filter((e) => !(CODE_ENTRIES as readonly string[]).includes(e) && e !== "plan.json")].sort();
  return { dir: dest, hash: treeHash(dest), discarded, planRestored, missing };
}

/** Freeze: copy a validated candidate into an immutable directory. The candidate must still hash to
 * what was validated (a change is a trusted-path change). */
export function freezeBundle(candidate: Bundle, dest: string): { dir: string; hash: string } {
  const now = treeHash(candidate.dir);
  if (now !== candidate.hash) throw new TrustedPathChanged("the validated code candidate changed on host disk before freeze");
  rmSync(dest, { recursive: true, force: true });
  cpSync(candidate.dir, dest, { recursive: true });
  const lock = (p: string): void => {
    const st = lstatSync(p);
    if (st.isDirectory()) { for (const n of readdirSync(p)) lock(path.join(p, n)); chmodSync(p, 0o500); }
    else chmodSync(p, 0o400);
  };
  lock(dest);
  const hash = treeHash(dest);
  if (hash !== candidate.hash) throw new TrustedPathChanged("frozen copy differs from the candidate");
  return { dir: dest, hash };
}

export class TrustedPathChanged extends Error {
  constructor(message: string) { super(message); this.name = "TrustedPathChanged"; }
}

/** Remove a host or worker directory we created, unlocking read-only trees first. */
export function removeTree(dir: string): void {
  if (!existsSync(dir)) return;
  const unlock = (p: string): void => {
    const st = lstatSync(p);
    if (st.isDirectory() && !st.isSymbolicLink()) { chmodSync(p, 0o700); for (const n of readdirSync(p)) unlock(path.join(p, n)); }
  };
  unlock(dir);
  rmSync(dir, { recursive: true, force: true });
}

/** Read a small text file, or null (missing, not regular, over cap). Never follows a final symlink. */
export function readSmall(file: string, cap = 1_000_000): string | null {
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > cap) return null;
    return readFileSync(file, "utf8");
  } catch { return null; }
}

/** Host-only transaction; worker code is never edited and every guard is rerun on a fresh copy. */
export type DropValidation = boolean | {repair:RefusalRecord};
export async function revalidateDevDrop(bundle:Bundle, paths:readonly string[], validate:(candidate:Bundle)=>Promise<DropValidation>):Promise<DropValidation> {
  const files=treeHashes(bundle.dir);
  if(treeHash(bundle.dir)!==bundle.hash || !paths.length || paths.some(p=>!devPath(p)||!(p in files))) return false;
  const trial=bundle.dir+".triage-trial", backup=bundle.dir+".triage-backup";
  removeTree(trial); cpSync(bundle.dir,trial,{recursive:true});
  try {
    for(const p of paths) rmSync(path.join(trial,p));
    const candidate={...bundle,dir:trial,hash:treeHash(trial)};
    const validation=await validate(candidate);
    if(!validation || (typeof validation==='object' && (validation.repair.decision==='guard-error'||!validation.repair.repairable))) return false;
    removeTree(backup);renameSync(bundle.dir,backup);
    try{renameSync(trial,bundle.dir);}catch(e){renameSync(backup,bundle.dir);throw e;}
    removeTree(backup);bundle.hash=candidate.hash;bundle.discarded=[...new Set([...bundle.discarded,...paths])];return validation;
  } finally { removeTree(trial); }
}

/** Inventory only the frozen scope; development outputs/data and transcripts never become evidence. */
export function sourceInventory(workdir:string):Record<string,string> {
  const out:Record<string,string>={};
  for(const entry of [...CODE_ENTRIES,'plan.json']){
    const file=path.join(workdir,entry);if(!existsSync(file))continue;
    const st=lstatSync(file);if(st.isSymbolicLink())throw new CodePolicyError(entry,'linked code refused');
    if(st.isDirectory()){for(const [rel,hash] of Object.entries(treeHashes(file)))out[`${entry}/${rel}`]=hash;}
    else if(st.isFile())out[entry]=fileSha256(file);
  }
  return out;
}
