#!/usr/bin/env node
// Idempotent D1/R2 provisioning for GitHub Actions and manual deploys.
// --check is read-only against Cloudflare (but may write database_id locally).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const checkOnly=process.argv.includes('--check');
const configPath='wrangler.jsonc';
const config=JSON.parse(readFileSync(configPath,'utf8'));
const database=config.d1_databases?.find(x=>x.binding==='DB');
const bucket=config.r2_buckets?.find(x=>x.binding==='MEDIA');
if(!database?.database_name||!bucket?.bucket_name)throw Error('Missing DB or MEDIA bindings in wrangler.jsonc');

function wrangler(args){
 const result=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['--no-install','wrangler',...args],{
  env:{...process.env,CI:'true'},encoding:'utf8',maxBuffer:1024*1024*4
 });
 if(result.error)throw result.error;
 if(result.status!==0)throw Error('wrangler '+args.join(' ')+' failed: '+(result.stderr||result.stdout).slice(-1500));
 return result.stdout;
}
function listDatabases(){
 const output=wrangler(['d1','list','--json']).trim();
 const rows=JSON.parse(output.slice(output.indexOf('[')));
 if(!Array.isArray(rows))throw Error('Cloudflare returned an unexpected D1 listing');
 return rows;
}
let remote=listDatabases().find(db=>db.name===database.database_name);
if(!remote){
 if(checkOnly)throw Error('Missing D1 '+database.database_name+'; run provision without --check');
 wrangler(['d1','create',database.database_name]);
 remote=listDatabases().find(db=>db.name===database.database_name);
}
if(!remote?.uuid)throw Error('Could not resolve D1 database_id');
if(database.database_id && database.database_id!==remote.uuid){
 throw Error('D1 database_id mismatch for '+database.database_name+'; refusing to switch databases');
}
if(database.database_id!==remote.uuid){
 database.database_id=remote.uuid;
 writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
 console.log('Resolved D1 database_id for '+database.database_name);
}
const listing=wrangler(['r2','bucket','list']);
const bucketName=bucket.bucket_name;
const safeName=bucketName.replace(/[.*+?^$\u007b\u007d()|[\]\\]/g,'\\$&');
const exists=new RegExp('(^|[^a-z0-9-])'+safeName+'([^a-z0-9-]|$)','i').test(listing);
if(!exists){
 if(checkOnly)throw Error('Missing R2 bucket '+bucketName+'; run provision without --check');
 wrangler(['r2','bucket','create',bucketName]);
}
console.log(checkOnly?'Cloudflare D1/R2 resources verified':'Cloudflare D1/R2 resources ready');
