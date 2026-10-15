import {CodexAdapter,type CodexAdapterOptions} from '../../omb-adapters/src/codex.ts';
import {ClaudeAdapter,type ClaudeAdapterOptions} from '../../omb-adapters/src/claude.ts';
import {WORKER_SCHEMAS} from '../../omb-investigate/src/turns.ts';
import type {Model} from './runtime.ts';
/** Both real adapter paths use V7's existing JSON validator. Host model patterns
 * also reach Claude's lower-level identity gate; PW7 rechecks family + identity. */
export function createLiveAdapters(codex:CodexAdapterOptions,claude:ClaudeAdapterOptions,models:readonly Model[]=[]){
 return {
  codex:new CodexAdapter({...codex,schemas:{...codex.schemas,...WORKER_SCHEMAS}}),
  claude:new ClaudeAdapter({...claude,schemas:{...claude.schemas,...WORKER_SCHEMAS},modelVersionPatterns:{...claude.modelVersionPatterns,...Object.fromEntries(models.filter(m=>m.family==='claude'&&m.versionPattern).map(m=>[m.model,m.versionPattern!]))}}),
 };
}
