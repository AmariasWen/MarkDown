const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
(async()=>{
 const dir=await fs.mkdtemp(path.join(__dirname,'..','.markdown-recovery-'));
 let child;
 try {
  await fs.copyFile(path.join(__dirname,'..','server.js'),path.join(dir,'server.js'));
  const data=path.join(dir,'data'), work=path.join(data,'.restore-work');
  await fs.mkdir(path.join(work,'old-snapshots'),{recursive:true});
  await fs.mkdir(path.join(data,'snapshots'),{recursive:true});
  const previous={version:1,revision:'before',categories:['原分类'],notes:[]};
  await fs.writeFile(path.join(data,'.restore-pending.json'),JSON.stringify(previous));
  await fs.writeFile(path.join(data,'library.json'),JSON.stringify({...previous,revision:'partial',categories:['导入的新分类']}));
  const snapshot={id:'1234567890000-abcdef',time:1234567890000,reason:'原快照',library:previous};
  await fs.writeFile(path.join(work,'old-snapshots',snapshot.id+'.json'),JSON.stringify(snapshot));
  await fs.writeFile(path.join(data,'snapshots','9999999999999-abcdef.json'),JSON.stringify({...snapshot,id:'9999999999999-abcdef'}));
  child=spawn(process.execPath,[path.join(dir,'server.js')],{env:{...process.env,PORT:'33221'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  for(let i=0;i<100&&!output.includes('http://localhost:');i++){if(child.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,30));}
  const actual=await(await fetch('http://127.0.0.1:33221/api/library')).json();
  assert.deepEqual(actual,previous);
  const snapshots=await(await fetch('http://127.0.0.1:33221/api/snapshots')).json();
  assert.deepEqual(snapshots.map(s=>s.id),[snapshot.id]);
  await assert.rejects(fs.access(path.join(data,'.restore-pending.json')));
  console.log('PASS: startup recovers the pre-import library and snapshots from an interrupted restore.');
 } finally {
  if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;}
  if(path.dirname(path.resolve(dir))!==path.resolve(__dirname,'..')||!path.basename(dir).startsWith('.markdown-recovery-'))throw Error('Unsafe test directory');
  await fs.rm(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
