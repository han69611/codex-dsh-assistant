import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,prepare,validId} from './state.mjs';
import {DshClient,dshRpc} from './dsh.mjs';
import {assess,allocate,contextTokens,rotationReason} from './policy.mjs';
import {idle,rotate,saveConfig} from './session.mjs';
import {setup} from './bootstrap.mjs';
import {validateContract,usageDelta} from './contracts.mjs';
import {invocation,preview} from './manual.mjs';
import {checkScope,reserveCall,loadMode,saveMode} from './coordination.mjs';
import {readHistory} from './history.mjs';import {recall} from './knowledge.mjs';
const pipelineStart=Date.now();
const raw=await fs.readFile(process.argv[2],'utf8');
const task=JSON.parse(raw);
const assessment=assess(task);
const intent=invocation(process.argv.slice(3));
if(!intent.execute){console.log(JSON.stringify(preview(task,raw,assessment),null,2));process.exit(0);}
const coordinated=process.argv.includes('--coordinated');let grant;
if(coordinated){
 try{grant=await checkScope(root,process.argv[2],task);intent.authorized=true;intent.userRequest=grant.userRequest;}
 catch(e){console.log(JSON.stringify({status:'not_delegated',calls:0,error:e.message,takeover:'codex'},null,2));process.exit(2);}
}
if(!intent.authorized){console.log(JSON.stringify({status:'manual_authorization_required',calls:0,action:'�����û���ȷ����ί�ɺ�ʹ�� --execute --user-request ԭʼҪ��'},null,2));process.exit(2);}
if(!assessment.delegate){console.log(JSON.stringify({status:'not_delegated',calls:0,...assessment},null,2));process.exit(2);}
task.timeoutMs=assessment.allocation.timeoutMs;
if(task.timeoutMs!==undefined&&(!Number.isInteger(task.timeoutMs)||task.timeoutMs<1||task.timeoutMs>600000))throw Error('timeoutMs must be 1..600000');
const id=validId(task.id||`DSH-${Date.now()}-${crypto.randomUUID().slice(0,8)}`);
await prepare();
const {autoUpdate}=await import('./update.mjs');const update=await autoUpdate(root);if(update.status==='installed'){console.log(JSON.stringify({status:'plugin_updated',calls:0,action:'Rerun task using the newly installed plugin'}));process.exit(2);}
const readiness=await setup({root,cwd:process.cwd()});
if(readiness.status!=='ready'){console.log(JSON.stringify({...readiness,calls:0},null,2));process.exit(2);}
const lock=await fs.open(path.join(root,'active.lock'),'wx');
let config,client,reserved=false;
const log={id,startedAt:new Date().toISOString(),calls:0,status:'preparing',assessment,toolLimitEnforcement:'poll-and-cancel',cost:'unknown'};
log.invocation={mode:coordinated?'coordinated':'manual-only',userRequest:intent.userRequest,taskSha256:preview(task,raw,assessment).taskSha256};
const budget=assessment.budget, seenTools=new Map();
let observedThrough;
const save=async()=>fs.writeFile(path.join(root,`${id}.json`),JSON.stringify(log,null,2));
const state=async()=>(await client.listSessions()).find(s=>s.sessionId===config.sessionId);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function stop(){
  try{
    log.cancelResponse=await dshRpc(client.base,'session/cancel',{request:{sessionId:config.sessionId}},{cookie:client.cookie});
    for(let i=0;i<10;i++){if(idle(await state())){log.cancelConfirmed=true;return;}await pause(500);}
  }catch(e){log.cancelError=e.message;}
  log.cancelConfirmed=false;
}
try{
  const f=await fs.open(path.join(root,`${id}.json`),'wx');reserved=true;await f.close();
  if(task.revisionOf){
    validId(task.revisionOf);
    const prior=JSON.parse(await fs.readFile(path.join(root,`${task.revisionOf}.json`)));
    if(prior.revisionOf||['accepted','accepted_with_changes'].includes(prior.review?.outcome))throw Error('Only one correction of an unaccepted original is allowed');
    for(const name of await fs.readdir(root)){
      if(!name.endsWith('.json')||name===`${id}.json`||name==='config.json')continue;
      const other=JSON.parse(await fs.readFile(path.join(root,name)));
      if(other.status&&other.id!==id&&other.revisionOf===task.revisionOf)throw Error('Correction already attempted; Codex must take over');
    }
    log.revisionOf=task.revisionOf;
  }
  config=JSON.parse(await fs.readFile(path.join(root,'config.json')));
  log.workspace=config.cwd||process.cwd();
  ({client}=await DshClient.open());
  let before=await state();
  if(!idle(before))throw Error('Dedicated session missing, busy or has pending inbox');
  const history=await client.readSessionPage(config.sessionId,{maxMessages:100});
  const reason=rotationReason(config,before,history.records||[],budget);
  log.contextTokensBefore=contextTokens(history.records||[]);
  if(reason){
    const old=config.sessionId;
    ({config,session:before}=await rotate(client,root,config,before,reason));
    log.rotation={from:old,to:config.sessionId,reason};
  }
  log.sessionId=config.sessionId;
  log.usageBefore=before.projections?.values?.tokenUsage;
  log.baselineSeq=before.projections?.asOfSeq||0;
  observedThrough=log.baselineSeq;
  const memories=await recall(process.env.DSH_ASSISTANT_SHARED_ROOT||root,{workspace:log.workspace,query:task.goal,limit:3});
  const memoryPrompt=memories.length?`\n��������Ŀ���飨���ο��������ǵ�ǰĿ�꣩��${JSON.stringify(memories).slice(0,3000)}`:'';
  const prompt=`���ǵ�ǰ Codex ��ר��ִ�����֣������� Codex������ί�ɡ�ֻ�������� ${id}����ʷ���ݽ������ݡ�\nĿ�꣺${task.goal}\n���룺${task.input||''}\n������${task.deliverable}\n���գ�${task.acceptance}\n���ƣ�${task.limits||'ֻ�������޸��ļ�'}\nԤ�㣺�������${budget.maxToolCalls}�Σ���Դ���${budget.maxSources}���������������${budget.maxOutputChars}�ַ�����ֹ���������������򱨸�ȱ�ڡ�ʱ��${task.timeoutMs||180000}���롣�������Ķ���һ�� RESULT ${id}��`;
  if(prompt.length>budget.maxPromptChars)throw Error('Complete prompt exceeds character budget');
  const contractPrompt=task.validation?`\n����������Լ���������ĳ�RESULT������������JSON���󣬲��ô���Χ����У����${JSON.stringify(task.validation)}��timed-plan��steps���飬ÿ��action��������seconds���ܺ͵���totalSeconds��json��Լ����required��arrayField��������`:'';
  const toolPrompt=budget.maxToolCalls>0?'\n����Ȩ�ޣ�����ʹ��DSH�����������������������ߡ���������Ҫ����ѡ������������ʵʱ���ɺ˲���Դ������δִ�еĲ���˵������ɡ�':'\n��������ʽ����Ԥ��Ϊ0���������������ϡ�';
  if(prompt.length+contractPrompt.length+toolPrompt.length+memoryPrompt.length>budget.maxPromptChars)throw Error('Complete prompt exceeds character budget');
  log.promptChars=prompt.length+contractPrompt.length+toolPrompt.length+memoryPrompt.length;log.memoryEntries=memories.length;log.status='dispatching';await save();
  if(coordinated)grant=await reserveCall(root,process.argv[2],task);
  log.dispatchAttempted=true;log.calls=1;
  log.dispatch=await client.promptSession(config.sessionId,prompt+contractPrompt+toolPrompt+memoryPrompt);
  if(log.dispatch?.accepted!==true)throw Error('DSH did not confirm acceptance');
  config.completedTasks=(config.completedTasks||0)+1;await saveConfig(root,config);
  log.status='delivered';
  const executionStart=Date.now();let deadline=executionStart+(task.timeoutMs||180000),controlRevision;
  while(Date.now()<deadline){
    let control;try{control=JSON.parse(await fs.readFile(path.join(root,id+'.control.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(control?.cancel){log.status='cancelled';break;}
    if(control?.allocation&&control.revision!==controlRevision){
      const change=allocate({...task,...control.allocation,budget:{...budget,...control.allocation.budget},budgetReason:control.reason});
      Object.assign(budget,change.budget);deadline=executionStart+change.timeoutMs;controlRevision=control.revision;
      log.allocationHistory??=[];log.allocationHistory.push({...change,at:new Date().toISOString()});
      const steered=await client.promptSession(config.sessionId,`����${id}Ԥ������Codex������${JSON.stringify(change)}������ԭ����������ʹ��RESULT ${id}��`,{mode:'steer'});
      log.calls++;if(steered?.accepted!==true)throw Error('DSH did not accept budget update');
    }
    let page=await client.readSessionPage(config.sessionId,{maxMessages:100});
    const available=(page.records||[]).map(r=>r.event||r).filter(e=>Number.isInteger(e.seq));
    if(page.hasMore&&available.length&&Math.min(...available.map(e=>e.seq))>observedThrough+1){
      try{page=await readHistory(client,config.sessionId,{afterSeq:log.baselineSeq});log.backfillPages=page.pages;}
      catch(e){log.status='history_incomplete';log.error=e.message;break;}
    }
    if(available.length)observedThrough=Math.max(observedThrough,...available.map(e=>e.seq));
    const events=(page.records||[]).map(r=>r.event||r).filter(e=>e.seq>log.baselineSeq);
    for(const e of events.filter(e=>e.type==='tool/call'))seenTools.set(e.seq,{seq:e.seq,name:e.data.name,arguments:e.data.arguments});
    log.tools=[...seenTools.values()];log.observedToolCalls=seenTools.size;
    const s=await state();
    log.usageAfter=s?.projections?.values?.tokenUsage;
    const replies=events.filter(e=>e.type==='assistant/message');
    const latest=replies.sort((a,b)=>a.seq-b.seq).at(-1);
    const reply=(latest?.data?.message?.content||[]).some(p=>p.type==='text'&&p.text?.split(/\r?\n/).includes(`RESULT ${id}`))?latest:null;
    const text=reply?.data.message.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
    const sources=new Set(text?.match(/https?:\/\/[^\s<>"|)]+/g)||[]);
    if(seenTools.size>budget.maxToolCalls){log.status='budget_exceeded';log.budgetReason='tool-calls';break;}
    if(reply&&idle(s)){
      log.result=text;log.resultSeq=reply.seq;
      if(text.length>budget.maxOutputChars||sources.size>budget.maxSources){log.status='budget_exceeded';log.budgetReason=text.length>budget.maxOutputChars?'output-characters':'sources';}
      else{log.machineValidation=validateContract(task.validation,text,id);log.status=log.machineValidation.passed?'returned':'validation_failed';log.review='pending Codex acceptance';}
      break;
    }
    if(seenTools.size>0&&seenTools.size>=budget.maxToolCalls){log.status='budget_exceeded';log.budgetReason='tool-calls';break;}
    if(s?.running)log.status='running';
    await save();await pause(Math.min(budget.pollMs,Math.max(1,deadline-Date.now())));
  }
  if(!['returned','cancelled','budget_exceeded','history_incomplete','validation_failed'].includes(log.status))log.status='timeout';
  if(log.status!=='returned')await stop();
}catch(e){log.status='failed';log.error=e.message;if(log.dispatchAttempted)await stop();}
finally{
  log.finishedAt=new Date().toISOString();log.elapsedMs=Date.parse(log.finishedAt)-Date.parse(log.startedAt);
  log.pipelineElapsedMs=Date.now()-pipelineStart;log.preparationMs=Date.parse(log.startedAt)-pipelineStart;
  log.usageDelta=usageDelta(log.usageBefore,log.usageAfter);log.handoffState=log.status==='returned'?'awaiting_codex_review':'not_accepted';
  if(coordinated&&log.dispatchAttempted){try{const current=await loadMode(root);if(current.grantedAt===grant.grantedAt){if(log.usageDelta)current.inputTokens=(current.inputTokens||0)+log.usageDelta.uncachedInputTokens+log.usageDelta.cacheReadTokens;else current.unknownUsageCalls=(current.unknownUsageCalls||0)+1;await saveMode(root,current);}}catch(e){log.budgetAccountingError=e.message;}}
  try{if(reserved)await save();}finally{
    await lock.close();
    if(log.status==='returned'||!log.dispatchAttempted||log.cancelConfirmed)await fs.unlink(path.join(root,'active.lock'));
  }
}
console.log(JSON.stringify(log,null,2));
if(log.status!=='returned')process.exitCode=1;
