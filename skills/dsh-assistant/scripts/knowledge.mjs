// Local application evidence, never the host assistant's memory store.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const day=86400000;
const accepted=new Set(['accepted','accepted_with_changes']);
const terminal=new Set(['returned','accepted','rejected','cancelled','failed','timeout','validation_failed','budget_exceeded','history_incomplete']);
const scope=x=>x?path.resolve(x).replaceAll('\\','/').replace(/\/$/,'').toLowerCase():null;
async function json(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function atomic(file,value){const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(value,null,2),{flag:'wx'});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}}
async function sources(root){
 const rows=[];
 async function scan(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(!e.isFile()||!e.name.endsWith('.json')||e.name==='engine.json')continue;const file=path.join(dir,e.name);try{const raw=await fs.readFile(file);const log=JSON.parse(raw);if(log.id&&log.status)rows.push({file,relative:path.relative(root,file).replaceAll('\\','/'),log,raw});}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}}}
 await scan(root);
 const workers=path.join(root,'workers');for(const e of await fs.readdir(workers,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;}))if(e.isDirectory()&&!e.isSymbolicLink())await scan(path.join(workers,e.name));
 const engine=await json(path.join(root,'engine.json'),{jobs:[]});
 for(const log of engine.jobs||[])rows.push({relative:'engine.json#'+log.id,log});
 return rows;
}
function safeArchive(root,name){if(typeof name!=='string'||!/^log-[a-f0-9]{64}\.json\.gz$/.test(name))throw Error('Invalid archive reference');return path.join(root,'archive',name);}
async function snapshot(root){
 const live=await sources(root),index=await json(path.join(root,'archive','index.json'),{entries:[]}),archived=[];
 for(const entry of index.entries){const raw=gunzipSync(await fs.readFile(safeArchive(root,entry.file)));if(digest(raw)!==entry.sha256)throw Error('Archive checksum mismatch');archived.push({relative:entry.source,log:JSON.parse(raw),raw,archived:true,entry});}
 // A newer review in a live file always supersedes its archived copy.
 const bySource=new Map(archived.map(x=>[x.relative,x]));for(const x of live)bySource.set(x.relative,x);
 return {rows:[...bySource.values()],live,index};
}
async function entriesFor(rows,workspace){
 const entries=new Map();
 // A controller review overrides mirrored worker evidence, including rejection.
 const controlled=new Map();for(const x of rows.filter(x=>x.relative.startsWith('engine.json#'))){controlled.set(x.log.id,x);for(const log of [...(x.log.attemptLogs||[]),x.log.log].filter(Boolean))if(log.id)controlled.set(log.id,x);}
 for(const row of rows){const l=row.log,r=l.review,w=scope(l.workspace||l.task?.workspace);if(!w||!accepted.has(r?.outcome)||typeof r.evidence!=='string'||!r.evidence.trim()||!r.at||l.cancelConfirmed===false)continue;
  if(controlled.has(l.id)&&controlled.get(l.id)!==row)continue;
  let artifact=null;
  if(r.artifact){try{const raw=await fs.readFile(r.artifact.path);if(digest(raw)!==r.artifact.sha256)continue;artifact={path:path.resolve(r.artifact.path),sha256:r.artifact.sha256};}catch{continue;}}
  if(r.outcome==='accepted_with_changes'&&!artifact)continue;
  const texts=Array.isArray(r.lessons)?r.lessons.filter(x=>typeof x==='string'&&x.trim()):[r.evidence];
  for(const text of texts){const content=text.trim().slice(0,4000),id=digest(w+'\n'+content);const provenance={taskId:l.id,source:row.relative,reviewedAt:r.at,outcome:r.outcome,evidence:r.evidence.slice(0,4000),artifact,resultSha256:typeof l.result==='string'?digest(l.result):null};
   if(!entries.has(id))entries.set(id,{id,workspace:w,kind:'reviewed_evidence',text:content,provenance:[]});entries.get(id).provenance.push(provenance);
  }
 }
 return [...entries.values()];
}
function aggregate(rows){const out={tasks:0,reviewed:0,accepted:0,acceptedWithChanges:0,rejected:0,pending:0,calls:0,elapsedMs:0,observedToolCalls:0,unknownUsageTasks:0,queueWaitMs:0,reviewWaitMs:0,corrections:0,usage:{},cost:'unknown',byStatus:{}};
 // Engine jobs mirror worker logs; count each task only once, preferring engine review.
 const mirrors=new Set(rows.filter(x=>x.relative.startsWith('engine.json#')).flatMap(x=>[...(x.log.attemptLogs||[]),x.log.log].filter(Boolean).map(l=>l.id)).filter(Boolean));
 const unique=new Map();for(const row of rows){if(!row.relative.startsWith('engine.json#')&&mirrors.has(row.log.id))continue;const old=unique.get(row.log.id);if(!old||row.relative.startsWith('engine.json#'))unique.set(row.log.id,row.log);}
 for(const l of unique.values()){const raw=l.log||l;out.tasks++;out.byStatus[l.status]=(out.byStatus[l.status]||0)+1;const r=l.review?.outcome;if(accepted.has(r)||r==='rejected'){out.reviewed++;if(r==='accepted')out.accepted++;if(r==='accepted_with_changes')out.acceptedWithChanges++;if(r==='rejected')out.rejected++;}else out.pending++;
  const attempts=l.attemptLogs?.length?l.attemptLogs:[raw];for(const a of attempts){for(const k of ['calls','elapsedMs','observedToolCalls'])out[k]+=Number.isFinite(a[k])?a[k]:0;if(!a.usageDelta)out.unknownUsageTasks++;else for(const [k,v]of Object.entries(a.usageDelta))if(Number.isFinite(v))out.usage[k]=(out.usage[k]||0)+v;}
  out.corrections+=(l.events||[]).filter(e=>e.type==='correction').length;out.reviewWaitMs+=l.reviewWaitMs||0;const wait=Date.parse(l.startedAt)-Date.parse(l.createdAt);if(Number.isFinite(wait))out.queueWaitMs+=Math.max(0,wait);
 }
 out.acceptanceRate=out.reviewed?(out.accepted+out.acceptedWithChanges)/out.reviewed:null;return out;
}
export async function maintain(root,options={}){
 root=path.resolve(root);await fs.mkdir(root,{recursive:true});const lockFile=path.join(root,'knowledge.lock'),lock=await fs.open(lockFile,'wx');
 try{
  const now=options.now===undefined?Date.now():new Date(options.now).getTime(),retention=options.retentionDays??30,archiveRetention=options.archiveRetentionDays??180;
  if(!Number.isFinite(now)||![retention,archiveRetention].every(x=>Number.isFinite(x)&&x>=0))throw Error('Invalid retention settings');
  const data=await snapshot(root);const dir=path.join(root,'knowledge');await fs.mkdir(dir,{recursive:true});await fs.mkdir(path.join(root,'archive'),{recursive:true});
  let archived=0,deleted=0;
  for(const row of data.live){const l=row.log,at=Date.parse(l.finishedAt||l.startedAt),reviewed=accepted.has(l.review?.outcome)||l.review?.outcome==='rejected';
   if(!row.file||!terminal.has(l.status)||!reviewed||l.cancelConfirmed===false||!Number.isFinite(at)||now-at<retention*day)continue;
   // Never remove a log referenced as another task's review artifact.
   if(data.rows.some(x=>path.resolve(x.log.review?.artifact?.path||root)===row.file))continue;
   const sha256=digest(row.raw),file='log-'+sha256+'.json.gz';await fs.writeFile(safeArchive(root,file),gzipSync(row.raw));
   if(!data.index.entries.some(e=>e.source===row.relative&&e.sha256===sha256))data.index.entries.push({source:row.relative,file,sha256,taskId:l.id,workspace:scope(l.workspace||options.workspace),archivedAt:new Date(now).toISOString()});
   // Commit archive manifest before unlink, and refuse to remove a concurrently changed log.
   await atomic(path.join(root,'archive','index.json'),data.index);
   if(digest(await fs.readFile(row.file))===sha256){await fs.unlink(row.file);archived++;}
  }
  if(options.cleanup===true){const keep=[],remove=[];for(const e of data.index.entries){const referenced=data.rows.some(x=>path.resolve(x.log.review?.artifact?.path||root)===safeArchive(root,e.file));if(!referenced&&now-Date.parse(e.archivedAt)>archiveRetention*day)remove.push(e);else keep.push(e);}data.index.entries=keep;await atomic(path.join(root,'archive','index.json'),data.index);for(const e of remove){if(!keep.some(x=>x.file===e.file))await fs.rm(safeArchive(root,e.file),{force:true});deleted++;}}
  const current=await snapshot(root),entries=await entriesFor(current.rows,options.workspace),summary=aggregate(current.rows);
  await atomic(path.join(dir,'index.json'),{version:1,updatedAt:new Date(now).toISOString(),entries});await atomic(path.join(dir,'metrics.json'),summary);
  return {entries:entries.length,archived,deleted,metrics:summary};
 }finally{await lock.close();await fs.unlink(lockFile);}
}
export async function recall(root,{query='',workspace,limit=10}={}){
 if(!workspace)throw Error('Workspace required');if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Limit must be 1..100');
 // Revalidate current reviews/hashes on every read so rejection is immediately effective.
 const index=await json(path.join(root,'knowledge','index.json'),{entries:[]});const {rows}=await snapshot(root);const valid=await entriesFor(rows,workspace),ids=new Set(valid.map(e=>e.id)),terms=String(query).toLowerCase().split(/\s+/).filter(Boolean);
 return index.entries.filter(e=>e.workspace===scope(workspace)&&ids.has(e.id)).map(e=>({...valid.find(x=>x.id===e.id),score:terms.reduce((n,t)=>n+(e.text.toLowerCase().includes(t)?1:0),0)})).filter(e=>!terms.length||e.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
}
export async function metrics(root){return aggregate((await snapshot(root)).rows);}
