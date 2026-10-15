#!/usr/bin/env -S node --experimental-transform-types --no-warnings
// Shared release, desktop and GitHub launcher: no development dispatches.
import { parseArgs, parseReplayArgs } from './cli-args.ts';
import { runAmani } from './run.ts';
import { replayAmani } from './replay.ts';
import { medicStats } from './medic-history.ts';
process.env.AMANI_LAUNCHER='release';
export async function main(args:string[]){
  if(args[0]==='medic-stats'&&args.length===1)return medicStats(new URL('../../../',import.meta.url).pathname);
  if(args[0]==='replay'){const o=parseReplayArgs(args);replayAmani(o);return{replay:true,out:o.out};}
  return runAmani(parseArgs(args));
}
if(import.meta.main)main(process.argv.slice(2)).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=2;});
