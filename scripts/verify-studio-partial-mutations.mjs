import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const run=()=>spawnSync(process.execPath,['--test','test/studio-partial-save.test.mjs','test/studio-persistence.test.mjs'],{encoding:'utf8',timeout:60000});
const baseline=run();assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);
const mutations=[
 ['nested result preservation','src/studio-patches.mjs','next.result={...p.result,...changes.result}','next.result={...changes.result}'],
 ['same-field conflict','src/studio-patches.mjs','if(expectedRevision!==undefined&&expectedRevision!==p.revision){','if(false&&expectedRevision!==undefined&&expectedRevision!==p.revision){'],
 ['typing during a save','public/studio-persistence.js','const later=projectChanges(sent,this.draft);','const later={};'],
 ['new-draft retry identity','public/studio-persistence.js','parameters:sent.parameters,requestId:this.requestId','parameters:sent.parameters']
];
let killed=0;
for(const [name,path,from,to] of mutations){
 const original=readFileSync(path,'utf8');assert.equal(original.split(from).length-1,1,'Mutation must match once: '+name);
 try{writeFileSync(path,original.replace(from,to));const r=run();assert.equal(r.signal,null,'Mutation timed out');assert.ok(Number.isInteger(r.status));assert.notEqual(r.status,0,'Survived: '+name);killed++;console.log('Killed: '+name);}
 finally{writeFileSync(path,original);assert.equal(readFileSync(path,'utf8'),original);}
}
console.log(JSON.stringify({executed:mutations.length,killed,restored:true}));
