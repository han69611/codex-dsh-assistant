import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
export async function review(log,outcome,evidence,artifact){
 if(log.status!=='returned'&&!(outcome==='rejected'&&['validation_failed','budget_exceeded'].includes(log.status)))throw Error('Only returned results can be accepted');
 if(!['accepted','accepted_with_changes','rejected'].includes(outcome)||!evidence?.trim())throw Error('Explicit review outcome and evidence required');
 if(outcome==='accepted'&&log.machineValidation?.passed===false)throw Error('Content validation failed');
 let product;
 if(artifact){const file=path.resolve(artifact);product={path:file,sha256:hash(await fs.readFile(file))};}
 if(outcome==='accepted_with_changes'&&!product)throw Error('Corrected artifact required');
 return {...log,reviewHistory:[...(log.reviewHistory||[]),log.review].filter(Boolean),reviewWaitMs:Number.isFinite(Date.parse(log.finishedAt))?Math.max(0,Date.now()-Date.parse(log.finishedAt)):null,review:{outcome,evidence,artifact:product,at:new Date().toISOString()}};
}
export async function deliver(log){
 if(!['accepted','accepted_with_changes'].includes(log.review?.outcome))throw Error('Codex review required before delivery');
 if(log.review.outcome==='accepted_with_changes'){
  const data=await fs.readFile(log.review.artifact.path);
  if(hash(data)!==log.review.artifact.sha256)throw Error('Corrected artifact changed after review');
  return {id:log.id,outcome:log.review.outcome,artifact:log.review.artifact};
 }
 return {id:log.id,outcome:'accepted',result:log.result};
}
