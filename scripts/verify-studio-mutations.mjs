import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const run=()=>spawnSync(process.execPath,['--test','test/studio-integrity.test.mjs'],{encoding:'utf8',timeout:60000});
const baseline=run();assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);
const mutations=[
  ['missing selection fallback','public/studio.js','(list.find(p=>p.id===work.activeId)||null)','(list.find(p=>p.id===work.activeId)||list[0]||null)'],
  ['stale parameter replay','src/studio.mjs','patch&&applyParameters&&!replay','patch&&applyParameters'],
  ['ignore result revision','src/studio.mjs','checkRevision(project,expectedRevision);','/* mutant: revision check removed */'],
  ['failed rollback','src/studio-integrity.mjs',"db.exec('ROLLBACK TO studio_write; RELEASE studio_write')","db.exec('RELEASE studio_write')"]
];
let killed=0;
for(const [name,path,from,to] of mutations){
  const original=readFileSync(path,'utf8');assert.equal(original.split(from).length-1,1,'Mutation must match exactly once: '+name);
  try{
    writeFileSync(path,original.replace(from,to));const result=run();
    assert.equal(result.signal,null,'Mutation timed out or crashed: '+name);assert.ok(Number.isInteger(result.status),'Missing process status');
    assert.notEqual(result.status,0,'Surviving mutation: '+name);killed++;console.log('Killed: '+name);
  }finally{writeFileSync(path,original);assert.equal(readFileSync(path,'utf8'),original);}
}
console.log(JSON.stringify({executed:mutations.length,killed,restored:true}));
