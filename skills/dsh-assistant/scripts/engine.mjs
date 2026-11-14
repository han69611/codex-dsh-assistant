import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {DshClient} from './dsh.mjs';import {loadMode,checkScope,reserveCall} from './coordination.mjs';import {assess} from './policy.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const done=new Set(['accepted','cancelled','rejected']);
async function read(root){try{return JSON.parse(await fs.readFile(path.join(root,'engine.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return {version:1,concurrency:2,jobs:[]};throw e;}}
async function transaction(root,fn){await fs.mkdir(root,{recursive:true});let lock;for(let i=0;i<200;i++){try{lock=await fs.open(path.join(root,'engine.lock'),'wx');break;}catch(e){if(e.code!=='EEXIST'||i===199)throw e;await new Promise(r=>setTimeout(r,10));}}try{const state=await read(root);const result=await fn(state);await fs.writeFile(path.join(root,'engine.json.tmp'),JSON.stringify(state,null,2));await fs.rename(path.join(root,'engine.json.tmp'),path.join(root,'engine.json'));return result;}finally{await lock.close();await fs.unlink(path.join(root,'engine.lock'));}}
function conflict(a,b){return (a.writeScope||[]).some(x=>(b.writeScope||[]).some(y=>x===y||x.startsWith(y+path.sep)||y.startsWith(x+path.sep)));}
async function admission(root,fn){let lock;for(let i=0;i<200;i++){try{lock=await fs.open(path.join(root,'active.lock'),'wx');break;}catch(e){if(e.code!=='EEXIST'||i===199)throw e;await new Promise(r=>setTimeout(r,10));}}try{return await fn();}finally{await lock.close();await fs.unlink(path.join(root,'active.lock'));}}
export class Engine {
 constructor(root,deps={}){this.root=root;this.deps=deps;this.children=new Map();}
 async list(){return read(this.root);}
 async configure(concurrency){if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw Error('Concurrency must be 1..8');return transaction(this.root,s=>s.concurrency=concurrency);}
 async enqueue(file,{executor='dsh',role='executor',dependsOn=[],priority=0,writeScope=[]}={}){
  const raw=await fs.readFile(file,'utf8'),task=JSON.parse(raw);const grant=await checkScope(this.root,file,executor==='dsh'?task:{...task,routing:{kind:'classify'}});
  if(!['dsh','script','codex'].includes(executor)||!['executor','critic'].includes(role))throw Error('Unknown executor/role');
  const base=await fs.realpath(grant.workspace);const scopes=writeScope.map(p=>path.resolve(base,p));for(const p of scopes){const rel=path.relative(base,p);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Write scope outside project');}
  const assessment=assess(task);const duplicateKey=hash(JSON.stringify({goal:task.goal,input:task.input,deliverable:task.deliverable,acceptance:task.acceptance,executor,role}));
  return transaction(this.root,s=>{
   const duplicate=s.jobs.find(j=>j.key===duplicateKey&&!['rejected','cancelled'].includes(j.status));if(duplicate)return {...duplicate,deduplicated:true};
   if(dependsOn.some(id=>!s.jobs.some(j=>j.id===id)))throw Error('Unknown dependency');
   const id='Q-'+crypto.randomUUID();task.id=id;
   const j={id,key:duplicateKey,task,originalFile:path.resolve(file),workspace:base,userRequest:grant.userRequest,executor,role,dependsOn,priority,writeScope:scopes,createdAt:new Date().toISOString(),status:executor==='codex'||(executor==='dsh'&&!assessment.delegate)?'needs_codex':'queued',assessment,attempt:0,events:[]};
   if(j.status==='needs_codex')j.reason=assessment.reason||'Complex work stays with Codex';s.jobs.push(j);return j;
  });
 }
 async patch(id,fn){return transaction(this.root,s=>{const j=s.jobs.find(j=>j.id===id);if(!j)throw Error('Unknown job');fn(j);return j;});}
 async recover(){const p=path.join(this.root,'pump.lock');try{const pid=Number(await fs.readFile(p,'utf8'));if(!pid)throw Error('Invalid pump owner; inspect lock');let alive=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}if(alive)throw Error('Queue pump is still alive');await fs.unlink(p);}catch(e){if(e.code!=='ENOENT')throw e;}return transaction(this.root,s=>{for(const j of s.jobs.filter(j=>j.status==='running')){j.status='cancel_pending';j.reason='Worker interrupted; confirm DSH stopped before Codex takeover';}return s.jobs;});}
 async cancel(id){const j=(await this.list()).jobs.find(j=>j.id===id);if(!j)throw Error('Unknown job');if(j.status!=='running')return this.patch(id,x=>{x.status='cancelled';});
  if(j.executor==='script'){this.children.get(id)?.kill();return this.patch(id,x=>{x.cancelRequested=true;x.status='cancel_pending';x.reason='Waiting for script worker exit';});}
  if(!j.workerDir)return this.patch(id,x=>{x.cancelRequested=true;x.events.push({type:'cancel_requested',at:new Date().toISOString()});});
  const dir=j.workerDir;await fs.writeFile(path.join(dir,id+'-A'+j.attempt+'.control.json'),JSON.stringify({cancel:true}));return this.patch(id,x=>{x.events.push({type:'cancel_requested',at:new Date().toISOString()});});
 }
 async allocate(id,patch,reason){if(!reason?.trim())throw Error('Reason required');const state=await this.list(),job=state.jobs.find(j=>j.id===id);if(!job)throw Error('Unknown job');const task={...job.task,...patch,budget:{...job.task.budget,...patch.budget},budgetReason:reason};assess(task);
  if(job.status==='running'){if(job.executor!=='dsh')throw Error('Only DSH budgets adjustable live');await fs.writeFile(path.join(job.workerDir,id+'-A'+job.attempt+'.control.json'),JSON.stringify({allocation:{...patch,budget:task.budget},reason,revision:crypto.randomUUID()}));}
  else if(job.status==='queued')await this.patch(id,j=>{j.task=task;j.events.push({type:'allocation',reason,at:new Date().toISOString()});});else throw Error('Job not active');
 }
 async correct(id,{reason,errorType='content',feedback,predictedSeconds=60,maxAttempts=2}={}){
  if(!reason||!feedback||!['content','format','missing-evidence','tool-failure'].includes(errorType)||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>5)throw Error('Correction needs type, feedback, reason and bounded attempts');
  return transaction(this.root,s=>{const j=s.jobs.find(j=>j.id===id);if(!j||!['awaiting_review','needs_codex'].includes(j.status))throw Error('Job not correctable');
   if(j.cancelConfirmed===false||j.attempt>=maxAttempts||errorType==='tool-failure'||predictedSeconds>(j.task.routing?.estimatedDirectSeconds||0)){j.status='needs_codex';j.reason='Correction not worthwhile or unsafe';return j;}
   j.events.push({type:'correction',errorType,feedback,reason,at:new Date().toISOString(),previousResult:j.result});j.task.input=JSON.stringify({original:j.task.input,previousResult:j.result,correction:feedback});j.status='queued';j.attempt++;return j;});
 }
 async review(id,outcome,evidence,artifact){const {review}=await import('./review.mjs');const j=(await this.list()).jobs.find(j=>j.id===id);if(!j||j.cancelConfirmed===false||!['awaiting_review','needs_codex'].includes(j.status))throw Error('Unsafe or invalid review state');const log={id:j.id,status:'returned',result:j.result,review:j.review,reviewHistory:j.reviewHistory,finishedAt:j.finishedAt};const reviewed=await review(log,outcome,evidence,artifact);return this.patch(id,x=>{x.review=reviewed.review;x.reviewHistory=reviewed.reviewHistory;x.reviewWaitMs=reviewed.reviewWaitMs;x.status=outcome==='rejected'?'rejected':'accepted';x.finishedAt=new Date().toISOString();});}
 async takeover(id,{result,artifact,evidence}){if(!evidence||(!result&&!artifact))throw Error('Codex completion and evidence required');const j=(await this.list()).jobs.find(j=>j.id===id);if(!j||!['needs_codex','awaiting_review'].includes(j.status)||j.cancelConfirmed===false)throw Error('Confirm old execution stopped first');await this.patch(id,x=>{x.result=result||'See Codex artifact';x.executor='codex';});return this.review(id,artifact?'accepted_with_changes':'accepted',evidence,artifact);}
 async confirm(id){const j=(await this.list()).jobs.find(j=>j.id===id);if(!j||j.status!=='cancel_pending')throw Error('Job not waiting for stop confirmation');const {client}=await DshClient.open();const s=(await client.listSessions()).find(s=>s.sessionId===j.sessionId);if(!s||s.running||Object.values(s.projections?.values?.inbox||{}).some(v=>Array.isArray(v)&&v.length))throw Error('DSH stop not confirmed');return this.patch(id,x=>{x.cancelConfirmed=true;x.status='needs_codex';});}
 async pump(){const {autoUpdate}=await import('./update.mjs');const update=await autoUpdate(this.root);if(update.status==='installed')throw Error('Plugin updated; rerun queue from new installation');const guard=await fs.open(path.join(this.root,'pump.lock'),'wx');await guard.writeFile(String(process.pid));try{
  while(true){const s=await this.list();const available=s.jobs.filter(j=>j.status==='queued');if(!available.length)break;
   for(const j of available){if(j.dependsOn.some(id=>['rejected','cancelled','needs_codex','cancel_pending'].includes(s.jobs.find(x=>x.id===id)?.status)))await this.patch(j.id,x=>{x.status='needs_codex';x.reason='Dependency failed';});}
   const fresh=await this.list(),batch=[];for(const j of fresh.jobs.filter(j=>j.status==='queued').sort((a,b)=>b.priority-a.priority)){if(batch.length>=fresh.concurrency)break;if(j.dependsOn.every(id=>fresh.jobs.some(x=>x.id===id&&x.status==='accepted'))&&!batch.some(x=>conflict(x,j)))batch.push(j);}
   const slots=Array.from({length:fresh.concurrency},(_,i)=>i).filter(slot=>!fresh.jobs.some(j=>['running','cancel_pending'].includes(j.status)&&j.slot===slot));
   if(!batch.length||!slots.length)break;await Promise.allSettled(batch.slice(0,slots.length).map((j,i)=>this.execute(j,slots[i])));
  }
 }finally{await guard.close();await fs.unlink(path.join(this.root,'pump.lock'));}return this.list();}
 async execute(job,slot){await this.patch(job.id,j=>{j.status='running';j.slot=slot;j.startedAt=new Date().toISOString();});
  try{
   let result;
   if(this.deps.execute)result=await this.deps.execute(job,slot);
   else if(job.executor==='script'){
    const script=await fs.realpath(path.resolve(job.workspace,job.task.script?.file||''));const rel=path.relative(job.workspace,script);if(rel.startsWith('..')||path.isAbsolute(rel)||!script.endsWith('.mjs'))throw Error('Script must be a scoped .mjs file');
    result=await this.process(job,process.execPath,[script,...(job.task.script.args||[])],job.workspace,{});
   }else{
    await admission(this.root,()=>reserveCall(this.root,job.originalFile,job.task));
    const dir=path.join(this.root,'workers',hash(job.workspace).slice(0,12)+'-'+slot);await fs.mkdir(dir,{recursive:true});await this.patch(job.id,j=>j.workerDir=dir);
    const {setup}=await import('./bootstrap.mjs');const ready=await setup({root:dir,cwd:job.workspace});if(ready.status!=='ready')throw Error(ready.action||ready.status);
    const config=JSON.parse(await fs.readFile(path.join(dir,'config.json')));await this.patch(job.id,j=>{j.sessionId=config.sessionId;});
    const task={...job.task,id:job.id+'-A'+job.attempt};if(job.role==='critic')task.goal='���������������ͬ���裬��ӭ�����з�����'+task.goal;
    const file=path.join(dir,task.id+'.task.json');await fs.writeFile(file,JSON.stringify(task));
    if((await this.list()).jobs.find(j=>j.id===job.id)?.cancelRequested){await this.patch(job.id,j=>{j.status='cancelled';j.cancelConfirmed=true;});return;}
    result=await this.process(job,process.execPath,[path.join(here,'run.mjs'),file,'--execute','--user-request',job.userRequest],job.workspace,{DSH_ASSISTANT_STATE_DIR:dir,DSH_ASSISTANT_SHARED_ROOT:this.root});
    await admission(this.root,async()=>{const {saveMode}=await import('./coordination.mjs');const mode=await loadMode(this.root);if(result.usageDelta)mode.inputTokens+=result.usageDelta.uncachedInputTokens+result.usageDelta.cacheReadTokens;else if(result.dispatchAttempted)mode.unknownUsageCalls=(mode.unknownUsageCalls||0)+1;mode.usedCalls+=Math.max(0,(result.calls||1)-1);await saveMode(this.root,mode);});
   }
   await this.patch(job.id,j=>{if(j.status==='cancelled')return;j.result=result.result||result.output;j.log=result;j.attemptLogs??=[];j.attemptLogs.push(result);j.sessionId=result.sessionId||j.sessionId;j.cancelConfirmed=job.executor==='script'?true:result.cancelConfirmed;j.status=job.executor==='script'&&j.cancelRequested?'cancelled':result.status==='returned'?'awaiting_review':result.cancelConfirmed===false?'cancel_pending':result.status==='cancelled'?'cancelled':'needs_codex';j.reason=result.error||result.status;j.finishedAt=new Date().toISOString();});
  }catch(e){await this.patch(job.id,j=>{j.status='needs_codex';j.reason=e.message;j.finishedAt=new Date().toISOString();});}
 }
 async process(job,command,args,cwd,env){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,env:{...process.env,...env},windowsHide:true});this.children.set(job.id,child);let output='';let failure;const timeout=job.executor==='script'?setTimeout(()=>{failure='Script timed out';child.kill();},job.task.timeoutMs||180000):null;const monitor=job.executor==='script'?setInterval(async()=>{try{if((await this.list()).jobs.find(j=>j.id===job.id)?.cancelRequested)child.kill();}catch{}},250):null;
  child.stdout.on('data',c=>{output+=c;if(output.length>2000000){failure='Worker output too large';child.kill();}});child.stderr.on('data',()=>{});child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);clearInterval(monitor);this.children.delete(job.id);if(failure)return resolve({status:'failed',error:failure});if(job.executor==='script')return resolve({status:code===0?'returned':'failed',result:output});try{resolve(JSON.parse(output));}catch{resolve({status:'failed',cancelConfirmed:false,error:'Worker exited without confirmed DSH termination'});}});});}
}
