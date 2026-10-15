import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const target=process.argv[2]||'dist';
if(!existsSync(target+'/index.html'))throw Error('Build the app before generating the offline shell');
const assets=['/index.html','/offline-store.mjs','/private-media-cache.mjs','/site.webmanifest','/brand/mark.svg','/brand/wordmark.svg','/icon-192.png','/icon-512.png','/icon-maskable-512.png','/apple-touch-icon.png','/favicon.svg','/favicon.ico',...readdirSync(target+'/assets').map(name=>'/assets/'+name)];
// The same strictly checked TS implementation ships to both Vite and the service worker.
const typedStore=readFileSync('src/offline-store.ts','utf8');
const storeJS=ts.transpileModule(typedStore,{fileName:'offline-store.ts',compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
writeFileSync(target+'/offline-store.mjs',storeJS);
// Browser service workers cannot follow the Node-only .mjs -> .ts wrapper.
// Emit the same typed caching policy as standalone JavaScript for offline installs.
const cachePolicy=readFileSync('src/private-media-cache.ts','utf8');
const cacheJS=ts.transpileModule(cachePolicy,{fileName:'private-media-cache.ts',compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
writeFileSync(target+'/private-media-cache.mjs',cacheJS);
const version=createHash('sha256').update(assets.map(path=>readFileSync(target+path)).join('\0')).digest('hex').slice(0,12);
const workerTS=readFileSync('src/service-worker.ts','utf8');
const workerJS=ts.transpileModule(workerTS,{fileName:'service-worker.ts',compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
writeFileSync(target+'/sw.js',workerJS.replace('__SHELL_CACHE__','babymemo-shell-'+version).replace('__SHELL_ASSETS__',JSON.stringify(assets)));
console.log('Generated offline shell and bounded private device storage.');
