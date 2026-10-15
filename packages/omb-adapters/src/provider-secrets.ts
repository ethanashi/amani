import {execFile} from 'node:child_process';
export type SecretReader=(ref:string)=>Promise<string|null>;
export const keychainSecret:SecretReader=async ref=>{
 const match=/^keychain:amani\/([A-Za-z0-9._/-]+)$/.exec(ref);if(!match)throw new Error('Invalid Keychain reference');
 return new Promise(resolve=>execFile('/usr/bin/security',['find-generic-password','-s','amani','-a',match[1]!,'-w'],{encoding:'utf8',timeout:10000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin'}},(error,stdout)=>resolve(error?null:stdout.replace(/\r?\n$/,''))));
};
/** Applied before any provider-controlled text reaches a log, model, artifact or IPC. */
export function redactSecrets(text:string,secrets:readonly string[]):string {
 for(const secret of secrets.filter(Boolean))for(const form of [secret,JSON.stringify(secret).slice(1,-1),encodeURIComponent(secret),Buffer.from(secret).toString('base64')])text=text.split(form).join('[REDACTED]');
 return text;
}
