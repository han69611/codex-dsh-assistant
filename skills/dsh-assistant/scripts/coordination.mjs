import fs from 'node:fs/promises';import path from 'node:path';
const file=root=>path.join(root,'coordination.json');
export async function loadMode(root){try{return JSON.parse(await fs.readFile(file(root),'utf8'));}catch(e){if(e.code==='ENOENT')return {mode:'manual'};throw e;}}
export async function saveMode(root,value){const p=file(root);await fs.writeFile(p+'.tmp',JSON.stringify(value,null,2));await fs.rename(p+'.tmp',p);}
export async function checkScope(root,taskPath,task){
 const grant=await loadMode(root);
 if(grant.mode!=='coordinated'||!grant.userRequest||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=Date.now())throw Error('No active coordinated authorization');
 if(!Number.isInteger(grant.usedCalls)||grant.usedCalls<0||!Number.isFinite(grant.inputTokens)||grant.inputTokens<0)throw Error('Invalid usage counters');
 if(grant.maxCalls!==undefined&&(!Number.isInteger(grant.maxCalls)||grant.maxCalls<1))throw Error('Invalid user call limit');
 if(grant.maxInputTokens!==undefined&&(!Number.isFinite(grant.maxInputTokens)||grant.maxInputTokens<1))throw Error('Invalid user token limit');
 if((grant.maxCalls!==undefined&&grant.usedCalls>=grant.maxCalls)||(grant.maxInputTokens!==undefined&&(grant.inputTokens>=grant.maxInputTokens||grant.unknownUsageCalls>0)))throw Error('User-specified coordination budget exhausted');
 const base=await fs.realpath(grant.workspace),target=await fs.realpath(taskPath),relative=path.relative(base,target);
 if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw Error('Task outside authorized workspace');
 if(!['research','summarize','classify','semantic-extract'].includes(task.routing?.kind))throw Error('Task outside coordinated assistant scope');
 return grant;
}
export async function reserveCall(root,taskPath,task){const grant=await checkScope(root,taskPath,task);grant.usedCalls++;await saveMode(root,grant);return grant;}
