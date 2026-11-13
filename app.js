const $ = id => document.getElementById(id);
const kinds = {all:['全部','▦'],text:['文字','☰'],image:['图片','▧'],file:['文件','▤'],sticky:['便签','▱']};
let library = {notes:[],categories:[]}, view = 'all', type = 'all', category = '', tag = '', editing = null, draftFiles = [], busy = false, toastTimer, dragDepth=0, savedDraft='';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const size = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
const date = n => new Date(n).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'});
const visible = () => library.notes.filter(n=>!n.deleted);
const noteSearchText = note => [note.title,note.body,note.category,...note.tags,...note.attachments.map(a=>a.name)].join(' ').toLocaleLowerCase();
const matchesSearch = (note,query) => query.split(/\s+/).filter(Boolean).every(word=>noteSearchText(note).includes(word));
function toast(message) { const dialog=document.querySelector('dialog[open]:last-of-type')||[...document.querySelectorAll('dialog[open]')].pop(); const target=dialog||document.body; if($('toast').parentElement!==target)target.append($('toast')); $('toast').textContent=message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3800); }
async function api(url, options={}) {let response;try{response=await fetch(url,options);}catch{throw new Error('无法连接本地服务，请运行 start.cmd，保持启动窗口打开后重试。当前编辑内容已保留。');}if(!response.ok){let error;try{error=(await response.json()).error;}catch{}throw new Error(error||'无法连接本地服务，请确认启动窗口仍在运行');}return response.json();}
async function load() {library=await api('/api/library');render();await storage();}
async function storage() {try{const s=await api('/api/storage');if($('cleanupFiles'))$('cleanupFiles').textContent=`安全清理闲置附件（可释放 ${size(s.reclaimable)}）`;$('storage').textContent=`${size(s.attachments+s.snapshots+s.library)} · 保存在 data 文件夹`;}catch{}}
async function persist(next) {if(busy)throw new Error('正在保存，请稍候');busy=true;try{const result=await api('/api/library',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});next.revision=result.revision;library=next;render();await storage();}finally{busy=false;}}
function confirmAction(title,text,action='确定') {return new Promise(resolve=>{$('confirmTitle').textContent=title;$('confirmText').textContent=text;$('confirmOk').textContent=action;$('confirmDialog').showModal();let resolved=false;const finish=value=>{if(resolved)return;resolved=true;$('confirmDialog').close();resolve(value);};$('confirmOk').onclick=()=>finish(true);$('confirmCancel').onclick=()=>finish(false);$('confirmDialog').oncancel=e=>{e.preventDefault();finish(false);};});}
function getFilteredNotes(){
 const query=$('search').value.trim().toLocaleLowerCase();
 let filtered=library.notes.filter(n=>Boolean(n.deleted)===(view==='trash')).filter(n=>view!=='starred'||n.starred).filter(n=>view!=='recent'||Date.now()-n.updated<7*86400000).filter(n=>!category||(n.category||'未分类')===category).filter(n=>type==='all'||n.type===type).filter(n=>!tag||n.tags.includes(tag)).filter(n=>!query||matchesSearch(n,query));
 const sort=$('sort').value;filtered.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(sort==='title'?a.title.localeCompare(b.title,'zh-CN'):sort==='created'?b.created-a.created:b.updated-a.updated));
 return filtered;
}
function render() {
 const notes=visible();
 const nav=[['all','▦','全部内容',notes.length],['starred','☆','我的收藏',notes.filter(n=>n.starred).length],['recent','◷','最近记录',notes.filter(n=>Date.now()-n.updated<7*86400000).length],['trash','♧','回收站',library.notes.filter(n=>n.deleted).length],['snapshots','◴','时光快照','']];
 $('nav').innerHTML=nav.map(([id,icon,label,count])=>`<button class="nav-item ${view===id&&!category?'active':''}" data-view="${id}"><span class="nav-icon">${icon}</span>${label}<span class="count">${count}</span></button>`).join('');
 $('categories').innerHTML=library.categories.map(c=>`<button class="nav-item ${category===c?'active':''}" data-category="${esc(c)}"><i class="category-dot"></i>${esc(c)}<span class="count">${notes.filter(n=>n.category===c).length}</span></button>`).join('');
 $('stats').innerHTML=[['▦',notes.length,'全部记录','份灵感','all'],['☰',notes.filter(n=>n.type==='text').length,'文字笔记','条记录','text'],['▧',notes.filter(n=>n.type==='image').length,'截图与图片','张图片','image'],['▤',notes.filter(n=>n.type==='file').length,'文件资料','份资料','file']].map(([icon,count,label,unit,filter])=>`<button class="stat" data-filter="${filter}"><span class="stat-icon">${icon}</span><div><strong>${count}</strong><small>${unit}</small><div class="stat-label">${label}</div></div></button>`).join('');
 const label=category||nav.find(n=>n[0]===view)?.[2]||'全部内容';
 $('crumb').textContent=label;$('sectionTitle').firstChild.textContent=label+' ';
 $('pageTitle').innerHTML=view==='trash'?'暂时放下，也能重新拾起<span>。</span>':'把零散的灵感，慢慢拾起<span>。</span>';
 $('pageSubtitle').textContent=view==='trash'?'删除的记录会留在这里；永久删除前，也会保留快照。':'截图、文字、文件，还有那些一闪而过的好想法。';
 $('filters').innerHTML=Object.entries(kinds).map(([id,[name]])=>`<button data-type="${id}" class="${type===id?'active':''}">${name}</button>`).join('');
 const query=$('search').value.trim().toLocaleLowerCase(),filtered=getFilteredNotes();
 $('clearSearch').disabled=!$('search').value; $('resultCount').textContent=filtered.length;$('empty').hidden=filtered.length>0;
 $('empty').querySelector('h3').textContent=query||tag?'没有找到相关记录':view==='trash'?'回收站是空的':'给灵感留一个位置';
 $('empty').querySelector('p').textContent=query||tag?'试试其他关键词，或清除筛选条件。':'新建一条记录，或把文件拖到这里。';
 $('activeTag').hidden=!tag;$('activeTag').innerHTML=`正在查看标签：#${esc(tag)} <button id="clearTag">清除 ×</button>`;
 if(!readingId)$('cards').innerHTML=filtered.map(n=>{const image=n.attachments.find(a=>/^image\/(png|jpeg|gif|webp)$/.test(a.type));const attachment=n.attachments[0];return `<article class="card ${n.type==='sticky'?'sticky':''}" tabindex="0" data-id="${esc(n.id)}" aria-label="打开 ${esc(n.title)}">${image?`<img class="card-image" src="/images/${image.id}" alt="${esc(image.name)}" loading="lazy">`:''}<div class="card-main"><div class="card-top"><span class="kind"><span>${kinds[n.type][1]}</span>${{text:'文字笔记',sticky:'灵感便签',image:'截图 / 图片',file:'文件资料'}[n.type]}</span><div class="card-actions">${n.pinned?'<span class="pin-label">↟ 置顶</span>':''}<button data-action="edit" class="card-edit" title="编辑记录" aria-label="编辑 ${esc(n.title)}">编辑</button><button data-action="star" class="${n.starred?'on':''}" title="${n.starred?'取消收藏':'收藏'}">${n.starred?'★':'☆'}</button></div></div><h3>${esc(n.title||'无标题记录')}</h3><p class="excerpt">${esc(n.body||'点击预览记录…')}</p>${attachment&&!image?`<button class="file-preview" data-folder="${attachment.id}" title="打开所在文件夹"><b>▤</b><span>${esc(attachment.name)}<small>${size(attachment.size)} · 打开所在文件夹${n.attachments.length>1?` · 共 ${n.attachments.length} 个附件`: ''}</small></span></button>`:''}<div class="tags">${n.tags.slice(0,4).map(t=>`<button class="tag" data-tag="${esc(t)}"># ${esc(t)}</button>`).join('')}</div></div><div class="card-footer"><span>${esc(n.category||'未分类')}</span><span>${date(n.updated)} 更新</span>${n.deleted?'<button data-action="restore" title="恢复记录">↶</button>':''}<button class="delete" data-action="delete" title="${n.deleted?'永久删除':'移入回收站'}">${n.deleted?'×':'⌫'}</button></div></article>`;}).join('');
 if(readingId)renderReader(filtered);
}
function draftValue(){return JSON.stringify([$ ('titleInput').value,$('bodyInput').value,tagDraftValue(),$('typeInput').value,$('categoryInput').value,$('starInput').checked,$('pinInput').checked,draftFiles]);}
function openEditor(note=null,kind='text') {
 if(!note&&readingId)closeReader();
 $('editorError').hidden=true; editing=note?.id||null;draftFiles=structuredClone(note?.attachments||[]);
 $('titleInput').value=note?.title||'';$('bodyInput').value=note?.body||'';draftTags=[...(note?.tags||[])];editingTag=-1;$('tagError').hidden=true;renderTagChips();$('typeInput').value=note?.type||kind;
 $('categoryInput').innerHTML=['未分类',...library.categories].map(c=>`<option>${esc(c)}</option>`).join('');$('categoryInput').value=note?.category||category||'未分类';
 $('starInput').checked=note?.starred||false;$('pinInput').checked=note?.pinned||false;$('editorLabel').textContent=note?'编辑记录':'新建记录';$('saveHint').textContent='保存到本地 data 文件夹';renderAttachments();savedDraft=draftValue();$('editor').showModal();keepAttachments();setTimeout(()=>$('titleInput').focus(),40);
}
async function closeEditor() {if(draftValue()!==savedDraft&&!await confirmAction('放弃未保存的内容？','本次编辑尚未保存。已保存的记录不会受到影响。','放弃编辑'))return;$('editor').close();}
function attachmentRows(files,removable=false){return files.map((a,index)=>`<div class="attachment-row">${/^image\/(png|jpeg|gif|webp)$/.test(a.type)?`<img src="/images/${a.id}" alt="${esc(a.name)}">`:'<span>▤</span>'}<button type="button" class="attachment-location" data-folder="${a.id}" title="打开所在文件夹">${esc(a.name)}<small>${size(a.size)} · 打开所在文件夹 ↗</small></button>${removable?`<button type="button" data-remove="${index}" title="移除此附件">×</button>`:''}</div>`).join('');}
function renderAttachments() {$('attachments').innerHTML=attachmentRows(draftFiles,true);}

let uploading=false;
let draftTags=[],editingTag=-1;
let readingId=null,listScrollTop=0;
let readerIndexLibrary=null,readerIndexKey='',readerIndexActiveId=null,readerRenderedNote=null;
async function attachFiles(files) {if(uploading){toast('附件正在保存，请稍候');return;}if(!$('editor').open)openEditor(null,files[0]?.type.startsWith('image/')?'image':'file');uploading=true;$('saveNote').disabled=true;$('attachButton').disabled=true;try{for(const file of files){if(file.size>30*1024*1024){toast(`${file.name} 超过 30 MB，已跳过`);continue;}const saved=await api('/api/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});if(!draftFiles.some(a=>a.id===saved.id))draftFiles.push({...saved,name:file.name,type:file.type||'application/octet-stream'});if(!$('titleInput').value)$('titleInput').value=file.name.replace(/\.[^.]+$/,'');renderAttachments();}toast('附件已加入，保存记录后完成收集');}catch(e){toast(e.message);}finally{uploading=false;$('saveNote').disabled=false;$('attachButton').disabled=false;}}
async function saveNote(event) {event.preventDefault();$('editorError').hidden=true;if(uploading||busy)return;if(editingTag>=0&&!commitTag())return;const title=$('titleInput').value.trim(),body=$('bodyInput').value;if(!title&&!body.trim()&&!draftFiles.length){toast('先写一点内容，或添加一个附件');$('titleInput').focus();return;}const next=structuredClone(library),old=next.notes.find(n=>n.id===editing),now=Date.now();const note={...old,id:old?.id||crypto.randomUUID(),title:title||body.trim().split('\n')[0].slice(0,50)||'未命名附件',body,type:$('typeInput').value,category:$('categoryInput').value,tags:[...draftTags],starred:$('starInput').checked,pinned:$('pinInput').checked,created:old?.created||now,updated:now,deleted:old?.deleted||false,attachments:structuredClone(draftFiles)};if(old)next.notes[next.notes.indexOf(old)]=note;else next.notes.unshift(note);setEditorBusy(true);try{await persist(next);$('editor').close();toast('已保存到本地目录 · 自动快照已保留');}catch(e){$('editorError').textContent=e.message;$('editorError').hidden=false;toast(e.message);}finally{setEditorBusy(false);}}
async function cardAction(id,action){if(busy)return;if(action==='edit'){const note=library.notes.find(n=>n.id===id);if(note)openEditor(note);return;}const next=structuredClone(library),note=next.notes.find(n=>n.id===id);if(!note)return;if(action==='star')note.starred=!note.starred;else if(action==='restore')note.deleted=false;else if(action==='delete'){if(note.deleted){if(!await confirmAction('永久删除这条记录？','记录将从回收站移除，最近的快照仍可找回。附件暂时保留，不会破坏历史快照。','永久删除'))return;next.notes=next.notes.filter(n=>n.id!==id);}else note.deleted=true;}note.updated=Date.now();try{await persist(next);toast(action==='star'?'收藏状态已更新':action==='restore'?'已恢复记录':'已删除 · 操作前已保留快照');}catch(e){toast(e.message);}}
async function snapshots(){try{const list=await api('/api/snapshots');$('snapshotList').innerHTML=list.length?list.map(s=>`<div class="snapshot-item"><div><strong>${esc(new Date(s.time).toLocaleString('zh-CN'))}</strong><small>${esc(s.reason)} · ${s.count} 条记录</small></div><button data-snapshot="${s.id}">恢复此状态</button></div>`).join(''):'<p class="excerpt">还没有快照，保存第一条记录时会自动创建。</p>';if(!$('snapDialog').open)$('snapDialog').showModal();}catch(e){toast(e.message);}}
function pickFiles(accept=''){ $('fileInput').accept=accept;$('fileInput').value='';$('fileInput').click(); }
$('newNote').onclick=$('quickNote').onclick=$('quickAdd').onclick=$('emptyNew').onclick=()=>openEditor();
$('uploadImage').onclick=()=>pickFiles('image/*');$('uploadFile').onclick=$('attachButton').onclick=()=>pickFiles();
$('fileInput').onchange=event=>attachFiles([...event.target.files]);$('closeEditor').onclick=$('cancelEditor').onclick=()=>{if(!uploading&&!busy)closeEditor();else toast('正在保存，请稍候');};$('editor').oncancel=e=>{e.preventDefault();if(!uploading&&!busy)closeEditor();};$('noteForm').onsubmit=saveNote;
$('attachments').onclick=e=>{const folder=e.target.closest('[data-folder]');if(folder){openAttachmentFolder(folder.dataset.folder);return;}const b=e.target.closest('[data-remove]');if(b){draftFiles.splice(Number(b.dataset.remove),1);renderAttachments();}};
$('nav').onclick=e=>{const b=e.target.closest('[data-view]');if(!b)return;if(b.dataset.view==='snapshots')return snapshots();view=b.dataset.view;category='';tag='';type='all';render();};
$('categories').onclick=e=>{const b=e.target.closest('[data-category]');if(!b)return;category=b.dataset.category;view='all';tag='';render();};
$('addCategory').onclick=()=>{$('categoryName').value='';$('categoryError').hidden=true;$('categoryDialog').showModal();$('categoryName').focus();};
$('cancelCategory').onclick=()=>$('categoryDialog').close();
$('categoryForm').onsubmit=async e=>{e.preventDefault();const name=$('categoryName').value.trim();if(!name)return;if(library.categories.includes(name)||name==='未分类'){$('categoryError').textContent='这个分类已存在';$('categoryError').hidden=false;return;}$('saveCategory').disabled=true;try{const next=structuredClone(library);next.categories.push(name);await persist(next);$('categoryDialog').close();toast('分类已创建');}catch(error){$('categoryError').textContent=error.message;$('categoryError').hidden=false;}finally{$('saveCategory').disabled=false;}};
$('filters').onclick=e=>{const b=e.target.closest('[data-type]');if(b){type=b.dataset.type;render();}};$('stats').onclick=e=>{const b=e.target.closest('[data-filter]');if(b){type=b.dataset.filter;view='all';category='';tag='';render();}};
$('search').oninput=()=>{if(view==='trash'){render();return;}view='all';category='';tag='';type='all';render();};$('clearSearch').onclick=()=>{$('search').value='';render();$('search').focus();};$('sort').onchange=render;$('gridView').onclick=()=>setListView(false);$('listView').onclick=()=>setListView(true);

$('cards').onclick=e=>{const card=e.target.closest('[data-id]');if(!card)return;const folder=e.target.closest('[data-folder]');if(folder){openAttachmentFolder(folder.dataset.folder);return;}const action=e.target.closest('[data-action]'),tagButton=e.target.closest('[data-tag]');if(action)return cardAction(card.dataset.id,action.dataset.action);if(tagButton){tag=tagButton.dataset.tag;render();return;}openReader(card.dataset.id);};$('cards').onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('card')){e.preventDefault();openReader(e.target.dataset.id);}};$('activeTag').onclick=()=>{tag='';render();};
$('backup').onclick=()=>{window.location.href='/api/backup';toast('正在导出压缩备份，包含记录、附件和最近快照');};$('restoreInput').accept='.gz,application/gzip';$('restore').onclick=()=>{$('restoreInput').value='';$('restoreInput').click();};$('restoreInput').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(!await confirmAction('恢复完整备份？','备份将替换当前记录与分类。当前状态会先保留为快照，附件不会立即清理。','恢复备份'))return;try{toast('正在校验并恢复备份…');await api('/api/import',{method:'POST',body:file});await load();toast('备份已恢复');}catch(error){toast(error.message);}};
$('closeSnapshots').onclick=()=>$('snapDialog').close();$('createSnapshot').onclick=async()=>{try{await api('/api/snapshots',{method:'POST'});await snapshots();await storage();toast('当前状态已保存为快照');}catch(e){toast(e.message);}};
$('snapshotList').onclick=async e=>{const b=e.target.closest('[data-snapshot]');if(!b)return;if(!await confirmAction('回到这个快照？','记录、分类及回收站将恢复为该时间点的状态。当前状态会先自动保存为快照。','恢复快照'))return;try{await api('/api/restore-snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.snapshot})});await load();await snapshots();toast('已恢复快照 · 恢复前的状态也已保留');}catch(error){toast(error.message);}};
document.addEventListener('keydown',e=>{const typing=/INPUT|TEXTAREA|SELECT/.test(e.target.tagName);if($('editor').open&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();$('noteForm').requestSubmit();}else if(!document.querySelector('dialog[open]')&&!typing){if(e.key.toLowerCase()==='n'){e.preventDefault();openEditor();}}});
document.addEventListener('paste',e=>{if(document.querySelector('dialog[open]:not(#editor)'))return;const files=[...e.clipboardData.items].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();attachFiles(files);}});
document.addEventListener('dragenter',e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();dragDepth++;$('dropOverlay').hidden=false;});document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});document.addEventListener('dragleave',e=>{e.preventDefault();if(--dragDepth<=0){dragDepth=0;$('dropOverlay').hidden=true;}});document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('dropOverlay').hidden=true;if(e.dataTransfer.files.length&&!document.querySelector('dialog[open]:not(#editor)'))attachFiles([...e.dataTransfer.files]);});
window.addEventListener('beforeunload',e=>{if(uploading||($('editor').open&&draftValue()!==savedDraft)){e.preventDefault();e.returnValue='';}});
$('dateLabel').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
const mobile=document.createElement('div');mobile.className='mobile-tools';mobile.innerHTML='<button id="mobileCategory">新建分类</button><button id="mobileBackup">导出备份</button><button id="mobileRestore">恢复备份</button><button id="mobileSnapshots">时光快照</button>';document.querySelector('.sidebar').append(mobile);$('mobileCategory').onclick=()=>$('addCategory').click();$('mobileBackup').onclick=()=>$('backup').click();$('mobileRestore').onclick=()=>$('restore').click();$('mobileSnapshots').onclick=snapshots;
load().catch(e=>{toast(e.message);$('storage').textContent='本地服务未连接';$('cards').innerHTML='<div class="empty"><h3>请通过本地服务打开MarkDown</h3><p>双击 start.cmd，然后访问 http://localhost:3210</p></div>';});

$('cleanupFiles').onclick=async()=>{if(uploading||$('editor').open){toast('请先保存或关闭正在编辑的记录');return;}if(!await confirmAction('安全清理闲置附件？','只清理当前记录、回收站和所有保留快照均未引用的附件。此清理不可撤销。','清理附件'))return;try{const result=await api('/api/cleanup',{method:'POST'});await storage();toast('已清理 '+result.count+' 个闲置附件，释放 '+size(result.bytes));}catch(e){toast(e.message);}};

function setEditorBusy(value){for(const el of $('noteForm').querySelectorAll('input,textarea,select,button'))el.disabled=value;}
async function keepAttachments(){if(!$('editor').open||!draftFiles.length)return;try{await api('/api/attachments/keep',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:draftFiles.map(a=>a.id)})});}catch(e){$('editorError').textContent=e.message;$('editorError').hidden=false;}}
setInterval(keepAttachments,60000);

async function openAttachmentFolder(id){try{await api('/api/open-folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});toast('已在资源管理器中定位附件');}catch(e){toast(e.message);}}

function tagDraftValue(){
 const tags=[...draftTags],input=$('tagsInput'),value=input?.value.trim().replace(/^#\s*/,'');
 if(value&&editingTag>=0){if(editingTag<tags.length)tags[editingTag]=value;else tags.push(value);}
 return tags;
}
function renderTagChips(){
 const input=value=>`<span class="tag-prefix">#</span><input id="tagsInput" class="tag-inline-input" value="${esc(value)}" size="${Math.min(28,Math.max(5,value.length*2))}" placeholder="新标签" aria-label="标签内容" autocomplete="off">`;
 $('tagChips').innerHTML=draftTags.map((value,index)=>`<span class="editable-tag ${editingTag===index?'editing':''}">${editingTag===index?input(value):`<button type="button" data-tag-edit="${index}" title="点击修改标签"># ${esc(value)}</button>`}<button type="button" data-tag-remove="${index}" aria-label="移除标签 ${esc(value)}">×</button></span>`).join('')+(editingTag===draftTags.length?`<span class="editable-tag editing new-tag">${input('')}</span>`:'')+'<button type="button" id="addTag" class="tag-add" aria-label="新增标签" title="新增标签">＋</button>';
}
function commitTag(){
 if(editingTag<0)return true;
 const input=$('tagsInput'),value=input?.value.trim().replace(/^#\s*/,'')||'';
 if(value&&draftTags.some((tag,index)=>tag===value&&index!==editingTag)){$('tagError').textContent='这个标签已存在';$('tagError').hidden=false;input.setAttribute('aria-invalid','true');return false;}
 if(value){if(editingTag<draftTags.length)draftTags[editingTag]=value;else draftTags.push(value);}
 editingTag=-1;$('tagError').hidden=true;renderTagChips();return true;
}
function focusTagInput(){const input=$('tagsInput');if(input){input.focus();input.select();}}
$('tagChips').onpointerdown=e=>{if(e.target.closest('button')&&$('tagsInput'))e.preventDefault();};
$('tagChips').onclick=e=>{
 const edit=e.target.closest('[data-tag-edit]'),remove=e.target.closest('[data-tag-remove]'),add=e.target.closest('#addTag');
 if(remove){const index=Number(remove.dataset.tagRemove);if(index!==editingTag&&!commitTag()){focusTagInput();return;}draftTags.splice(index,1);editingTag=-1;$('tagError').hidden=true;renderTagChips();return;}
 if(!edit&&!add)return;
 if(!commitTag()){focusTagInput();return;}
 editingTag=add?draftTags.length:Number(edit.dataset.tagEdit);renderTagChips();focusTagInput();
};
$('tagChips').oninput=e=>{if(e.target.id==='tagsInput'){e.target.size=Math.min(28,Math.max(5,e.target.value.length*2));e.target.removeAttribute('aria-invalid');$('tagError').hidden=true;}};
$('tagChips').addEventListener('focusout',e=>{if(e.target.id==='tagsInput'&&!busy)commitTag();});
$('tagChips').onkeydown=e=>{
 if(e.target.id!=='tagsInput'||e.isComposing)return;
 if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(e.ctrlKey||e.metaKey)$('noteForm').requestSubmit();else if(commitTag())$('addTag').focus();}
 if(e.key==='Escape'){e.preventDefault();e.stopPropagation();editingTag=-1;$('tagError').hidden=true;renderTagChips();$('addTag').focus();}
};

function applyTheme(theme){const selected=['fresh','warm','blue','dark'].includes(theme)?theme:'fresh';document.documentElement.dataset.theme=selected;document.documentElement.style.colorScheme=selected==='dark'?'dark':'light';$('themeSelect').value=selected;}
$('themeSelect').onchange=async()=>{const previous=document.documentElement.dataset.theme||'fresh',theme=$('themeSelect').value;$('themeSelect').disabled=true;applyTheme(theme);try{await api('/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme})});}catch(e){applyTheme(previous);toast(e.message);}finally{$('themeSelect').disabled=false;}};
$('themeSelect').disabled=true;api('/api/preferences').then(value=>applyTheme(value.theme)).catch(()=>applyTheme('fresh')).finally(()=>$('themeSelect').disabled=false);

function renderReader(filtered=null){
 const note=library.notes.find(n=>n.id===readingId);
 if(!note){closeReader();return;}
 renderReaderIndex(note,filtered);
 $('crumb').textContent='阅读预览';
 if(readerRenderedNote===note)return;readerRenderedNote=note;
 $('readerTitle').textContent=note.title||'无标题记录';
 $('readerMeta').textContent=[note.deleted?'回收站':note.category||'未分类', {text:'文字笔记',sticky:'灵感便签',image:'截图 / 图片',file:'文件资料'}[note.type],new Date(note.updated).toLocaleString('zh-CN')+' 更新','约 '+note.body.length.toLocaleString()+' 字'].join(' · ');
 $('readerTags').innerHTML=note.tags.map(t=>`<span class="tag"># ${esc(t)}</span>`).join('');$('readerTags').hidden=!note.tags.length;
 const body=$('readerBody');body.replaceChildren();
 if(!note.body){body.textContent='这条记录暂时没有正文。';body.classList.add('reader-empty');}else{
  body.classList.remove('reader-empty');let end=0;const links=/https?:\/\/[^\s<>"']+/g;let match;
  while((match=links.exec(note.body))!==null){body.append(document.createTextNode(note.body.slice(end,match.index)));const link=document.createElement('a');link.href=match[0];link.textContent=match[0];link.target='_blank';link.rel='noopener noreferrer';body.append(link);end=match.index+match[0].length;}
  body.append(document.createTextNode(note.body.slice(end)));
 }
 $('copyReaderBody').disabled=!note.body;
 $('readerImages').innerHTML=note.attachments.filter(a=>/^image\/(png|jpeg|gif|webp)$/.test(a.type)).map(a=>`<figure><img src="/images/${a.id}" alt="${esc(a.name)}" loading="lazy"><figcaption>${esc(a.name)}</figcaption></figure>`).join('');
 $('readerAttachments').hidden=!note.attachments.length;$('readerFiles').innerHTML=attachmentRows(note.attachments);
}
function openReader(id){if(!library.notes.some(n=>n.id===id))return;if(!readingId)listScrollTop=window.scrollY;readingId=id;document.body.classList.add('reading-mode');$('libraryWorkspace').hidden=true;$('reader').hidden=false;renderReader();$('readerMain').scrollTop=0;window.scrollTo(0,0);$('readerTitle').focus({preventScroll:true});}
function closeReader(){if(!readingId)return;readingId=null;readerRenderedNote=null;readerIndexActiveId=null;document.body.classList.remove('reading-mode');$('reader').hidden=true;$('libraryWorkspace').hidden=false;$('crumb').textContent=category||{all:'全部内容',starred:'我的收藏',recent:'最近记录',trash:'回收站'}[view]||'全部内容';render();window.scrollTo(0,listScrollTop);}
$('readerTitle').tabIndex=-1;
$('backToLibrary').onclick=closeReader;
$('editReader').onclick=()=>{const note=library.notes.find(n=>n.id===readingId);if(note)openEditor(note);};
$('copyReaderBody').onclick=async()=>{const note=library.notes.find(n=>n.id===readingId);if(!note)return;try{await navigator.clipboard.writeText(note.body);toast('正文已复制');}catch{toast('无法访问剪贴板，请选中正文手动复制');}};
$('readerFiles').onclick=e=>{const button=e.target.closest('[data-folder]');if(button)openAttachmentFolder(button.dataset.folder);};

function setListView(list){
 $('cards').classList.toggle('list',list);
 for(const [gridId,listId] of [['gridView','listView'],['readerGridView','readerListView']]){for(const [id,active] of [[gridId,!list],[listId,list]]){$(id).classList.toggle('active',active);$(id).setAttribute('aria-pressed',String(active));}}
 if(readingId)renderReaderIndex(library.notes.find(note=>note.id===readingId));
}
function renderReaderIndex(current,filtered=null){
 if(!current)return;
 const list=$('readerIndexList'),listMode=$('cards').classList.contains('list'),key=JSON.stringify([view,category,type,tag,$('search').value,$('sort').value]),libraryChanged=readerIndexLibrary!==library;
 if($('readerSearch').value!==$('search').value)$('readerSearch').value=$('search').value;
 $('readerClearSearch').disabled=!$('search').value;$('readerSort').value=$('sort').value;
 const categories=[...new Set(['未分类',...library.categories,...library.notes.map(note=>note.category||'未分类')])];
 if(libraryChanged)$('readerCategory').innerHTML='<option value="">全部分类</option>'+categories.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
 $('readerCategory').value=category;
 $('readerTypes').innerHTML=Object.entries(kinds).map(([id,[name]])=>`<button type="button" data-reader-type="${id}" class="${type===id?'active':''}" aria-pressed="${type===id}">${name}</button>`).join('');
 $('readerTagScope').hidden=!tag;$('readerTagScope').textContent='标签：# '+tag+' ×';
 const notes=filtered||getFilteredNotes();
 $('readerIndexTitle').textContent={all:'全部内容',starred:'我的收藏',recent:'最近记录',trash:'回收站'}[view]||'全部内容';$('readerIndexCount').textContent=notes.length;
 $('readerFilteredNotice').hidden=notes.some(note=>note.id===readingId);
 if(libraryChanged||readerIndexKey!==key){
  const scroll=readerIndexKey===key?list.scrollTop:0;
  list.innerHTML=notes.length?notes.map(note=>{const image=note.attachments.find(a=>/^image\/(png|jpeg|gif|webp)$/.test(a.type));return `<button type="button" class="reader-index-item ${image?'has-image':''}" data-reader-id="${esc(note.id)}"><span class="reader-index-icon">${image?`<img src="/images/${image.id}" alt="" loading="lazy">`:kinds[note.type][1]}</span><span class="reader-index-summary"><strong>${esc(note.title||'无标题记录')}</strong><span class="reader-index-excerpt">${esc(note.body.slice(0,240).replace(/\s+/g,' ').slice(0,80)||'暂无正文')}</span><small>${esc(note.category||'未分类')} · ${date(note.updated)}</small></span></button>`;}).join(''):'<div class="reader-index-empty">没有找到相关记录<button type="button" data-reader-reset>清除筛选</button></div>';
  list.scrollTop=scroll;readerIndexLibrary=library;readerIndexKey=key;
 }
 list.classList.toggle('grid',!listMode);
 for(const [id,active] of [['readerGridView',!listMode],['readerListView',listMode]]){$(id).classList.toggle('active',active);$(id).setAttribute('aria-pressed',String(active));}
 for(const button of list.querySelectorAll('[data-reader-id]')){const active=button.dataset.readerId===readingId;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
 if(readerIndexActiveId!==readingId||libraryChanged){const active=list.querySelector('[aria-current="page"]');if(active){const item=active.getBoundingClientRect(),panel=list.getBoundingClientRect();if(item.top<panel.top)list.scrollTop+=item.top-panel.top;else if(item.bottom>panel.bottom)list.scrollTop+=item.bottom-panel.bottom;}}
 readerIndexActiveId=readingId;
}
function resetReaderFilters(){category='';type='all';tag='';$('search').value='';render();}
$('readerIndexList').onclick=e=>{if(e.target.closest('[data-reader-reset]'))return resetReaderFilters();const button=e.target.closest('[data-reader-id]');if(button&&button.dataset.readerId!==readingId)openReader(button.dataset.readerId);};
$('readerSearch').oninput=()=>{$('search').value=$('readerSearch').value;render();};
$('readerClearSearch').onclick=()=>{$('search').value='';render();$('readerSearch').focus();};
$('readerTypes').onclick=e=>{const button=e.target.closest('[data-reader-type]');if(button){type=button.dataset.readerType;render();}};
$('readerCategory').onchange=()=>{category=$('readerCategory').value;render();};
$('readerSort').onchange=()=>{$('sort').value=$('readerSort').value;render();};
$('readerTagScope').onclick=()=>{tag='';render();};
$('readerGridView').onclick=()=>setListView(false);$('readerListView').onclick=()=>setListView(true);
