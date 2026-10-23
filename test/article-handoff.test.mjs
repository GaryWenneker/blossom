import test from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, publicArticleUrl, extractArticleHTML, importArticle } from "../src/article-import.mjs";
import { chatGPTPrompt, normalizeChatGPTReply } from "../src/chatgpt-bridge.mjs";

test("Article importer validates public URLs and prevents non-public hosts",()=>{
  assert.equal(isPublicAddress("127.0.0.1"),false);
  assert.equal(isPublicAddress("192.168.1.1"),false);
  assert.equal(isPublicAddress("8.8.8.8"),true);
  assert.throws(()=>publicArticleUrl("http://localhost/admin"),/public/);
  assert.throws(()=>publicArticleUrl("file:///etc/passwd"),/public/);
  assert.equal(publicArticleUrl("https://news.example/story").href,"https://news.example/story");
});
test("News HTML contains article body, title and safe source URL",async()=>{
  const body="De zware bijen trekken over weilanden en boomgaarden. Onderzoekers bekijken de situatie in verschillende dorpen van Frankrijk en Engeland. ";
  const html="<html><title>Nieuws</title><article><h1>Bijen rond de velden</h1><p>"+body.repeat(3)+"</p></article></html>";
  const parsed=extractArticleHTML(html,"https://news.example/a");
  assert.equal(parsed.title,"Bijen rond de velden");
  assert.ok(parsed.text.length>180);
  const imported=await importArticle("https://news.example/a",{fetcher:async()=>({status:200,html})});
  assert.equal(imported.text,parsed.text);
  await assert.rejects(importArticle("https://news.example/start",{fetcher:async()=>({status:302,location:"http://news.example/end"})}),/Onveilige/);
});
test("No-key ChatGPT prompt and pasted JSON work with current project",()=>{
  const project={title:"Bijen",article:"Een lang artikel over bijen en landbouw in Engeland. Onderzoekers bespreken natuur en biodiversiteit in verschillende dorpen.",
    parameters:{genre:"Americana",additionalStyles:["Acoustic"],excludeStyles:[],vocalGender:"female",instrumental:false,targetSeconds:205,customInstructions:"warm"}};
  const prompt=chatGPTPrompt(project);
  assert.equal(prompt.url,"https://chatgpt.com/");
  assert.ok(prompt.prompt.includes("Americana"));
  const data={concept:"An original track about the rural landscape",lyrics:"[Verse 1] New days",style:"country",titles:["New Days"]};
  const result=normalizeChatGPTReply(JSON.stringify(data));
  assert.deepEqual(result.titles,["New Days"]);
  assert.equal(result.style,"country");
  assert.throws(()=>normalizeChatGPTReply("not json"),/JSON/);
  const advice=chatGPTPrompt(project,{mode:"assistant",question:"Welke gitaar?"});
  assert.ok(advice.prompt.includes("Welke gitaar?"));
});
