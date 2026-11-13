const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
const root = __dirname, data = path.join(root, 'data'), blobs = path.join(data, 'attachments'), snaps = path.join(data, 'snapshots');
const library = path.join(data, 'library.json');
let queue = Promise.resolve();
const exclusive = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
const json = (res, value, status = 200) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
async function readBody(req, limit) { const parts = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('文件过大，单个附件上限为 30 MB，备份上限为 500 MB'); parts.push(chunk); } return Buffer.concat(parts); }
async function atomic(file, value) { const temp = file + '.tmp'; await fs.writeFile(temp, JSON.stringify(value, null, 2)); await fs.rename(temp, file); }
const restoreWork = path.join(data, '.restore-work'), restoreMarker = path.join(data, '.restore-pending.json');
async function exists(file) { try { await fs.access(file); return true; } catch(e) { if(e.code==='ENOENT') return false; throw e; } }
async function removeRestoreWork() { await fs.rm(restoreWork, {recursive:true, force:true}); }
async function recoverRestore() {
 if (!await exists(restoreMarker)) return;
 const previous = JSON.parse(await fs.readFile(restoreMarker,'utf8'));
 const oldSnaps = path.join(restoreWork,'old-snapshots');
 if(await exists(oldSnaps)) {
  await fs.rm(snaps,{recursive:true,force:true});
  await fs.rename(oldSnaps,snaps);
 }
 await atomic(library,previous);
 await fs.unlink(restoreMarker);
 await removeRestoreWork();
}
async function restoreBackup(value, imported, files) {
 await recoverRestore();
 await removeRestoreWork();
 const stagedSnaps = path.join(restoreWork,'snapshots');
 await fs.mkdir(restoreWork,{recursive:true});
 try {
  const previous = await readLibrary();
  await fs.cp(snaps,stagedSnaps,{recursive:true});
  for(const s of imported) await atomic(path.join(stagedSnaps,s.id+'.json'),s);
  const before=Date.now()+'-'+crypto.randomBytes(3).toString('hex');
  await atomic(path.join(stagedSnaps,before+'.json'),{id:before,time:Date.now(),reason:'导入备份前的状态',library:previous});
  const names=(await fs.readdir(stagedSnaps)).filter(x=>x.endsWith('.json')).sort().reverse();
  for(const name of names.filter(n=>n!==before+'.json').slice(19)) await fs.unlink(path.join(stagedSnaps,name));
  for(const [id,bytes] of files) {
   const temp=path.join(blobs,id+'.tmp');
   await fs.writeFile(temp,bytes);
   await fs.rename(temp,path.join(blobs,id));
  }
  value.revision=crypto.randomUUID();
  await atomic(restoreMarker,previous);
  await fs.rename(snaps,path.join(restoreWork,'old-snapshots'));
  await fs.rename(stagedSnaps,snaps);
  await atomic(library,value);
  await fs.unlink(restoreMarker);
 } catch(error) {
  await recoverRestore();
  throw error;
 } finally {
  if(!await exists(restoreMarker)) await removeRestoreWork().catch(e=>console.error(e.message));
 }
}
function validate(value) {
 if (!value || !Array.isArray(value.notes) || !Array.isArray(value.categories) || value.categories.some(c => typeof c !== 'string')) throw new Error('知识库格式不正确');
 const ids = new Set();
 for (const n of value.notes) { if (typeof n.id !== 'string' || ids.has(n.id) || typeof n.title !== 'string' || typeof n.body !== 'string' || !['text','sticky','image','file'].includes(n.type) || !Array.isArray(n.tags) || n.tags.some(t => typeof t !== 'string') || !Array.isArray(n.attachments) || typeof n.category !== 'string' || !Number.isFinite(n.updated) || !Number.isFinite(n.created)) throw new Error('记录格式不正确'); ids.add(n.id); for (const a of n.attachments) if (!/^[a-f0-9]{64}$/.test(a.id) || typeof a.name !== 'string' || typeof a.type !== 'string' || !Number.isFinite(a.size)) throw new Error('附件格式不正确'); }
 return {version:1, revision:value.revision, categories:value.categories, notes:value.notes};
}
async function readLibrary() { return JSON.parse(await fs.readFile(library, 'utf8')); }
async function snapshot(reason) { const value = await readLibrary(); const id = Date.now() + '-' + crypto.randomBytes(3).toString('hex'); await atomic(path.join(snaps, id + '.json'), {id, time:Date.now(), reason, library:value}); const list = (await fs.readdir(snaps)).filter(x => x.endsWith('.json')).sort().reverse(); for (const name of list.slice(20)) await fs.unlink(path.join(snaps, name)); return id; }
async function unusedFiles() { const values=[await readLibrary()]; for(const name of (await fs.readdir(snaps)).filter(x=>x.endsWith('.json'))) values.push(JSON.parse(await fs.readFile(path.join(snaps,name),'utf8')).library); const used=new Set(values.flatMap(v=>v.notes.flatMap(n=>n.attachments.map(a=>a.id)))); const unused=[]; for(const id of await fs.readdir(blobs)) if(/^[a-f0-9]{64}$/.test(id)&&!used.has(id)&&(await fs.stat(path.join(blobs,id))).mtimeMs<Date.now()-86400000) unused.push(id); return unused; }
async function verifyFiles(value) { for (const n of value.notes) for (const a of n.attachments) await fs.access(path.join(blobs, a.id)); }
async function initialize() {
 await fs.mkdir(blobs, {recursive:true}); await recoverRestore(); await removeRestoreWork(); await fs.mkdir(snaps, {recursive:true});
 try { await fs.access(library); } catch (error) { if(error.code!=='ENOENT') throw error;
 const now = Date.now(); const make = (title, body, type, category, tags, extra = {}) => ({id:crypto.randomUUID(), title, body, type, category, tags, created:now, updated:now, attachments:[], starred:false, pinned:false, deleted:false, ...extra});
 await atomic(library, {version:1, revision:crypto.randomUUID(), categories:['工作与项目','学习与成长','生活与日常','灵感收集'], notes:[
 make('欢迎来到你的灵感岛屿', '这里是MarkDown，一个只属于你的本地知识库。\n\n把值得保存的文字、截图和文件放在一起，让零散的信息慢慢长成自己的知识。\n\n点击卡片阅读预览，再点「编辑记录」开始编辑。\n\n这是一条示例记录，可以随时删除。', 'text','学习与成长',['使用指南','示例'],{pinned:true}),
 make('让记录成为一件轻松的小事', '不必每次都写一篇完整的文章。\n\n一个想法，一段摘录，一张截图，\n都是值得留下的开始。\n\n—— 示例便签', 'sticky','灵感收集',['灵感','示例'],{starred:true}),
 make('搭建自己的知识整理习惯', '01 / 收集：先记下来，不急着分类\n02 / 整理：给内容起一个容易找到的标题\n03 / 连接：用标签把相关想法串起来\n04 / 回顾：每周重新看看收藏\n\n示例笔记 · 你可以在这里写阅读摘录、项目资料或学习记录。','text','学习与成长',['知识管理','示例']),
 make('一个还没长大的想法', '做一个「以后想做的事」清单。\n不是待办，也没有截止日期。\n只是留给未来的自己，一点小小的期待。\n\n—— 示例便签','sticky','生活与日常',['生活','示例'])]});
 }
}
async function handle(req, res) {
 res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Cache-Control','no-store');
 const url = new URL(req.url, 'http://localhost');
 if (!/^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '')) return json(res,{error:'仅支持本机访问'},403);
 if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return json(res,{error:'不允许跨站请求'},403);
 if(await exists(restoreMarker)) await exclusive(recoverRestore);
 if(req.method==='GET') await queue;
 if(url.pathname === '/api/preferences' && req.method === 'GET') {const file=path.join(data,'preferences.json'); return json(res,await exists(file)?JSON.parse(await fs.readFile(file,'utf8')):{theme:'fresh'});}
 if(url.pathname === '/api/preferences' && req.method === 'PUT') {const {theme}=JSON.parse((await readBody(req,1024)).toString()); if(!['fresh','warm','blue','dark'].includes(theme)) throw new Error('无效样式'); return exclusive(async()=>{await atomic(path.join(data,'preferences.json'),{theme});json(res,{ok:true});});}
 if (url.pathname === '/api/health' && req.method === 'GET') return json(res,{app:'markdown-local-library',directory:root});
 if (url.pathname === '/api/library' && req.method === 'GET') return json(res, await readLibrary());
 if (url.pathname === '/api/library' && req.method === 'PUT') { const value = validate(JSON.parse((await readBody(req, 20*1024*1024)).toString())); return exclusive(async () => { const current=await readLibrary(); if(value.revision!==current.revision) return json(res,{error:'其他页面已更新知识库。请保留本次编辑内容，刷新页面后重试。'},409); await verifyFiles(value); await snapshot('编辑记录'); value.revision=crypto.randomUUID(); await atomic(library,value); json(res,{ok:true,revision:value.revision}); }); }
 if (url.pathname === '/api/upload' && req.method === 'POST') { const content = await readBody(req,30*1024*1024); const id = crypto.createHash('sha256').update(content).digest('hex'); return exclusive(async()=>{await fs.writeFile(path.join(blobs,id),content,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST') throw e;}); const now=new Date(); await fs.utimes(path.join(blobs,id),now,now); json(res,{id,size:content.length});}); }
 if (url.pathname.startsWith('/files/') && req.method === 'GET') { const id = url.pathname.slice(7); if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效附件'); const content = await fs.readFile(path.join(blobs,id)); res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox"); res.setHeader('Content-Type','application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(url.searchParams.get('name') || 'attachment')}`); return res.end(content); }
 if (url.pathname.startsWith('/images/') && req.method === 'GET') { const id=url.pathname.slice(8); if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效图片'); const content=await fs.readFile(path.join(blobs,id)); let type = content[0]===137 && content.subarray(1,4).toString()==='PNG' ? 'image/png' : content[0]===255 && content[1]===216 ? 'image/jpeg' : content.subarray(0,3).toString()==='GIF' ? 'image/gif' : content.subarray(8,12).toString()==='WEBP' ? 'image/webp' : null; if(!type) {res.writeHead(415); return res.end();} res.setHeader('Content-Type',type); return res.end(content); }
 if (url.pathname === '/api/snapshots' && req.method === 'GET') { const result=[]; for(const name of (await fs.readdir(snaps)).filter(x=>x.endsWith('.json')).sort().reverse()) {const s=JSON.parse(await fs.readFile(path.join(snaps,name),'utf8')); result.push({id:s.id,time:s.time,reason:s.reason,count:s.library.notes.filter(n=>!n.deleted).length});} return json(res,result); }
 if (url.pathname === '/api/snapshots' && req.method === 'POST') return exclusive(async()=>{await snapshot('手动快照'); json(res,{ok:true});});
 if (url.pathname === '/api/restore-snapshot' && req.method === 'POST') { const {id}=JSON.parse((await readBody(req,1024)).toString()); if(!/^\d+-[a-f0-9]{6}$/.test(id)) throw new Error('无效快照'); return exclusive(async()=>{const s=JSON.parse(await fs.readFile(path.join(snaps,id+'.json'),'utf8')); const value=validate(s.library); await verifyFiles(value); await snapshot('恢复前的状态'); value.revision=crypto.randomUUID(); await atomic(library,value); json(res,{ok:true});}); }
 if (url.pathname === '/api/backup' && req.method === 'GET') return exclusive(async()=>{const current=await readLibrary(); const snapshots=[]; for(const name of (await fs.readdir(snaps)).filter(x=>x.endsWith('.json'))) snapshots.push(JSON.parse(await fs.readFile(path.join(snaps,name),'utf8'))); const ids=new Set([current,...snapshots.map(s=>s.library)].flatMap(v=>v.notes.flatMap(n=>n.attachments.map(a=>a.id)))); const files={}; for(const id of ids) files[id]=(await fs.readFile(path.join(blobs,id))).toString('base64'); const compressed=await gzip(JSON.stringify({format:'shiyu-backup-v1',library:current,snapshots,files})); res.setHeader('Content-Type','application/gzip'); res.setHeader('Content-Disposition','attachment; filename="markdown-backup-'+new Date().toISOString().slice(0,10)+'.json.gz"'); res.end(compressed);});
 if(url.pathname === '/api/import' && req.method === 'POST') { const raw=await readBody(req,500*1024*1024); const parsed=JSON.parse((await gunzip(raw,{maxOutputLength:750*1024*1024})).toString()); if(parsed.format!=='shiyu-backup-v1' || !parsed.files || !Array.isArray(parsed.snapshots)) throw new Error('请选择MarkDown导出的 .json.gz 备份'); const value=validate(parsed.library); const imported=parsed.snapshots.slice(-20).map(s=>{if(!/^\d+-[a-f0-9]{6}$/.test(s.id) || !Number.isFinite(s.time)) throw new Error('快照格式错误'); return {...s,library:validate(s.library)};}); const files=[]; for(const [id,base64] of Object.entries(parsed.files)) {if(!/^[a-f0-9]{64}$/.test(id) || typeof base64!=='string') throw new Error('附件格式错误'); const bytes=Buffer.from(base64,'base64'); if(crypto.createHash('sha256').update(bytes).digest('hex')!==id) throw new Error('备份附件校验失败'); files.push([id,bytes]);} const supplied=new Set(files.map(f=>f[0])); for(const v of [value,...imported.map(s=>s.library)]) for(const n of v.notes) for(const a of n.attachments) if(!supplied.has(a.id)) throw new Error('备份附件缺失'); return exclusive(async()=>{await restoreBackup(value,imported,files); json(res,{ok:true});}); }
 if(url.pathname === '/api/open-folder' && req.method === 'POST') {const {id}=JSON.parse((await readBody(req,1024)).toString()); if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效附件'); const file=path.join(blobs,id); await fs.access(file); const system_root=process.env.SystemRoot||process.env.WINDIR; if(process.platform!=='win32'||!system_root) throw new Error('打开所在文件夹需要 Windows 环境'); await new Promise((resolve,reject)=>{const child=require('child_process').spawn(path.join(system_root,'explorer.exe'),['/select,',file],{detached:true,stdio:'ignore'}); child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});}); return json(res,{ok:true});}
 if(url.pathname === '/api/attachments/keep' && req.method === 'POST') {const {ids}=JSON.parse((await readBody(req,1024*1024)).toString()); if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))) throw new Error('附件格式错误'); return exclusive(async()=>{const now=new Date(); for(const id of new Set(ids)) await fs.utimes(path.join(blobs,id),now,now); json(res,{ok:true});});}
 if(url.pathname === '/api/cleanup' && req.method === 'POST') return exclusive(async()=>{const files=await unusedFiles(); let bytes=0; for(const id of files){bytes+=(await fs.stat(path.join(blobs,id))).size; await fs.unlink(path.join(blobs,id));} json(res,{count:files.length,bytes});});
 if(url.pathname === '/api/storage' && req.method === 'GET') { let size=0; for(const name of await fs.readdir(blobs)) size+=(await fs.stat(path.join(blobs,name))).size; let snapshots=0; for(const name of await fs.readdir(snaps)) snapshots+=(await fs.stat(path.join(snaps,name))).size; let reclaimable=0; for(const id of await unusedFiles()) reclaimable+=(await fs.stat(path.join(blobs,id))).size; return json(res,{attachments:size,snapshots,library:(await fs.stat(library)).size,reclaimable}); }
 if (req.method !== 'GET') return json(res,{error:'不支持的操作'},405);
 const name = {'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js'}[url.pathname]; if(!name){res.writeHead(404);return res.end('Not found');} res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'application/javascript':'text/html; charset=utf-8'); if(name==='index.html') res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"); res.end(await fs.readFile(path.join(root,name)));
}
initialize().then(()=>{const server=http.createServer((req,res)=>Promise.resolve(handle(req,res)).catch(e=>{console.error(e.message); if(!res.headersSent) json(res,{error:e.code==='ENOENT'?'文件不存在':e.message},400); else res.end();})); const port=Number(process.env.PORT)||3210; server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已占用。如果MarkDown已启动，请打开 http://localhost:${port}`:e.message);process.exitCode=1;}); server.listen(port,'127.0.0.1',()=>{const address=`http://localhost:${port}`; console.log(`MarkDown已启动：${address}\n数据目录：${data}\n迁移时关闭此窗口，然后复制整个文件夹。按 Ctrl+C 停止。`);if(process.argv.includes('--open')) require('child_process').spawn('cmd',['/c','start','',address],{windowsHide:true});});}).catch(e=>{console.error(e);process.exitCode=1;});
