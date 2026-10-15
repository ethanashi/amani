import { readRolloutTelemetry } from './telemetry.ts';
import type { TokenUsage } from './contracts.ts';
/** CLI-owned stdout can be per-launch or cumulative in 0.156.1. Accept only a
 * complete interpretation corroborated by the unique filename-bound rollout.
 * Prefer the existing per-launch proof; never subtract twice on resumed launches. */
export function readVersionedTelemetry(transcript:string,rollouts:Readonly<Record<string,string>>,previous:TokenUsage|null,cliVersion:string|null) {
 const perLaunch=readRolloutTelemetry(transcript,rollouts,previous);
 if(perLaunch.verified || !previous || cliVersion!=='codex-cli 0.156.1')return perLaunch;
 const cumulative=readRolloutTelemetry(transcript,rollouts);
 if(!cumulative.verified || !cumulative.usageComplete || !cumulative.usage)return perLaunch;
 const current=cumulative.usage,keys=['inputTokens','cachedInputTokens','outputTokens','totalTokens'] as const;
 const delta:TokenUsage={inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0};
 for(const key of keys)delta[key]=current[key]-previous[key];
 if(keys.some(key=>!Number.isSafeInteger(delta[key])||delta[key]<0)||delta.cachedInputTokens>delta.inputTokens||delta.totalTokens<delta.inputTokens+delta.outputTokens)
  return {...cumulative,usage:null,usageComplete:false,verified:false,quota:null,warnings:[...cumulative.warnings,'cumulative stdout usage regressed on resume']};
 return {...cumulative,usage:delta};
}
