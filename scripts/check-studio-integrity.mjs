import { spawnSync } from 'node:child_process';

const checks=[
  ['syntax','npm',['run','check']],
  ['full regression suite','npm',['test']],
  ['integrity coverage',process.execPath,['--test','--experimental-test-coverage','--test-coverage-include=src/studio-integrity.mjs','--test-coverage-lines=100','--test-coverage-branches=85','test/studio-integrity.test.mjs']],
  ['manual mutation',process.execPath,['scripts/verify-studio-mutations.mjs']],
  ['partial-save coverage',process.execPath,['--test','--experimental-test-coverage','--test-coverage-include=src/studio-patches.mjs','--test-coverage-include=public/studio-persistence.js','--test-coverage-lines=100','--test-coverage-branches=85','test/studio-partial-save.test.mjs','test/studio-persistence.test.mjs']],
  ['partial-save mutations',process.execPath,['scripts/verify-studio-partial-mutations.mjs']],
  ['whitespace','git',['diff','--check']]
];
for(const [name,command,args] of checks){
  console.log('CHECK: '+name);const run=spawnSync(command,args,{stdio:'inherit'});
  if(run.error||run.signal||run.status!==0){console.error('FAILED: '+name);process.exit(1);}
}
