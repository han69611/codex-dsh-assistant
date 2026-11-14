import fs from 'node:fs/promises';
import path from 'node:path';
import {DshClient} from './dsh.mjs';
import {root,prepare,validId} from './state.mjs';
import {assess,defaults,rotationReason,contextTokens} from './policy.mjs';
import {rotate} from './session.mjs';
import {setup} from './bootstrap.mjs';
import {review,deliver} from './review.mjs';
import {loadMode,saveMode} from './coordination.mjs';
import {maintain,recall,metrics} from './knowledge.mjs';
await prepare();
const [command,...args]=process.argv.slice(2);
const configPath=path.join(root,'config.json');
if(command==='memory'){console.log(JSON.stringify(await recall(root,{workspace:args[0]||process.cwd(),query:args.slice(1).join(' ')}),null,2));}
else if(command==='maintain'){console.log(JSON.stringify(await maintain(root,{workspace:process.cwd(),cleanup:args.includes('--cleanup')}),null,2));}
else if(command==='metrics'){console.log(JSON.stringify(await metrics(root),null,2));}
else if(command==='mode') {
  if(!args[0]||args[0]==='status'){console.log(JSON.stringify(await loadMode(root),null,2));}
  else{
    const lock=await fs.open(path.join(root,'active.lock'),'wx');
    try{
      if(args[0]==='manual'){await saveMode(root,{mode:'manual'});}
      else if(args[0]==='coordinated'){
        const wi=args.indexOf('--workspace'),ri=args.indexOf('--user-request');
        if(wi<0||ri<0||!args[ri+1]||args[ri+1].length<4)throw Error('Workspace and actual user authorization required');
        const workspace=await fs.realpath(args[wi+1]);if(!(await fs.stat(workspace)).isDirectory())throw Error('Workspace must be a directory');
        await saveMode(root,{mode:'coordinated',workspace,userRequest:args[ri+1],grantedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+24*3600000).toISOString(),usedCalls:0,inputTokens:0});
      }else throw Error('Unknown mode');
      console.log(JSON.stringify(await loadMode(root),null,2));
    }finally{await lock.close();await fs.unlink(path.join(root,'active.lock'));}
  }
}else if(command==='setup') {
  const result=await setup({root,cwd:args.find(a=>!a.startsWith('--'))||process.cwd(),allowLaunch:!args.includes('--no-launch'),repair:args.includes('--repair')});
  console.log(JSON.stringify(result,null,2));if(result.status!=='ready')process.exitCode=2;
}else if(command==='assess') {
  const result=assess(JSON.parse(await fs.readFile(args[0],'utf8')));
  console.log(JSON.stringify(result,null,2));if(!result.delegate)process.exitCode=2;
}else if(command==='history') {
  const entries=[];
  for(const name of await fs.readdir(root)){
    if(!name.endsWith('.json')||name.startsWith('config')||name==='setup-pending.json')continue;
    try{const log=JSON.parse(await fs.readFile(path.join(root,name),'utf8'));if(log.id&&log.status)entries.push({id:log.id,status:log.status,review:log.review?.outcome||'pending',elapsedMs:log.elapsedMs,calls:log.calls,usageDelta:log.usageDelta||null,startedAt:log.startedAt});}catch{}
  }
  console.log(JSON.stringify(entries.sort((a,b)=>(b.startedAt||'').localeCompare(a.startedAt||'')).slice(0,10),null,2));
}else if(command==='init') {
  // Exclusive setup file prevents two simultaneous initializations and overwrites.
  const file=await fs.open(configPath,'wx');
  try {
    const {client}=await DshClient.open();
    const sessionId=args[0]==='--session'?args[1]:await client.createSession({cwd:path.resolve(args[0]||process.cwd())});
    if(!sessionId) throw Error('No session id');
    const session=(await client.listSessions()).find(s=>s.sessionId===sessionId);
    if(!session||session.running) throw Error('Session missing or busy');
    await client.ensureModel(sessionId);
    await file.writeFile(JSON.stringify({sessionId,cwd:session.cwd||path.resolve(process.cwd()),completedTasks:0},null,2));
    console.log(JSON.stringify({stateDir:root,sessionId}));
  }catch(e){await file.close();await fs.unlink(configPath);throw e;}finally{await file.close();}
}else if(command==='doctor') {
  const config=JSON.parse(await fs.readFile(configPath));
  const {client}=await DshClient.open();
  const s=(await client.listSessions()).find(s=>s.sessionId===config.sessionId);
  const page=s?await client.readSessionPage(config.sessionId,{maxMessages:100}):{};
  console.log(JSON.stringify({stateDir:root,sessionId:config.sessionId,found:!!s,running:s?.running,model:s?.projections?.values?.modelSelection,sessionTasks:config.completedTasks||0,lastContextTokens:contextTokens(page.records||[]),rotationDue:s?rotationReason(config,s,page.records||[],defaults):null,budget:defaults,toolLimitEnforcement:'poll-and-cancel'},null,2));
  if(!s)process.exitCode=1;
}else if(command==='rotate') {
  const lock=await fs.open(path.join(root,'active.lock'),'wx');
  try{
    const config=JSON.parse(await fs.readFile(configPath));
    const {client}=await DshClient.open();
    const before=(await client.listSessions()).find(s=>s.sessionId===config.sessionId);
    const result=await rotate(client,root,config,before,'explicit-controller-request');
    console.log(JSON.stringify(result.config,null,2));
  }finally{await lock.close();await fs.unlink(path.join(root,'active.lock'));}
}else if(command==='review') {
  const [id,outcome,...notes]=args; validId(id);
  const artifactIndex=notes.indexOf('--artifact');
  const artifact=artifactIndex>=0?notes[artifactIndex+1]:undefined;
  const evidence=(artifactIndex>=0?notes.slice(0,artifactIndex):notes).join(' ');
  const p=path.join(root,`${id}.json`), log=JSON.parse(await fs.readFile(p));
  const reviewed=await review(log,outcome,evidence,artifact);
  await fs.writeFile(p,JSON.stringify(reviewed,null,2)); console.log(JSON.stringify(reviewed.review));
  await maintain(root,{workspace:log.workspace||process.cwd()});
}else if(command==='deliver') {
  console.log(JSON.stringify(await deliver(JSON.parse(await fs.readFile(path.join(root,`${validId(args[0])}.json`)))),null,2));
}else if(command==='result') {
  console.log(await fs.readFile(path.join(root,`${validId(args[0])}.json`),'utf8'));
}else throw Error('Usage: manage.mjs assess task.json | init [cwd | --session ID] | doctor | rotate | result ID | review ID accepted|rejected evidence');
