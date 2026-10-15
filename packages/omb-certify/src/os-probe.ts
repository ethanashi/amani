import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
/** Real operating-system identity probes for the OS-user separation check. A certification request
 * cannot replace them (no callback parameter); only a test module mock can. */
export function effectiveUid():number|null { return typeof process.geteuid==='function'?process.geteuid():null; }
/** Resolves a system account by name from the OS user database; null when absent or unreadable. */
export function systemUid(name:'_ombcert'|'_ombrun'):number|null {
  try{
    const out=execFileSync('/usr/bin/id',['-u',name],{encoding:'utf8',timeout:5_000,stdio:['ignore','pipe','ignore']}).trim();
    return /^[0-9]+$/.test(out)?Number(out):null;
  }catch{return null;}
}
export function ownerAndMode(file:string):{uid:number;mode:number;symlink:boolean}|null {
  try{const st=lstatSync(file);return {uid:st.uid,mode:st.mode,symlink:st.isSymbolicLink()};}catch{return null;}
}
