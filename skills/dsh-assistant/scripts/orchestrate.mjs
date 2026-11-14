import fs from 'node:fs/promises';import {root,prepare} from './state.mjs';import {Engine} from './engine.mjs';
await prepare();const engine=new Engine(root);const [cmd,...args]=process.argv.slice(2);let result;
if(cmd==='enqueue')result=await engine.enqueue(args[0],args[1]?JSON.parse(await fs.readFile(args[1],'utf8')):{});
else if(cmd==='run')result=await engine.pump();else if(cmd==='status')result=await engine.list();else if(cmd==='concurrency')result=await engine.configure(Number(args[0]));
else if(cmd==='cancel')result=await engine.cancel(args[0]);else if(cmd==='recover')result=await engine.recover();
else if(cmd==='confirm-stop')result=await engine.confirm(args[0]);
else if(cmd==='dashboard'){const {dashboard}=await import('./dashboard.mjs');result=await dashboard(root);}
else if(cmd==='allocate')result=await engine.allocate(args[0],JSON.parse(await fs.readFile(args[1],'utf8')),args.slice(2).join(' '));
else if(cmd==='correct')result=await engine.correct(args[0],JSON.parse(await fs.readFile(args[1],'utf8')));
else if(cmd==='takeover')result=await engine.takeover(args[0],JSON.parse(await fs.readFile(args[1],'utf8')));
else if(cmd==='review'){const v=JSON.parse(await fs.readFile(args[1],'utf8'));result=await engine.review(args[0],v.outcome,v.evidence,v.artifact);}
else throw Error('enqueue|run|status|concurrency|cancel|recover|allocate|correct|review|takeover');
if(['review','takeover','run'].includes(cmd)){const {maintain}=await import('./knowledge.mjs');await maintain(root,{workspace:process.cwd()});}
console.log(JSON.stringify(result,null,2));
