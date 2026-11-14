import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {DshClient,discoverDshBase} from './dsh.mjs';
import {idle,saveConfig} from './session.mjs';
export async function installedExecutable(){
  const candidates=[process.env.DSH_EXECUTABLE,
    path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Programs','DeepSeek Harness','DeepSeek Harness.exe'),
    ...(process.env.ProgramFiles?[path.join(process.env.ProgramFiles,'DeepSeek Harness','DeepSeek Harness.exe')]:[])].filter(Boolean);
  for(const candidate of candidates){try{if(path.isAbsolute(candidate)&&(await fs.stat(candidate)).isFile())return candidate;}catch{}}
  return null;
}
async function launch(executable){
  await new Promise((resolve,reject)=>{
    const child=spawn(executable,[],{detached:true,stdio:'ignore',windowsHide:true});
    child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
}
// No model prompt is sent during setup. Injectable host operations keep cold-start tests offline.
export async function setup({root,cwd=process.cwd(),allowLaunch=true,repair=false,waitMs=30000},deps={}){
  const open=deps.open||(()=>DshClient.open());
  const discover=deps.discover||(()=>discoverDshBase());
  const locate=deps.locate||installedExecutable;
  const start=deps.launch||launch;
  const sleep=deps.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
  await fs.mkdir(root,{recursive:true});
  let lock;
  try{lock=await fs.open(path.join(root,'active.lock'),'wx');}catch(e){if(e.code==='EEXIST')return {status:'busy',action:'������������ù��̳������ȼ��ԭ�������Զ�ɾ����'};throw e;}
  let createdSessionId;
  try{
    let reachable=false, launched=false;
    const deadline=Date.now()+waitMs;
    try{await discover();reachable=true;}catch{}
    if(!reachable){
      if(process.platform!=='win32'&&!deps.launch)return {status:'unsupported',action:'��ǰ�Զ�����֧�� Windows�����ֶ��������� DSH �����ԡ�'};
      const executable=await locate();
      if(!executable)return {status:'needs_install',action:'��� DSH �ٷ�����������װ����˲�����״ε�¼���ٴε��ò�����Զ��尲װ·�������� DSH_EXECUTABLE��'};
      if(!allowLaunch)return {status:'needs_start',action:'�������� DSH �����ԡ�'};
      await start(executable);
      launched=true;
      do{try{await discover();reachable=true;break;}catch{}await sleep(500);}while(Date.now()<deadline);
      if(!reachable)return {status:'startup_timeout',action:'DSH ���������������ӿ���δ����������������״����������ԡ�'};
    }
    let client,sessions;
    while(true){
      try{({client}=await open());sessions=await client.listSessions();break;}
      catch{
        if(launched&&Date.now()<deadline){await sleep(500);continue;}
        return {status:'needs_login_or_connection',action:'���� DSH ������ɵ�¼/�״�������ȷ�ϱ������ӿ��ú����ԣ���������ռ��˺�ƾ�ݡ�'};
      }
    }
    const file=path.join(root,'config.json');
    let config;
    try{
      config=JSON.parse(await fs.readFile(file,'utf8'));
      if(!config||Array.isArray(config)||typeof config.sessionId!=='string'||!config.sessionId.trim()||(config.completedTasks!==undefined&&(!Number.isInteger(config.completedTasks)||config.completedTasks<0))||(config.cwd!==undefined&&(typeof config.cwd!=='string'||!path.isAbsolute(config.cwd))))throw Error('Invalid configuration schema');
    }catch(e){if(e.code!=='ENOENT')return {status:'invalid_config',action:'�����𻵣�����ԭ�ļ����������޸���'};}
    if(config){
      const s=sessions.find(s=>s.sessionId===config.sessionId);
      if(s)return {status:'ready',sessionId:config.sessionId,busy:!idle(s),created:false};
      if(!repair)return {status:'stale_session',action:'ԭר�ûỰ�Ѳ����ڡ�ʹ�� setup --repair ��������Ự�����������á�'};
    }
    const workingDirectory=path.resolve(cwd);
    if(!(await fs.stat(workingDirectory)).isDirectory())throw Error('Working directory must exist');
    const pendingPath=path.join(root,'setup-pending.json');
    let pending;
    try{pending=JSON.parse(await fs.readFile(pendingPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(pending){
      if(!sessions.some(s=>s.sessionId===pending.sessionId&&idle(s)))throw Error('Pending setup session needs inspection');
      createdSessionId=pending.sessionId;
    }else{
      createdSessionId=await client.createSession({cwd:workingDirectory});
      if(createdSessionId)await fs.writeFile(pendingPath,JSON.stringify({sessionId:createdSessionId,cwd:workingDirectory}));
    }
    if(!createdSessionId)throw Error('DSH did not return a session id');
    await client.ensureModel(createdSessionId);
    const s=(await client.listSessions()).find(s=>s.sessionId===createdSessionId);
    if(!idle(s))throw Error('New session is not idle');
    if(config)await fs.copyFile(file,path.join(root,`config.backup-${Date.now()}.json`));
    await saveConfig(root,{sessionId:createdSessionId,cwd:pending?.cwd||workingDirectory,completedTasks:0,setupVersion:1,createdAt:new Date().toISOString()});
    await fs.unlink(pendingPath);
    return {status:'ready',sessionId:createdSessionId,created:true};
  }catch{return {status:'setup_failed',createdSessionId,action:'���� DSH ģ�����ú͹���Ŀ¼�����ԡ����Ự�Ѵ���������δ��ɣ������� DSH ���ÿջỰ�������ظ�������'};}
  finally{await lock.close();await fs.unlink(path.join(root,'active.lock'));}
}
