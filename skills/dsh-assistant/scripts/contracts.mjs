export function validateContract(contract,text,id){
 if(!contract)return {passed:true,scope:'No machine content contract; Codex review required'};
 if(!['timed-plan','json'].includes(contract.kind))throw Error('Unsupported validation contract');
 try{
  const value=JSON.parse(text.split(/\r?\n/).filter(line=>line!==`RESULT ${id}`).join('\n').trim());
  if(contract.kind==='json'){
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error('JSON object required');
   for(const key of contract.required||[])if(!(key in value))throw Error(`Missing field ${key}`);
   if(contract.arrayField){const rows=value[contract.arrayField];if(!Array.isArray(rows)||rows.length<(contract.minItems||0)||(contract.exactItems!==undefined&&rows.length!==contract.exactItems))throw Error('Array count mismatch');for(const row of rows)for(const key of contract.itemRequired||[])if(!row||!(key in row))throw Error(`Missing item field ${key}`);if(contract.uniqueBy&&new Set(rows.map(r=>r[contract.uniqueBy])).size!==rows.length)throw Error('Duplicate item identifier');}
   return {passed:true,kind:'json'};
  }
  if(!Number.isInteger(contract.totalSeconds)||contract.totalSeconds<1)throw Error('Invalid totalSeconds');
  if(!Array.isArray(value.steps)||!value.steps.length)throw Error('steps must be nonempty');
  for(const step of value.steps)if(typeof step.action!=='string'||!step.action.trim()||!Number.isInteger(step.seconds)||step.seconds<1)throw Error('Every step needs action and positive integer seconds');
  const actual=value.steps.reduce((sum,s)=>sum+s.seconds,0);
  if(actual!==contract.totalSeconds)throw Error(`Duration mismatch: ${actual} != ${contract.totalSeconds}`);
  return {passed:true,kind:contract.kind,totalSeconds:actual};
 }catch(e){return {passed:false,kind:contract.kind,error:e.message};}
}
export function usageDelta(before,after){
 if(!before||!after)return null;
 const delta={};for(const key of ['uncachedInputTokens','outputTokens','cacheReadTokens','cacheWriteTokens']){
  if(!Number.isFinite(before[key])||!Number.isFinite(after[key])||after[key]<before[key])return null;
  delta[key]=after[key]-before[key];
 }return delta;
}
