import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ChatGptImages } from '../src/chatgpt-images.mjs';
import { chatGptDomScripts } from '../src/chatgpt-dom.mjs';

for (const [details,code,status] of [
  ['ChatGPT did not finish a reply.','chatgpt_image_timeout',504],
  ['Allow JavaScript from Apple Events','chatgpt_javascript_disabled',409],
  ['Not authorized to send Apple events. (-1743)','chatgpt_automation_denied',409],
  ['stdout maxBuffer length exceeded','chatgpt_image_too_large',502],
  ['Unexpected failure with private prompt','chatgpt_browser_failed',503]
]) test('image failure classification: '+code,async()=>{
  const images=new ChatGptImages({platform:'darwin',runner(_script,args,options,callback){
    assert.equal(args[3],'600');
    assert.ok(options.timeout>600000);
    callback(new Error(details),'',details);
  }});
  await assert.rejects(images.generate({kind:'cover',prompt:'A fictional mountain landscape'}),error=>{
    assert.equal(error.code,code);assert.equal(error.status,status);
    assert.doesNotMatch(error.message,/private prompt/);
    if(code==='chatgpt_image_timeout')assert.doesNotMatch(error.message,/Enable|Allow JavaScript/);
    return true;
  });
  assert.equal(images.busy,false);
});

test('image reader exports an attachment beside the assistant text in the same turn',()=>{
  const img={complete:true,naturalWidth:1024,naturalHeight:1024,src:'blob:generated'};
  const article={querySelectorAll:()=>[img]};
  const node={closest:()=>article,querySelectorAll:()=>[]};
  const window={__blossomGeneration:{count:0,last:'',stable:0}};
  const document={querySelectorAll:()=>[node],querySelector:()=>null,
    createElement:()=>({getContext:()=>({drawImage(actual){assert.equal(actual,img);}}),
      toDataURL:()=> 'data:image/png;base64,result'})};
  const context=vm.createContext({window,document});
  const read=chatGptDomScripts('Cover',{image:true}).read;
  for(let i=0;i<3;i++)assert.equal(vm.runInContext(read,context),'WAIT');
  assert.equal(vm.runInContext(read,context),'data:image/png;base64,result');
});

test('tainted canvas falls back to transferring the rendered image and polls until ready',async()=>{
  const img={complete:true,naturalWidth:1024,naturalHeight:1024,src:'https://example.test/generated.png'};
  const node={closest:()=>({querySelectorAll:()=>[img]})};
  const window={__blossomGeneration:{count:0,last:img.src,stable:3}};
  let downloads=0,canvasCount=0;
  const document={querySelectorAll:()=>[node],querySelector:()=>null,createElement(){
    const first=++canvasCount===1;
    return {getContext:()=>({drawImage(){}}),toDataURL(){if(first)throw Error('tainted');return 'data:image/png;base64,saved';}};
  }};
  const context=vm.createContext({window,document,fetch:async url=>{
    assert.equal(url,img.src);downloads++;return {ok:true,blob:async()=>({type:'image/png',size:1200})};
  },URL:{createObjectURL:()=> 'blob:copy',revokeObjectURL(){}},Image:class{naturalWidth=1024;naturalHeight=1024;set src(_){this.onload();}}});
  const script=chatGptDomScripts('Cover',{image:true}).read;
  assert.equal(vm.runInContext(script,context),'WAIT');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(window.__blossomGeneration.imageExport.data,'data:image/png;base64,saved');
  assert.equal(downloads,1);
});
