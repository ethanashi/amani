// Runtime licence expressions. Unsupported identifiers/operators fail closed.
const allowed=new Set('MIT ISC BSD-2-Clause BSD-3-Clause Apache-2.0 0BSD CC0-1.0 Unlicense Python-2.0 PSF-2.0 Zlib BlueOak-1.0.0 Unicode-3.0 MIT-0'.split(' '));
export function approvedLicense(value){
  const source=String(value??'').replace(/\s*\/\s*/g,' OR ');
  const tokens=source.match(/[A-Za-z0-9.+-]+|[()]/g)??[];
  if(!tokens.length||tokens.join('')!==source.replace(/\s/g,''))return false;
  let at=0;
  function factor(){
    const token=tokens[at++];
    if(token==='('){const ok=disjunction();if(tokens[at++]!==')')throw Error('unclosed licence expression');return ok;}
    if(!token||[')', 'AND', 'OR'].includes(token))throw Error('invalid licence expression');
    return allowed.has(token);
  }
  function conjunction(){let ok=factor();while(tokens[at]==='AND'){at++;const rhs=factor();ok=ok&&rhs;}return ok;}
  function disjunction(){let ok=conjunction();while(tokens[at]==='OR'){at++;const rhs=conjunction();ok=ok||rhs;}return ok;}
  try{const ok=disjunction();return at===tokens.length&&ok;}catch{return false;}
}
