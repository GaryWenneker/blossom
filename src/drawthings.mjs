import { spawn } from "node:child_process";
import { mkdir, readFile, stat, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.mjs";

const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
export function validateDrawRequest(input){
  if(!["cover","artist-photo"].includes(input?.kind))throw new DomainError("Artwork type must be cover or artist-photo");
  if(typeof input.prompt!=="string"||input.prompt.trim().length<12||input.prompt.length>1200)
    throw new DomainError("Image prompt must be 12–1200 characters");
  const steps=input.steps??8,seed=input.seed??0;
  if(!Number.isInteger(steps)||steps<1||steps>50)throw new DomainError("Invalid inference steps");
  if(!Number.isInteger(seed)||seed<0||seed>2147483647)throw new DomainError("Invalid image seed");
  return {kind:input.kind,prompt:input.prompt.trim(),steps,seed,
    width:input.kind==="cover"?1024:768,height:1024};
}
export class DrawThings {
  constructor({command="draw-things-cli",model=process.env.BLOSSOM_DRAW_MODEL||"",directory=process.env.BLOSSOM_ASSET_DIR||".data/assets",
    runner=spawn}={}){
    this.command=command;this.model=model;this.directory=resolve(directory);this.runner=runner;
    this.running=false;
  }
  enabled(){return !!this.model}
  async generate(input) {
    const p=validateDrawRequest(input);
    if(!this.enabled())throw new DomainError("Set BLOSSOM_DRAW_MODEL to an installed Draw Things model",503);
    if(!/^[\w.-]{3,120}$/.test(this.model))throw new DomainError("Invalid server-side Draw Things model identifier",500);
    if(this.running)throw new DomainError("Image generation already in progress",409);
    this.running=true;
    const filename=randomUUID()+".png",output=join(this.directory,filename);
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const args=["generate","--model",this.model,"--prompt",p.prompt,
      "--width",String(p.width),"--height",String(p.height),"--steps",String(p.steps),
      "--seed",String(p.seed),"--output",output];
    try {
      await new Promise((done,fail)=>{
        const child=this.runner(this.command,args,{shell:false,stdio:["ignore","pipe","pipe"]});
        let err="";child.stderr.on("data",chunk=>{err=(err+String(chunk)).slice(-1200)});
        child.stdout.resume();
        const timeout=setTimeout(()=>child.kill("SIGKILL"),240000);
        child.on("error",error=>{clearTimeout(timeout);fail(new DomainError("Draw Things CLI unavailable: "+error.message,503))});
        child.on("close",(code,signal)=>{clearTimeout(timeout);
          if(code===0)done();else fail(new DomainError("Draw Things generation failed: "+(signal||err||code).toString().slice(0,180),502));});
      });
      const stats=await stat(output);
      if(stats.size<100||stats.size>20*1024*1024)throw new DomainError("Unexpected image file size",502);
      const header=(await readFile(output)).subarray(0,8);
      if(!header.equals(PNG))throw new DomainError("Draw Things returned a non-PNG file",502);
      return {filename,mime:"image/png",kind:p.kind,width:p.width,height:p.height};
    }catch(err){await rm(output,{force:true}).catch(()=>{});throw err}
    finally{this.running=false}
  }
}
