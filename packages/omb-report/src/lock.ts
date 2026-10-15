import { assertContext, type ReportContext } from './context.ts';
import { record } from './common.ts';
export function validLock(ctx:ReportContext,id:string):boolean{
 assertContext(ctx);const claim=ctx.claims.find(c=>c.id===id);if(!claim?.registered)return false;
 const lock=record(ctx.input.lock),nested=record(lock.record);const sequence=Number(lock.sequence??nested.sequence??lock.seq);
 if(!Number.isSafeInteger(sequence)||sequence<1||!ctx.input.looks.length)return false;
 return ctx.input.looks.every(look=>{const row=record(look),nested=record(row.record);const seq=Number(row.sequence??nested.sequence??row.seq);return Number.isSafeInteger(seq)&&seq>sequence;});
}
