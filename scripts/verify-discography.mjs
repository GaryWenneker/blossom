import { spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const run=(cmd,args,options={})=>{const result=spawnSync(cmd,args,{encoding:'utf8',...options});if(result.error)throw result.error;return result;};
function check(cmd,args){const result=run(cmd,args,{stdio:'inherit'});if(result.status!==0)throw Error(cmd+' exited '+result.status);}
const source=new URL('../src/discography.mjs',import.meta.url),original=readFileSync(source,'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
const tests=['--test','test/discography.test.mjs'];
if(!process.argv.includes('--mutations-only')){
 check('npm',['run','check']);check('npm',['test']);
 check(process.execPath,['--experimental-test-coverage','--test-coverage-lines=100','--test-coverage-include=src/discography.mjs','--test-coverage-include=src/discography-api.mjs','--test','test/discography.test.mjs','test/discography-api.test.mjs']);
}
const mutants=[
 ['artist boundary','if(song.artistId!==a.artist_id)','if(false)'],
 ['revision conflict','if(!Number.isInteger(expectedRevision)||a.revision!==expectedRevision)','if(false)'],
 ['stable order','ids.forEach((key,i)=>update.run(i+1,albumId,key))','ids.forEach((key,i)=>update.run(1,albumId,key))'],
 ['recording ownership','asset.project_id!==song.projectId','false'],
 ['pin selected take','const key=assetId??song.selectedAudioId','const key=assetId??null']
];
try{
 for(const [name,from,to] of mutants){
  assert.equal(original.split(from).length-1,1,'Mutant must match exactly once: '+name);
  const modified=original.replace(from,to);writeFileSync(source,modified);
  assert.equal(hash(readFileSync(source,'utf8')),hash(modified),'Mutant was not written');
  const result=run(process.execPath,tests);
  if(result.status!==1||!result.stdout.includes('fail 1')&&!/fail [2-9]/.test(result.stdout))throw Error('Mutant survived or test runner failed: '+name+'\n'+result.stdout+'\n'+result.stderr);
  console.log('Killed: '+name);
  writeFileSync(source,original);assert.equal(hash(readFileSync(source,'utf8')),hash(original));
 }
}finally{writeFileSync(source,original);}
check(process.execPath,tests);console.log('Manual mutation: 5/5 killed; original restored and green');
if(process.argv.includes('--require-browser'))check(process.execPath,['--test','test/discography-browser.test.mjs']);
