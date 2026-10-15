import {integritySections} from './integrity-result.ts';
import {object,type Json} from './results.ts';
/** Host run metadata is not integrity evidence; an explicit marker takes precedence. */
export function addReportMetadata(report:Json,task:{template:Json;publicContract?:Json;mode:'card'|'pilot'},incomplete:boolean,id:Json,planAmendments?:Json[]):void {
 if(!object(report))return;
 const roots=integritySections(task.template,'',task);
 const protectedPath=(at:string)=>roots.some(root=>at===root||at.startsWith(root+'/')||root.startsWith(at+'/'));
 if((task.mode==='card'||!object(report.extra)&&Object.hasOwn(report,'incomplete'))&&!protectedPath('/incomplete'))report.incomplete=incomplete;
 if(planAmendments !== undefined && task.mode==='card' && !object(report.extra) && !protectedPath('/extra'))report.extra={};
 if(object(report.extra)&&!protectedPath('/extra/amani'))report.extra.amani={incomplete,investigation_id:id,...(planAmendments === undefined ? {} : {planAmendments,postExposure:planAmendments.some(a=>object(a)&&a.postExposure===true)})};
}
