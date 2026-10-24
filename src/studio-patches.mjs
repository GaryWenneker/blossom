import { DomainError } from './domain.mjs';
import { atomic,snapshot } from './studio-integrity.mjs';

const topFields=new Set(['title','article','sourceUrl','artistId','parameters','result']);
const resultFields=new Set(['concept','lyrics','style','exclusions','moods','titles','coverPrompt','artistPhotoPrompt','suggestedGenre','rationale']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function patchLeaves(changes){
  return Object.entries(changes).flatMap(([key,value])=>['parameters','result'].includes(key)
    ?Object.entries(value).map(([nested,v])=>[key+'.'+nested,v]):[[key,value]]);
}
function valueAt(project,path){const [key,nested]=path.split('.');return (nested?project[key]?.[nested]:project[key])??null;}
export function applyProjectPatch(studio,id,changes,{expectedRevision,baseValues}={},normalize,defaults){
  return atomic(studio.db,()=>{
    const p=studio.require(id);
    if(!object(changes)||Object.keys(changes).some(k=>!topFields.has(k)))throw new DomainError('Invalid project changes');
    for(const key of ['parameters','result'])if(Object.hasOwn(changes,key)&&!object(changes[key]))throw new DomainError('Invalid '+key+' changes');
    if(Object.keys(changes.parameters||{}).some(k=>!Object.hasOwn(defaults,k)))throw new DomainError('Unknown production control');
    if(Object.keys(changes.result||{}).some(k=>!resultFields.has(k)))throw new DomainError('Invalid editable result field');
    const leaves=patchLeaves(changes);
    if(expectedRevision!==undefined&&expectedRevision!==p.revision){
      if(!Number.isInteger(expectedRevision)||!object(baseValues)||!leaves.every(([path,value])=>same(valueAt(p,path),value)||
        Object.hasOwn(baseValues,path)&&same(valueAt(p,path),baseValues[path])))
        throw new DomainError('The same fields changed elsewhere. Your local edits have been kept.',409);
    }
    const next={...p},columns=[],values=[];
    for(const [key,column,max] of [['title','title',140],['article','article',10000],['sourceUrl','source_url',1000],['artistId','artist_id',80]]){
      if(!Object.hasOwn(changes,key))continue;
      if(typeof changes[key]!=='string'||changes[key].length>max)throw new DomainError('Invalid '+key);
      const value=changes[key].trim();
      if(key==='sourceUrl'&&value){let url;try{url=new URL(value);}catch{throw new DomainError('Invalid article URL');}if(!['https:','http:'].includes(url.protocol))throw new DomainError('Article URL must be http(s)');}
      if(key==='artistId'&&value&&!studio.store.artist(value))throw new DomainError('Artist not found',404);
      next[key]=key==='title'?(value||'Untitled project'):value;
      if(!same(next[key],p[key])){columns.push(column+'=?');values.push(key==='artistId'?(value||null):next[key]);}
    }
    if(changes.parameters){next.parameters=normalize(changes.parameters,p.parameters);if(!same(next.parameters,p.parameters)){columns.push('params=?');values.push(JSON.stringify(next.parameters));}}
    if(changes.result){
      for(const [key,value] of Object.entries(changes.result)){
        if(['exclusions','moods','titles'].includes(key)){
          if(!Array.isArray(value)||value.length>32||value.some(x=>typeof x!=='string'||x.length>1000))throw new DomainError('Invalid '+key);
        }else if(typeof value!=='string'||value.length>(key==='lyrics'?12000:10000))throw new DomainError('Invalid '+key);
      }
      next.result={...p.result,...changes.result};
      if(!same(next.result,p.result)){columns.push('result=?');values.push(JSON.stringify(next.result));}
    }
    if(!columns.length)return p;
    studio.db.prepare('UPDATE studio_projects SET '+columns.join(',')+',updated_at=?,revision=revision+1 WHERE id=?')
      .run(...values,new Date().toISOString(),id);
    if(next.artistId&&next.artistId!==p.artistId)studio.associateArtistPhoto(id,next.artistId);
    studio.store.audit('partial_updated','studio_project',id,{fields:leaves.map(([path])=>path)});
    snapshot(studio,id,'partial_edit');return studio.require(id);
  });
}
