import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";

test("Blossom Studio works with ChatGPT browser login and no OpenAI API key",async t=>{
 const store=new Store(":memory:");
 const server=createAppServer({store,password:"long-local-test-password",provider:{available:()=>false}});
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
 const base="http://127.0.0.1:"+server.address().port;
 const post=(route,payload,cookie)=>fetch(base+route,{method:"POST",
   headers:{"Content-Type":"application/json","X-Blossom-Request":"ui",...(cookie?{cookie}:{})},
   body:JSON.stringify(payload)});
 assert.equal((await post("/api/studio/articles/import",{url:"https://news.example/story"})).status,401);
 const login=await post("/auth/login",{username:"admin",password:"long-local-test-password"});
 assert.equal(login.status,200);
 const cookie=login.headers.get("set-cookie").split(";")[0];
 const response=await post("/api/studio/projects",{title:"The rural fields",
   article:"Reports of unusual bee swarms in fields have encouraged rural communities to discuss conservation efforts and music events."},cookie);
 assert.equal(response.status,201);
 const {id}=await response.json();
 const prompt=await post("/api/studio/projects/"+id+"/chatgpt-prompt",{mode:"song"},cookie);
 assert.equal(prompt.status,200);assert.equal((await prompt.json()).url,"https://chatgpt.com/");
 const result={concept:"An original song about communities in the countryside",lyrics:"[Verse 1] Under the fields",style:"acoustic folk",titles:["Country Fields"]};
 const imported=await post("/api/studio/projects/"+id+"/chatgpt-import",{answer:JSON.stringify(result)},cookie);
 assert.equal(imported.status,200);
 assert.equal((await imported.json()).result.concept,result.concept);
 const ask=await post("/api/studio/projects/"+id+"/chatgpt-prompt",{mode:"assistant",question:"Meer gitaar?"},cookie);
 assert.equal(ask.status,200);
 const answer=await post("/api/studio/projects/"+id+"/chatgpt-import",{mode:"assistant",answer:"Acoustic guitar, soft brush drums"},cookie);
 assert.equal((await answer.json()).answer,"Acoustic guitar, soft brush drums");
 const status=await fetch(base+"/api/studio/status",{headers:{cookie}});
 assert.equal((await status.json()).chatgptBrowserHandoff,true);
 const bad=await post("/api/studio/articles/import",{url:"http://localhost/"},cookie);
 assert.equal(bad.status,400);
});
