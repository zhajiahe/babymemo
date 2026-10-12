import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const auth=read('src/auth.ts'),api=read('src/worker.ts'),ui=read('src/App.tsx'),album=read('src/features/album/Album.tsx');
const wf=read('.github/workflows/deploy.yml'),smoke=read('scripts/smoke-check.mjs'),env=read('.dev.vars.example'),pkg=read('package.json');
test('first-run setup removes bootstrap secret from all active entrypoints',()=>{
 for(const source of [auth,api,ui,wf,smoke,env,pkg])assert.doesNotMatch(source,/BOOTSTRAP_SECRET|bootstrapSecret|bootstrapConfigured/);
 assert.match(ui,/ready\.sessionConfigured/);
 assert.match(ui,/ready\.encryptionConfigured/);
 assert.match(api,/app\.post\('\/api\/bootstrap'/);
});
test('first-owner write remains atomic and one-time',()=>{
 assert.match(auth,/if\(await owner\(c\.env\)\)throw Error\('ALREADY_INITIALIZED'\)/);
 assert.match(auth,/try\{await c\.env\.DB\.batch\(\[/);
 assert.match(auth,/INSERT INTO owner\(id,name,password_salt,password_hash,session_version,created_at\) VALUES\(1,/);
 assert.match(auth,/catch\(e\)\{if\(await owner\(c\.env\)\)throw Error\('ALREADY_INITIALIZED'\)/);
 assert.match(api,/!sameOrigin\(c\)/);
 assert.match(api,/!await authenticated\(c\)/);
 assert.match(auth,/input\.password\.length<6/);
 assert.match(auth,/SESSION_SECRET_NOT_CONFIGURED/);
 assert.match(auth,/DATA_KEY_NOT_CONFIGURED/);
});
test('deployment preserves two distinct stable secrets without deleting older ones',()=>{
 assert.equal((wf.match(/for name in SESSION_SECRET DATA_KEY; do/g)||[]).length,2);
 assert.match(wf,/wrangler secret put/);
 assert.doesNotMatch(wf,/wrangler secret delete/);
 assert.match(smoke,/ready\.sessionConfigured\|\|!ready\.encryptionConfigured/);
});
test('album card avoids metadata loading for every video in grid',()=>{
 assert.match(album,/video-placeholder/);
 assert.doesNotMatch(album,/<video muted playsInline preload="metadata"/);
 assert.match(album,/decoding="async"/);
});

test('PBKDF2 iteration count remains supported by production Workers',()=>{
 const crypto=read('src/crypto.ts');
 // Local Wrangler/Node may accept 120,000 while production Workers rejects it.
 assert.match(crypto,/iterations:100000/);
 assert.doesNotMatch(crypto,/iterations:120000/);
 assert.match(auth,/const salt=randomHex\(16\),hash=await passwordHash\(input.password,salt\)/);
 assert.match(auth,/const hash=await passwordHash\(password,existing.password_salt\)/);
});
