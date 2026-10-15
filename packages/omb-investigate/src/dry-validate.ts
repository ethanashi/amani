import type {ExecutorPort,ExecRequest,ExecResult} from './ports.ts';
/** Free trusted validation: synthetic input only; no plan/look/appeal/repair budget is touched. */
export async function dryValidate(executor:ExecutorPort,request:ExecRequest):Promise<ExecResult> {
 if(request.mode!=='dry-run')throw new Error('dryValidate requires a synthetic dry-run request');
 return executor.run(request);
}
