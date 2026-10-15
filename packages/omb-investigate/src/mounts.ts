// What each kind of turn may see. The adapters mount only what the WorkerSpec lists (read-only)
// and deny everything else, so route P's two sandbox facts are set here, by software, before any
// dispatch: the plan turn sees the task and the schema view only; the code turn sees scrambled
// outcomes, never the real ones; nothing after a look sees anything but certified outputs. A mount
// outside the policy, or one that overlaps host-only state or real data, refuses the turn before it
// launches. After the plan turn (and every boss turn) software scans the worker's files for data
// canaries: values present in the real data and absent from everything the turn was shown.

import { lstatSync, readdirSync, openSync, readSync, closeSync, fstatSync, constants, createReadStream } from "node:fs";
import path from "node:path";
import {createGunzip} from "node:zlib";

export type MountRole =
  | "task" | "schema" | "scrambled" | "dev" | "synthetic" | "locked-plan" | "certified" | "digest" | "literature" | "runtime";

export type TurnKind =
  | "methods-validity" | "lateral-review" | "lateral-response" | "standby-review" | "plan" | "plan-repair" | "code" | "dry-run-repair" | "look-repair" | "replicate" | "interpret" | "boss" | "novelty";

export interface Mount { role: MountRole; path: string }

const P_POLICY: Readonly<Record<TurnKind, readonly MountRole[]>> = {
  "standby-review": [],
  "methods-validity": [],
  "lateral-review": ["schema"],
  "lateral-response": ["schema"],
  plan: ["task", "schema", "runtime"],
  "plan-repair": ["task", "schema", "runtime"],
  code: ["task", "schema", "scrambled", "runtime"],
  "dry-run-repair": ["task", "schema", "scrambled", "synthetic", "runtime"],
  "look-repair": ["task", "schema", "scrambled", "runtime"],
  replicate: ["locked-plan", "schema", "scrambled", "runtime"],
  interpret: ["certified", "runtime"],
  boss: ["digest", "schema"],
  novelty: ["literature"],
};

/** Route H explores the dev partition (real outcomes on dev units only) instead of scrambled data. */
const H_POLICY: Readonly<Record<TurnKind, readonly MountRole[]>> = {
  ...P_POLICY,
  plan: ["task", "schema", "dev", "runtime"],
  "plan-repair": ["task", "schema", "dev", "runtime"],
  code: ["task", "schema", "dev", "runtime"],
  "dry-run-repair": ["task", "schema", "dev", "synthetic", "runtime"],
  "look-repair": ["task", "schema", "dev", "runtime"],
  replicate: ["locked-plan", "schema", "dev", "runtime"],
};

export class MountRefused extends Error {
  constructor(readonly turn: TurnKind, readonly reason: string) {
    super(`omb-investigate: ${turn} turn refused before launch: ${reason}`);
    this.name = "MountRefused";
  }
}

const inside = (child: string, root: string): boolean => {
  const c = path.resolve(child), r = path.resolve(root);
  return c === r || c.startsWith(r + path.sep);
};

/**
 * Refuse a turn whose mounts break the policy: a role the turn may not see, a path that overlaps a
 * forbidden root (host-only state, the real data, a held-out partition), or a relative path.
 */
export function assertMounts(turn: TurnKind, route: "P" | "H", mounts: readonly Mount[], forbidden: readonly string[]): void {
  const allowed = (route === "H" ? H_POLICY : P_POLICY)[turn];
  for (const m of mounts) {
    if (!allowed.includes(m.role)) throw new MountRefused(turn, `a ${turn} turn may not mount ${m.role} data`);
    if (!path.isAbsolute(m.path)) throw new MountRefused(turn, "mount paths must be absolute");
    for (const f of forbidden) {
      if (inside(m.path, f) || inside(f, m.path)) throw new MountRefused(turn, `${m.role} mount overlaps a host-only or real-data root`);
    }
  }
}

export function allowedRoles(turn: TurnKind, route: "P" | "H"): readonly MountRole[] {
  return (route === "H" ? H_POLICY : P_POLICY)[turn];
}

/** Regular files only; never follow worker-controlled links. */
function* files(dir:string,strict=false):Generator<string> {
  try {
    const st=lstatSync(dir);if(st.isSymbolicLink())return;
    if(st.isFile()){yield dir;return;}if(!st.isDirectory())return;
    for(const name of readdirSync(dir).sort())yield* files(path.join(dir,name),strict);
  }catch(error){if(strict)throw error;/* Missing/unreadable files supply no positive breach evidence. */}
}

/** Full streaming scan: console/file size cannot hide a known secret. */
export function scanForCanaries(workdir:string,canaries:readonly string[]):string[] {
  const wanted=canaries.filter(c=>typeof c==='string'&&c.length>=6);
  if(!wanted.length)return [];
  const tokens=wanted.map(c=>[c,Buffer.from(c)] as const),overlap=Math.max(...tokens.map(([,b])=>b.length))-1,found=new Set<string>();
  for(const file of files(workdir)){
    let fd:number|undefined;
    try{
      fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);if(!fstatSync(fd).isFile())continue;
      const chunk=Buffer.alloc(65536);let tail=Buffer.alloc(0),n:number;
      while((n=readSync(fd,chunk,0,chunk.length,null))>0){
        const bytes=Buffer.concat([tail,chunk.subarray(0,n)]);
        for(const [c,b] of tokens)if(bytes.includes(b))found.add(c);
        if(found.size===wanted.length)return [...found].sort();
        tail=Buffer.from(bytes.subarray(Math.max(0,bytes.length-overlap)));
      }
    }catch{/* An unreadable file is not positive evidence of a leak. */}
    finally{if(fd!==undefined)closeSync(fd);}
  }
  return [...found].sort();
}

/** Authorized tables may be compressed. Scan their decoded bytes before a worker turn. */
export async function scanAuthorizedCanaries(dir:string,canaries:readonly string[]):Promise<string[]> {
  if(!canaries.length)return [];
  const tokens=canaries.map(c=>[c,Buffer.from(c)] as const),overlap=Math.max(...tokens.map(([,b])=>b.length))-1,found=new Set<string>();
  for(const file of files(dir,true)){
    const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    const input=createReadStream(file,{fd,autoClose:true});
    const decoded=file.endsWith('.gz')?input.compose(createGunzip()):input;
    let tail=Buffer.alloc(0);
    try{
      for await(const chunk of decoded){
        const bytes=Buffer.concat([tail,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);
        for(const [c,b] of tokens)if(bytes.includes(b))found.add(c);
        if(found.size===canaries.length)return [...found].sort();
        tail=Buffer.from(bytes.subarray(Math.max(0,bytes.length-overlap)));
      }
    }finally{decoded.destroy();input.destroy();}
  }
  return [...found].sort();
}
