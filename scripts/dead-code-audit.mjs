#!/usr/bin/env node
// Conservative import-graph audit. Reports candidates; never deletes files.
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve,relative,dirname,extname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const src=resolve(root,'src');
const walk=folder=>readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(folder,e.name)):[resolve(folder,e.name)]);
const files=walk(src).filter(p=>/\.(?:mjs|js|ts|tsx)$/.test(p));
const byName=new Set(files);
const refs=new Map(files.map(p=>[p,new Set()]));
const resolveRef=(file,spec)=>{if(!spec.startsWith('.'))return null;const p=resolve(dirname(file),spec);const candidates=[p,p+'.ts',p+'.tsx',p+'.mjs',p+'.js',p.replace(/\.mjs$/,'.ts'),p.replace(/\.js$/,'.ts'),resolve(p,'index.ts')];return candidates.find(x=>byName.has(x))||null};
for(const file of files){const body=readFileSync(file,'utf8');const rx=/(?:\b(?:import|export)\s*(?:[^;]*?\s+from\s*)?|\bimport\s*\()\s*['"]([^'"]+)['"]/g;for(const match of body.matchAll(rx)){const p=resolveRef(file,match[1]);if(p)refs.get(p).add(relative(root,file))}}
// Runtime entrypoints, generated service-worker registration, and Node tests use
// non-import references: do not claim unreferenced modules are dead.
const unreferenced=files.filter(f=>refs.get(f).size===0).map(f=>relative(root,f)).sort();
const report={sourceFiles:files.length,unreferencedCandidates:unreferenced,notes:['Candidates are NOT proof of dead code. Check Worker entrypoints, browser workers, Node tests, dynamic imports, re-export shims and build scripts before deleting.','This audit performs no mutations and intentionally has false positives.']};
console.log(JSON.stringify(report,null,2));
