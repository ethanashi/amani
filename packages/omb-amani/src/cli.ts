#!/usr/bin/env -S node --experimental-transform-types --no-warnings
import { assertDevelopmentAuthorization } from './medic-authorization.ts';
import path from 'node:path';
import {devFork} from './dev-fork.ts';
import {devReplay,replayFailure} from './dev-replay.ts';
import {isPhase} from '../../omb-investigate/src/types.ts';
import { replayAmani, type ReplayOptions } from './replay.ts';
import { runAmani, type RunOptions } from './run.ts';

import { parseArgs, parseReplayArgs } from './cli-args.ts';
export { parseArgs, parseReplayArgs } from './cli-args.ts';
export async function main(args: string[]) {
  if(['medic-resolve','dev-stand-in'].includes(args[0]??'')||args.includes('--medic-practice'))assertDevelopmentAuthorization();
  if(args[0]==='medic-stats') {
    if(args.length!==1)throw new Error('usage: amani medic-stats');
    return (await import('./medic-history.ts')).medicStats(new URL('../../../',import.meta.url).pathname);
  }
  if(args[0]==='medic-resolve') {
    if(args.length!==7||args[1]!=='--heal'||args[3]!=='--commit'||args[5]!=='--review-reference')throw new Error('usage: amani medic-resolve --heal ID --commit MERGED_COMMIT --review-reference REFERENCE');
    return (await import('./medic/stats.ts')).resolveFix(new URL('../../../',import.meta.url).pathname,args[2]!,args[4]!,args[6]!);
  }

  if(args.length===4&&args[0]==='dev-replay'&&args[1]==='--medic-practice'&&args[2]==='--inject')return (await import('./medic/reproduce.ts')).replayCheckpointFault(args[3]!);
  if(args[0]==='dev-stand-in') {
    if(args.length!==5||args[1]!=='--task'||args[3]!=='--out')throw new Error('usage: amani dev-stand-in --task DIR --out NEW_DIR');
    const {buildStandIn}=await import('./medic/stand-in.ts');
    return {synthetic:true,task:await buildStandIn(args[2]!,args[4]!)};
  }
  if (['dev-fork','dev-replay','dev-check'].includes(args[0]??'')) {
    const command=args.shift(),flags=new Map<string,string>();
    const allowed=command==='dev-fork'?['--from','--at','--out']:command==='dev-replay'?['--dir','--cassette','--on-divergence','--inject','--cap-minutes']:['--from','--at','--out','--cassette','--on-divergence','--inject','--cap-minutes'];
    while(args.length){const key=args.shift()!,value=args.shift();if(!allowed.includes(key)||!value||value.startsWith('--')||flags.has(key))throw new Error(`invalid argument: ${key}`);flags.set(key,value);}
    const from=flags.get('--from'),at=flags.get('--at'),out=flags.get('--out'),dir=flags.get('--dir'),mode=flags.get('--on-divergence')??'stop';
    if(mode!=='stop'&&mode!=='live')throw new Error('on-divergence must be stop or live');
    const options={onDivergence:mode,...(flags.has('--cassette')?{cassette:flags.get('--cassette')!}:{}),...(flags.has('--inject')?{inject:flags.get('--inject')!}:{}),...(flags.has('--cap-minutes')?{capMinutes:Number(flags.get('--cap-minutes'))}:{})} as const;
    if(command==='dev-replay'){if(!dir)throw new Error('--dir is required');return devReplay({dir,...options});}
    if(!from||!at||!isPhase(at)||!out)throw new Error('--from, valid --at phase, and --out required');
    if(command==='dev-check')return replayFailure({attemptDir:from,phase:at},out,options);
    const fork=await devFork({from,at,out});return {offRecord:true,gradable:false,out,at,sourceHash:fork.sourceHash};
  }
  if (args[0] === 'replay') {
    const options = parseReplayArgs(args);
    replayAmani(options);
    return { replay: true, out: path.resolve(options.out) };
  }
  return runAmani(parseArgs(args));
}
if (import.meta.main) {
  main(process.argv.slice(2)).then(result => {
    process.stdout.write(JSON.stringify(result) + '\n');
    // Incomplete science is a recorded attempt, not a harness crash.
  }).catch(e => { process.stderr.write(String(e) + '\n'); process.exitCode = 2; });
}
