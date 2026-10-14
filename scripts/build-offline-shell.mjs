import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const target=process.argv[2]||'dist';
if(!existsSync(target+'/index.html'))throw Error('Build the app before generating the offline shell');
const assets=['/index.html','/offline-store.mjs','/site.webmanifest','/brand/mark.svg','/brand/wordmark.svg','/icon-192.png','/icon-512.png','/icon-maskable-512.png','/apple-touch-icon.png','/favicon.svg','/favicon.ico',...readdirSync(target+'/assets').map(name=>'/assets/'+name)];
// The same strictly checked TS implementation ships to both Vite and the service worker.
const typedStore=readFileSync('src/offline-store.ts','utf8');
const storeJS=ts.transpileModule(typedStore,{fileName:'offline-store.ts',compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
writeFileSync(target+'/offline-store.mjs',storeJS);
const version=createHash('sha256').update(assets.map(path=>readFileSync(target+path)).join('\0')).digest('hex').slice(0,12);
writeFileSync(target+'/sw.js',readFileSync('src/service-worker.mjs','utf8').replace('__SHELL_CACHE__','babymemo-shell-'+version).replace('__SHELL_ASSETS__',JSON.stringify(assets)));
console.log('Generated offline shell and bounded private device storage.');
