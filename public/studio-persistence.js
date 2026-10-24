const editable=['title','article','sourceUrl','artistId','parameters','result'];
const resultKeys=['concept','lyrics','style','exclusions','moods','titles','coverPrompt','artistPhotoPrompt','suggestedGenre','rationale'];
const clone=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function mergeEdits(base,changes){
  const next={...base,...changes};
  for(const key of ['parameters','result'])if(changes[key])next[key]={...base[key],...changes[key]};
  return next;
}
export function projectChanges(base,edited){
  const changes={};
  for(const key of editable){
    if(!Object.hasOwn(edited,key))continue;
    if(['parameters','result'].includes(key)){
      const patch={};for(const [name,value] of Object.entries(edited[key]||{})){
        if(key==='result'&&!resultKeys.includes(name))continue;
        if(!same(base[key]?.[name],value))patch[name]=value;
      }
      if(Object.keys(patch).length)changes[key]=patch;
    }else if(!same(base[key],edited[key]))changes[key]=edited[key];
  }
  return changes;
}
export function patchBaseValues(base,changes){
  const values={};for(const [key,value] of Object.entries(changes)){
    if(['parameters','result'].includes(key))for(const name of Object.keys(value))values[key+'.'+name]=base[key]?.[name]??null;
    else values[key]=base[key]??null;
  }return values;
}
export function readDraft(storage,key){
  try{const value=JSON.parse(storage?.getItem(key)||'null');
    return value&&typeof value==='object'&&value.base&&value.draft&&typeof value.requestId==='string'?value:null;
  }catch{return null;}
}
export class StudioPersistence{
  constructor({project,request,storage,key,onSaved=()=>{},onStatus=()=>{},delay=500,requestId=globalThis.crypto?.randomUUID?.()}){
    this.request=request;this.storage=storage;this.key=key;this.onSaved=onSaved;this.onStatus=onStatus;this.delay=delay;
    const restored=readDraft(storage,key);
    this.base=clone(restored?.base||project);this.draft=clone(restored?.draft||project);
    this.requestId=restored?.requestId||requestId;this.running=null;this.timer=null;this.error=null;this.backupError=null;
  }
  get changes(){return projectChanges(this.base,this.draft);}
  get dirty(){return Object.keys(this.changes).length>0;}
  persist(){
    try{if(!this.storage)throw Error("Browser draft storage unavailable");this.storage.setItem(this.key,JSON.stringify({base:this.base,draft:this.draft,requestId:this.requestId}));this.backupError=null;}
    catch(error){this.backupError=error;}
  }
  edit(changes){
    this.draft=mergeEdits(this.draft,clone(changes));this.error=null;this.persist();this.onStatus('pending',this.backupError);
    clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush().catch(()=>{});},this.delay);
  }
  flush(){
    clearTimeout(this.timer);this.timer=null;
    if(this.running)return this.running;
    this.running=this.drain().finally(()=>{this.running=null;});return this.running;
  }
  async drain(){
    try{
      while(this.dirty){
        const sent=clone(this.draft),changes=this.changes,creating=!this.base.id;this.onStatus('saving',this.backupError);
        const saved=creating?await this.request('studio/projects',{
          title:sent.title,article:sent.article,sourceUrl:sent.sourceUrl,artistId:sent.artistId,parameters:sent.parameters,requestId:this.requestId
        }):await this.request('studio/projects/'+this.base.id,{
          changes,expectedRevision:this.base.revision,baseValues:patchBaseValues(this.base,changes)
        },{method:'PATCH'});
        const later=projectChanges(sent,this.draft);
        this.base=clone(saved);this.draft=mergeEdits(saved,creating?mergeEdits(changes,later):later);
        this.onSaved(saved);this.persist();
      }
      try{this.storage?.removeItem(this.key);}catch{/* Server acknowledgement is already durable. */}
      this.error=null;this.onStatus('saved');return this.base;
    }catch(error){this.error=error;this.persist();this.onStatus(error.status===409?'conflict':'error',error);throw error;}
  }
  async resolve(useLocal){
    if(this.running)await this.running.catch(()=>{});
    this.running=(async()=>{
      const latest=await this.request('studio/projects/'+this.base.id),changes=this.changes;
      this.base=clone(latest);this.draft=useLocal?mergeEdits(latest,changes):clone(latest);this.error=null;
      this.persist();this.onSaved(latest);return this.drain();
    })().finally(()=>{this.running=null;});return this.running;
  }
}
