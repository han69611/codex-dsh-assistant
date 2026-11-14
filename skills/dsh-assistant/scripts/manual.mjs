import crypto from 'node:crypto';
export function invocation(args){
 const execute=args.includes('--execute');const index=args.indexOf('--user-request');
 const userRequest=index>=0?args[index+1]:null;
 return {execute,authorized:execute&&typeof userRequest==='string'&&userRequest.trim().length>=4&&!userRequest.startsWith('--'),userRequest};
}
export function preview(task,raw,assessment){
 return {status:'preview',calls:0,mode:'offline-preview',taskId:task.id||null,taskSha256:crypto.createHash('sha256').update(raw).digest('hex'),route:assessment.route,reason:assessment.reason,budget:assessment.budget||null,allocation:assessment.allocation||null,goal:task.goal,deliverable:task.deliverable,acceptance:task.acceptance,validation:task.validation||null,contextChars:raw.length,cost:'unknown',warning:'DSH包含系统与历史上下文，短提示不等于低费用。此预览未启动DSH、未创建会话、未调用模型。'};
}
