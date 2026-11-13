const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {gzipSync,gunzipSync} = require('node:zlib');

(async()=>{
 const dir=await fs.mkdtemp(path.join(__dirname,'..','.shiyu-test-'));
 await fs.copyFile(path.join(__dirname,'..','server.js'),path.join(dir,'server.js'));
 const port=33219, base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,[path.join(dir,'server.js')],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const call=async(url,method='GET',body,headers={})=>{const r=await fetch(base+url,{method,body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body),headers});return {status:r.status,value:await r.json()};};
 try{
  for(let i=0;i<60;i++){if(output.includes('http://localhost:'))break;if(child.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,50));}
  let {value:lib}=await call('/api/library');assert.equal(lib.notes.length,4);const original=structuredClone(lib);
  assert.equal((await call('/api/preferences')).value.theme,'fresh');
  for(const theme of ['warm','blue','dark','fresh']) {assert.equal((await call('/api/preferences','PUT',{theme})).status,200);assert.equal((await call('/api/preferences')).value.theme,theme);}
  assert.equal((await call('/api/preferences','PUT',{theme:'invalid'})).status,400);
  assert.equal((await call('/api/preferences')).value.theme,'fresh');
  assert.deepEqual((await call('/api/library')).value,original,'style changes must not alter records or revisions');
  const file=Buffer.from('repeatable attachment content');
  const a=(await call('/api/upload','POST',file)).value,b=(await call('/api/upload','POST',file)).value;assert.equal(a.id,b.id);assert.equal((await fs.readdir(path.join(dir,'data','attachments'))).length,1);
  lib.notes[0].attachments.push({...a,name:'测试.txt',type:'text/plain'});lib.notes[0].body='changed';
  let saved=await call('/api/library','PUT',lib);assert.equal(saved.status,200);lib.revision=saved.value.revision;
  assert.equal((await call('/api/library','PUT',original)).status,409,'stale writes must be rejected');
  assert.equal((await call('/api/library','PUT',{...lib,notes:[{...lib.notes[0],attachments:[{id:'../library.json',name:'bad',size:1,type:'text/plain'}]}]})).status,400);
  assert.equal((await call('/api/open-folder','POST',{id:'../library.json'})).status,400,'folder reveal must reject arbitrary paths');
  assert.equal((await call('/api/open-folder','POST',{id:'0'.repeat(64)})).status,400,'folder reveal must reject missing attachments');
  assert.equal((await call('/api/open-folder','POST',{id:a.id},{Origin:'http://evil.example'})).status,403,'folder reveal must reject cross-site requests');
  assert.equal((await call('/api/library','PUT',lib,{Origin:'http://evil.example'})).status,403);
  const snapshot=(await call('/api/snapshots')).value[0];assert.equal(snapshot.count,4);
  let cleanup=await call('/api/cleanup','POST');assert.equal(cleanup.value.count,0,'live attachments must survive cleanup');
  lib.notes[0].deleted=true;saved=await call('/api/library','PUT',lib);lib.revision=saved.value.revision;
  assert.equal((await call('/api/cleanup','POST')).value.count,0,'trash attachments must survive cleanup');
  lib.notes=lib.notes.slice(1);saved=await call('/api/library','PUT',lib);lib.revision=saved.value.revision;
  assert.equal((await call('/api/cleanup','POST')).value.count,0,'snapshot attachments must survive cleanup');
  const backup=Buffer.from(await (await fetch(base+'/api/backup')).arrayBuffer());const parsed=JSON.parse(gunzipSync(backup));assert.equal(parsed.files[a.id],file.toString('base64'));
  const changed=structuredClone(parsed);changed.files[a.id]=Buffer.from('corrupted').toString('base64');
  assert.equal((await call('/api/import','POST',gzipSync(JSON.stringify(changed)))).status,400);
  assert.equal((await call('/api/library')).value.revision,lib.revision,'invalid import must not change current state');
  const preFailure=structuredClone(lib); preFailure.notes[0].title='保留恢复前的记录';
  const preSave=await call('/api/library','PUT',preFailure);preFailure.revision=preSave.value.revision;
  const broken=path.join(dir,'data','snapshots',parsed.snapshots[0].id+'.json');
  await fs.unlink(broken);await fs.mkdir(broken);
  const failedImport=await call('/api/import','POST',backup);assert.equal(failedImport.status,400);
  assert.deepEqual((await call('/api/library')).value,preFailure,'failed snapshot staging must preserve current library');
  await fs.rmdir(broken);await fs.writeFile(broken,JSON.stringify(parsed.snapshots[0]));
  await fs.mkdir(path.join(dir,'data','library.json.tmp'));
  assert.equal((await call('/api/import','POST',backup)).status,400,'library write failure must be reported');
  await fs.rmdir(path.join(dir,'data','library.json.tmp'));
  assert.equal((await call('/api/library')).value.revision,preFailure.revision,'library remains unchanged after commit failure');
  assert.equal((await call('/api/import','POST',backup)).status,200);assert.equal((await call('/api/library')).value.notes.length,3);
  assert.equal((await call('/api/restore-snapshot','POST',{id:snapshot.id})).status,200);assert.equal((await call('/api/library')).value.notes[0].body,original.notes[0].body);
  assert.equal((await call('/api/cleanup','POST')).value.count,0,'old attachments remain recoverable while snapshots reference them');
  const download=await fetch(base+'/files/'+a.id+'?name=test.txt');assert.deepEqual(Buffer.from(await download.arrayBuffer()),file);assert.equal(download.headers.get('content-type'),'application/octet-stream');
  const invalidRestore=await call('/api/restore-snapshot','POST',{id:'../library'});assert.equal(invalidRestore.status,400);
  for(let i=0;i<23;i++)assert.equal((await call('/api/snapshots','POST')).status,200);
  assert.equal((await call('/api/snapshots')).value.length,20);
  assert.equal((await call('/api/cleanup','POST')).value.count,0,'recent uploads must survive cleanup');
  const oldTime=new Date(Date.now()-2*86400000); await fs.utimes(path.join(dir,'data','attachments',a.id),oldTime,oldTime);
  assert.equal((await call('/api/attachments/keep','POST',{ids:[a.id]})).status,200);
  assert.equal((await call('/api/cleanup','POST')).value.count,0,'active drafts must renew protection');
  await fs.utimes(path.join(dir,'data','attachments',a.id),oldTime,oldTime);
  const reclaimed=(await call('/api/cleanup','POST')).value;assert.equal(reclaimed.count,1);assert.equal(reclaimed.bytes,file.length);
  console.log('PASS: filesystem CRUD, attachment deduplication, revision conflicts, trash protection, snapshot retention/restore, compressed backup round-trip, corrupt backup rejection, safe cleanup and origin/path protection.');
 }finally{
  if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  const resolved=path.resolve(dir),parent=path.resolve(__dirname,'..');
  if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('.shiyu-test-'))throw Error('Unsafe temporary path');
  await fs.rm(resolved,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
