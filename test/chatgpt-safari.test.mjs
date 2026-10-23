import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";
import { chatGptStudioPrompt, submitChatGptStudioInSafari, submitChatGptStudioInBrowser } from "../src/native-browser.mjs";

const projectId="9b5989a0-c982-45ce-a860-ed5466511227";
test("Safari handoff uses only project ID and never reads ChatGPT output or login data",async()=>{
  const calls=[];
  const runner=(bin,args,options,done)=>{
    calls.push({bin,args,options});
    done(null,"SUBMITTED\n","");
  };
  const prompt=chatGptStudioPrompt(projectId);
  assert.match(prompt,/studio_project_get/);
  assert.match(prompt,/studio_project_save_result/);
  assert.match(prompt,/original lyrics/);
  const result=await submitChatGptStudioInSafari(projectId,{platform:"darwin",launcher:runner});
  assert.equal(result.submitted,true);
  assert.equal(result.resultSaved,false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].bin,"/usr/bin/osascript");
  assert.ok(calls[0].args[0].endsWith("/scripts/chatgpt-safari.applescript"));
  assert.equal(new URL(calls[0].args[1]).origin,"https://chatgpt.com");
  assert.equal(new URL(calls[0].args[1]).searchParams.get("prompt"),prompt);
  assert.doesNotMatch(JSON.stringify(calls),/cookie|Authorization|api_key/i);
  assert.ok(calls[0].args[2].includes("b.click()"));
  const chrome=await submitChatGptStudioInBrowser(projectId,{platform:"darwin",browser:"chrome",launcher:runner});
  assert.equal(chrome.mode,"chrome-ui");
  assert.ok(calls[1].args[0].endsWith("/scripts/chatgpt-chrome.applescript"));
  assert.equal(calls[1].args[1],calls[0].args[1]);
  await assert.rejects(submitChatGptStudioInSafari("../evil",{platform:"darwin",launcher:runner}),/Invalid Studio project/);
  await assert.rejects(submitChatGptStudioInSafari(projectId,{platform:"linux",launcher:runner}),/macOS only/);
  await assert.rejects(submitChatGptStudioInSafari(projectId,{platform:"darwin",
    launcher:(_b,_a,_o,done)=>done(new Error("permissions denied"),"","not allowed")}),/Browser could not submit/);
  await assert.rejects(submitChatGptStudioInSafari(projectId,{platform:"darwin",
    launcher:(_b,_a,_o,done)=>done(null,"WAIT","")}),/did not confirm/);
});

test("Studio legacy ChatGPT-extract now generates headlessly without Safari or MCP sign-in",async t=>{
  const store=new Store(":memory:");
  const launches=[];
  const song={concept:"An original fictional village song",lyrics:"[Verse 1] The countryside",style:"Americana acoustic",exclusions:[],moods:["gentle"],titles:["The Village"],coverPrompt:"Original rural landscape",artistPhotoPrompt:"Original fictional singer",suggestedGenre:"Americana",rationale:"Intimate acoustic sound"};
  const localComposer={generate:async()=>song,ask:async()=>({answer:"Use guitar"}),status:async()=>({engine:"Ollama",model:"qwen3:8b",available:true})};
  const server=createAppServer({store,provider:{available:()=>false},password:"long-test-password",localComposer,
    nativeBrowserOptions:{platform:"darwin",launcher:(bin,args,options,done)=>{launches.push({bin,args});done(null,"SUBMITTED","");}}});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
  const url="http://127.0.0.1:"+server.address().port;
  const post=(path,body={},cookie="",headers={})=>fetch(url+path,{method:"POST",headers:{"content-type":"application/json","x-blossom-request":"ui",...(cookie?{cookie}:{}),...headers},body:JSON.stringify(body)});
  const login=await post("/auth/login",{username:"admin",password:"long-test-password"});
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const newProject=await post("/api/studio/projects",{title:"Test News",article:"A fictional news article about small English villages working together on sustainable farming and conservation projects."},cookie);
  assert.equal(newProject.status,201);const project=await newProject.json();
  const route="/api/studio/projects/"+project.id+"/chatgpt-extract";
  assert.equal((await post(route)).status,401);
  assert.equal((await post(route,{},cookie,{Origin:"https://evil.example"})).status,403);
  assert.equal(store.browserAccountStatus("chatgpt").state,"not_started");
  const res=await post(route,{},cookie);
  assert.equal(res.status,200);
  assert.equal((await res.json()).result.concept,song.concept);
  assert.equal(launches.length,0,"browser must never be launched");
  assert.equal(store.browserAccountStatus("chatgpt").state,"not_started");
  assert.equal((await post("/api/studio/projects/"+projectId+"/chatgpt-extract",{},cookie)).status,404);
});
