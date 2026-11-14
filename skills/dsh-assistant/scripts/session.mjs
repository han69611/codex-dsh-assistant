import fs from 'node:fs/promises';
import path from 'node:path';
export function idle(session){return session?.running===false&&!Object.values(session.projections?.values?.inbox||{}).some(v=>Array.isArray(v)&&v.length);}
export async function saveConfig(root,config){
  const tmp=path.join(root,'config.json.tmp');
  await fs.writeFile(tmp,JSON.stringify(config,null,2));await fs.rename(tmp,path.join(root,'config.json'));
}
export async function rotate(client,root,config,before,reason){
  if(!idle(before))throw Error('Cannot rotate busy session');
  const cwd=config.cwd||before.cwd;
  if(!cwd||!path.isAbsolute(cwd))throw Error('Rotation needs an absolute working directory');
  const sessionId=await client.createSession({cwd});
  if(!sessionId)throw Error('Session creation did not return an id');
  const model=before.projections?.values?.modelSelection;
  const selected=model?.next||model?.lastUsed;
  if(selected?.provider&&selected?.model)await client.selectModel(sessionId,selected);
  else await client.ensureModel(sessionId);
  const replacement=(await client.listSessions()).find(s=>s.sessionId===sessionId);
  if(!idle(replacement))throw Error('Replacement session is not idle');
  const next={sessionId,cwd,completedTasks:0,previousSessionId:config.sessionId,rotatedAt:new Date().toISOString(),rotationReason:reason};
  await saveConfig(root,next);
  return {config:next,session:replacement};
}
