/** The article fonts are pinned assets, copied into every source release. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {ROOT,command,type Toolchain} from './toolchain.ts';
export const JOURNAL_FONT_TEX=String.raw`\setmainfont{AmaniJournalSerif-Regular.ttf}[Path=fonts/,Ligatures=TeXOff,BoldFont=AmaniJournalSerif-Bold.ttf,ItalicFont=AmaniJournalSerif-Italic.ttf]
\setsansfont{lmsans10-regular.otf}[Path=fonts/,Ligatures=TeXOff,BoldFont=lmsans10-bold.otf]`;
export async function journalFontAssets(tc:Toolchain,dir:string):Promise<Map<string,Uint8Array>>{
 const files=new Map<string,Uint8Array>();
 for(const name of ['AmaniJournalSerif-Regular.ttf','AmaniJournalSerif-Bold.ttf','AmaniJournalSerif-Italic.ttf','OFL.txt','GUST-FONT-LICENSE.txt'])files.set('fonts/'+name,readFileSync(path.join(ROOT,'vendor/fonts',name)));
 const sans=JSON.parse(await command(tc.python,['-c',`import zipfile,sys,json,base64\nz=zipfile.ZipFile(sys.argv[1]);print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in ['lmsans10-regular.otf','lmsans10-bold.otf']}))`,tc.texBundle]));
 for(const [name,data] of Object.entries(sans))files.set('fonts/'+name,Buffer.from(data as string,'base64'));
 mkdirSync(path.join(dir,'fonts'),{recursive:true});for(const [name,data] of files)writeFileSync(path.join(dir,name),data);
 return files;
}
