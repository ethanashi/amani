/** Locate the first strict-JSON syntax fault even when V8 omits its byte/column position. */
export function jsonErrorPosition(text:string):number {
 let i=0,depth=0;const ws=()=>{while(/\s/.test(text[i]??'')&&i<text.length)i++;};
 const fail=():never=>{throw i;};
 const string=()=>{if(text[i++]!=='"')fail();for(;i<text.length;i++){const c=text[i];if(c==='"'){i++;return;}if(c==='\\'){i++;if(text[i]==='u'){if(!/^[0-9a-f]{4}$/i.test(text.slice(i+1,i+5)))fail();i+=4;}else if(!'"\\/bfnrt'.includes(text[i]??'!'))fail();}else if(c!.charCodeAt(0)<32)fail();}fail();};
 const value=():void=>{ws();if(++depth>256)fail();const c=text[i];
  if(c==='"')string();else if(c==='{'||c==='['){const object=c==='{',end=object?'}':']';i++;ws();if(text[i]===end)i++;else for(;;){if(object){string();ws();if(text[i++]!==':'){i--;fail();}}value();ws();if(text[i]===end){i++;break;}if(text[i++]!==','){i--;fail();}ws();}}
  else{const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));if(!match)fail();i+=match![0].length;}depth--;};
 try{value();ws();if(i!==text.length)fail();return i;}catch{return i;}
}
