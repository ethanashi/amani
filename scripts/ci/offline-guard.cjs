// Cooperative guard for trusted offline tests. Native workers retain their own OS sandbox.
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process');
const {fileURLToPath}=require('node:url');
const home=require('node:os').homedir();
const denied=['omerta-bio-heldout','.omerta-bio/oneshot/tierb','.omerta-bio/oneshot/tierb2','.omerta-bio/keys','.omerta-bio/bin','.local/share/claude'].map(p=>path.join(home,p));
function check(p) {
  if(typeof p==='number'||p==null)return;
  if(p instanceof URL)p=fileURLToPath(p);
  if(Buffer.isBuffer(p))p=p.toString();
  if(typeof p!=='string')return;
  const target=path.resolve(p);
  if(denied.some(d=>target===d||target.startsWith(d+path.sep)))throw Error('CI protected-path read refused');
}
for(const name of ['readFileSync','readFile','openSync','open','readdirSync','readdir','opendirSync','opendir','createReadStream','readlinkSync','readlink','realpathSync','realpath','statSync','stat','lstatSync','lstat','accessSync','access','existsSync']) {
 const original=fs[name];if(!original)continue;
 const wrapped=function(...args){check(args[0]);return original.apply(this,args)};
 Object.assign(wrapped,original);fs[name]=wrapped;
}
for(const name of ['readFile','open','readdir','opendir','readlink','realpath','stat','lstat','access']) {
 const original=fs.promises[name];if(original)fs.promises[name]=async function(...args){check(args[0]);return original.apply(this,args)};
}
function command(cmd,args) {
 if(typeof cmd!=='string')return;
 const base=path.basename(cmd);
 const temp=fs.realpathSync(require('node:os').tmpdir());
 const fixture=path.isAbsolute(cmd)&&(cmd.startsWith(temp+path.sep)||cmd.startsWith(process.cwd()+path.sep));
 if(['sudo','pkill','killall'].includes(base)||(['claude','codex'].includes(base)&&!fixture))throw Error('CI provider/pattern-kill command refused');
 check(cmd);
 for(const a of Array.isArray(args)?args:[])if(typeof a==='string'&&(a.startsWith(home)||a.startsWith('file:')))check(a);
}
for(const name of ['spawn','spawnSync','execFile','execFileSync','fork']) {
 const original=cp[name];cp[name]=function(...args){
   command(args[0],args[1]);
   // A native sandbox enforces its own file policy. CI preloads outside that
   // policy must not be inherited by its worker (nor change the tested spec).
   if(path.basename(String(args[0]))==='sandbox-exec') {
     const idx=Array.isArray(args[1])?2:1, prior=args[idx];
     const options=prior&&typeof prior==='object'?{...prior}:{};
     options.env={...(options.env||process.env)};
     delete options.env.NODE_OPTIONS; delete options.env.PYTHONPATH;
     if(typeof prior==='function')args.splice(idx,0,options);else args[idx]=options;
   }
   // Propagate Python guards even when a test supplies a replacement environment.
   if(/^python(?:[0-9.]+)?$/.test(path.basename(String(args[0])))) {
     const idx=Array.isArray(args[1])?2:1, options=args[idx];
     if(options&&typeof options==='object'&&options.env) {
       options.env={...options.env,PYTHONPATH:path.join(__dirname,'python-guard')+(options.env.PYTHONPATH?path.delimiter+options.env.PYTHONPATH:'')};
     }
   }
   return original.apply(this,args);
 };
}
for(const name of ['exec','execSync']) {
 const original=cp[name];cp[name]=function(...args){if(/(?:^|[\s;&|])(sudo|claude|codex|pkill|killall)(?:\s|$)/.test(args[0]))throw Error('CI provider/pattern-kill shell command refused');return original.apply(this,args)};
}
// Node's custom promisifiers return both streams and expose the child. Reusing
// the originals would bypass our guards; a generic promisifier loses stderr.
for(const name of ['execFile','exec']) {
 const wrapped=cp[name];
 wrapped[require('node:util').promisify.custom]=function(...args) {
   let child;
   const promise=new Promise((resolve,reject)=>{
     child=wrapped(...args,(error,stdout,stderr)=>{
       if(error){error.stdout=stdout;error.stderr=stderr;reject(error)}
       else resolve({stdout,stderr});
     });
   });
   promise.child=child;
   return promise;
 };
}
require('node:module').syncBuiltinESMExports();
