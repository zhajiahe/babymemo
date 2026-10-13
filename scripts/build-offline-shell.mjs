import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const target=process.argv[2]||'dist';
if(!existsSync(target+'/index.html'))throw Error('Build the app before generating the offline shell');
const assets=['/index.html','/offline-store.mjs','/site.webmanifest','/brand/baby-journal-source.png','/brand/mark.svg','/brand/wordmark.svg','/icon-192.png','/icon-512.png','/icon-maskable-512.png','/apple-touch-icon.png','/favicon.svg','/favicon.ico',...readdirSync(target+'/assets').map(name=>'/assets/'+name)];
writeFileSync(target+'/offline-store.mjs',readFileSync('src/offline-store.mjs'));
const version=createHash('sha256').update(assets.map(path=>readFileSync(target+path)).join('\0')).digest('hex').slice(0,12);
writeFileSync(target+'/sw.js',readFileSync('src/service-worker.mjs','utf8').replace('__SHELL_CACHE__','babymemo-shell-'+version).replace('__SHELL_ASSETS__',JSON.stringify(assets)));
console.log('Generated offline shell and bounded private device storage.');
