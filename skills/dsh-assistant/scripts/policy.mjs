export const defaults = Object.freeze({maxToolCalls:4,maxSources:3,maxOutputChars:1200,maxPromptChars:12000,maxSessionTasks:6,maxSessionSeq:300,maxContextTokens:48000,pollMs:500});
export const capacity=Object.freeze({...defaults,maxToolCalls:64,maxSources:30,maxOutputChars:30000,maxPromptChars:60000,maxSessionTasks:30,maxSessionSeq:3000,maxContextTokens:200000,pollMs:5000});
export function allocate(task){
 const size=JSON.stringify(task.input||'').length;
 const plan=task.planning||{};
 for(const k of ['items','sources','expectedSteps','outputChars','reviewSeconds','handoffSeconds'])if(plan[k]!==undefined&&(!Number.isFinite(plan[k])||plan[k]<0))throw Error(`Invalid planning ${k}`);
 const workload=task.workload||(size>6000||plan.items>40||plan.expectedSteps>12?'large':task.routing?.kind==='research'||plan.sources>2?'research':'standard');
 const profiles={light:{maxToolCalls:2,maxSources:2,maxOutputChars:1000,maxPromptChars:12000,timeoutMs:90000},standard:{timeoutMs:180000},research:{maxToolCalls:10,maxSources:6,maxOutputChars:3500,maxPromptChars:20000,timeoutMs:300000},large:{maxToolCalls:16,maxSources:10,maxOutputChars:8000,maxPromptChars:50000,timeoutMs:600000}};
 if(!profiles[workload])throw Error('Unknown workload');
 const {timeoutMs,...profile}=profiles[workload];
 const inferred={};if(plan.expectedSteps||plan.sources)inferred.maxToolCalls=Math.min(capacity.maxToolCalls,Math.ceil((plan.expectedSteps||0)+(plan.sources||0)*2));if(plan.sources)inferred.maxSources=Math.min(capacity.maxSources,Math.ceil(plan.sources));if(plan.outputChars)inferred.maxOutputChars=Math.min(capacity.maxOutputChars,Math.ceil(plan.outputChars));
 const budget={...defaults,...profile,...inferred,...task.budget};
 for(const key of Object.keys(task.budget||{}))if(!(key in capacity))throw Error(`Unknown budget ${key}`);
 for(const key of Object.keys(defaults))if(!Number.isInteger(budget[key])||budget[key]<(key==='maxToolCalls'?0:1)||budget[key]>capacity[key])throw Error(`Invalid budget ${key}`);
 const duration=task.timeoutMs??timeoutMs;
 if(!Number.isInteger(duration)||duration<1||duration>600000)throw Error('timeoutMs must be 1..600000');
 const enlarged=Object.keys(defaults).some(k=>budget[k]>defaults[k])||duration>180000;
 const reason=task.budgetReason||task.routing?.reason;
 if(enlarged&&(!reason||reason.trim().length<4))throw Error('Expanded allocation requires a reason');
 return {workload,budget,timeoutMs:duration,reason:reason||'Fallback allocation',planning:plan};
}
export function assess(task) {
  for(const key of ['goal','deliverable','acceptance']) if(typeof task[key]!=='string'||!task[key].trim())throw Error(`Missing ${key}`);
  const r=task.routing;
  if(!r||typeof r.reason!=='string'||!r.reason.trim()||typeof r.scriptSuitable!=='boolean'||!Number.isFinite(r.estimatedDirectSeconds)||r.estimatedDirectSeconds<0) return {delegate:false,route:'codex',reason:'Missing routing assessment'};
  if(r.scriptSuitable||r.kind==='deterministic')return {delegate:false,route:'script',reason:'Use deterministic tools or scripts'};
  if(!['research','summarize','classify','semantic-extract'].includes(r.kind))return {delegate:false,route:'codex',reason:'Outside assistant scope'};
  if(task.planning?.risk==='high')return {delegate:false,route:'codex',reason:'High-risk judgment stays with Codex'};
  const overhead=(task.planning?.reviewSeconds??30)+(task.planning?.handoffSeconds??30);
  if(r.estimatedDirectSeconds<=overhead)return {delegate:false,route:'codex',reason:'Expected handoff and review erase efficiency benefit'};
  const allocation=allocate(task),budget=allocation.budget;
  if(task.validation&&!['timed-plan','json'].includes(task.validation.kind))throw Error('Invalid validation contract');
  if(task.requireHardToolLimit)return {delegate:false,route:'codex',reason:'DSH bridge has no verified pre-execution tool limiter; strict hard limit unavailable'};
  if(task.requireSystemReadOnly)return {delegate:false,route:'codex',reason:'DSH bridge cannot enforce OS-level read-only isolation'};
  const context=JSON.stringify({goal:task.goal,input:task.input,deliverable:task.deliverable,acceptance:task.acceptance,limits:task.limits});
  if(context.length>budget.maxPromptChars)return {delegate:false,route:'compress',reason:'Input context exceeds character budget'};
  return {delegate:true,route:'dsh',reason:r.reason,budget,allocation};
}
export function contextTokens(records) {
  const last=records.map(r=>r.event||r).filter(e=>e.type==='assistant/message'&&e.data?.usage).at(-1)?.data?.usage;
  return last? (last.inputTokens||0)+(last.cacheReadTokens||0):null;
}
export function rotationReason(config,session,records,budget) {
  if((config.completedTasks||0)>=budget.maxSessionTasks)return 'task-count';
  if((session.projections?.asOfSeq||0)>=budget.maxSessionSeq)return 'history-sequence';
  const tokens=contextTokens(records);
  if(tokens!==null&&tokens>=budget.maxContextTokens)return 'last-request-context';
  return null;
}
